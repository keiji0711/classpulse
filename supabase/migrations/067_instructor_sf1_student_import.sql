-- Secure, transactional SF1 roster imports for assigned section advisers.

create or replace function public.import_advisory_students(
  p_section_id uuid,
  p_academic_year_id uuid,
  p_students jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_section public.sections%rowtype;
  v_year public.academic_years%rowtype;
  v_record jsonb;
  v_student_id uuid;
  v_parent_id uuid;
  v_lrn text;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_guardian_name text;
  v_phone_number text;
  v_new_students integer := 0;
  v_existing_enrolled integer := 0;
  v_existing_skipped integer := 0;
  v_total integer;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role <> 'instructor' then
    raise exception 'Only an authenticated instructor can import an SF1 roster';
  end if;

  select * into v_section from public.sections where id = p_section_id;
  if v_section.id is null
     or v_section.school_id is distinct from v_actor.school_id
     or v_section.adviser_id is distinct from v_actor.id then
    raise exception 'You can only import students into your assigned advisory section';
  end if;

  select * into v_year from public.academic_years where id = p_academic_year_id;
  if v_year.id is null
     or v_year.school_id is distinct from v_actor.school_id
     or not v_year.is_current
     or v_year.status <> 'active' then
    raise exception 'Students can only be imported into the current active academic year';
  end if;

  if p_students is null or jsonb_typeof(p_students) <> 'array' then
    raise exception 'Student import payload must be an array';
  end if;
  v_total := jsonb_array_length(p_students);
  if v_total < 1 or v_total > 500 then
    raise exception 'Import between 1 and 500 students at a time';
  end if;

  if (
    select count(*) <> count(distinct item->>'lrn')
    from jsonb_array_elements(p_students) item
  ) then
    raise exception 'The import contains duplicate LRNs';
  end if;

  for v_record in select value from jsonb_array_elements(p_students)
  loop
    v_lrn := btrim(coalesce(v_record->>'lrn', ''));
    v_first_name := btrim(coalesce(v_record->>'first_name', ''));
    v_middle_name := btrim(coalesce(v_record->>'middle_name', ''));
    v_last_name := btrim(coalesce(v_record->>'last_name', ''));
    v_guardian_name := btrim(coalesce(v_record->>'guardian_name', ''));
    v_phone_number := btrim(coalesce(v_record->>'phone_number', ''));

    if v_lrn !~ '^\d{12}$' then raise exception 'Invalid 12-digit LRN: %', v_lrn; end if;
    if v_first_name = '' or length(v_first_name) > 150 then raise exception 'Invalid first name for LRN %', v_lrn; end if;
    if v_middle_name <> '' and length(v_middle_name) > 150 then raise exception 'Invalid middle name for LRN %', v_lrn; end if;
    if v_last_name = '' or length(v_last_name) > 150 then raise exception 'Invalid last name for LRN %', v_lrn; end if;
    if v_guardian_name = '' or length(v_guardian_name) > 250 then raise exception 'A valid guardian is required for LRN %', v_lrn; end if;
    if length(v_phone_number) > 40 then raise exception 'Contact number is too long for LRN %', v_lrn; end if;

    select id into v_student_id
    from public.students
    where school_id = v_actor.school_id and lrn = v_lrn;

    if v_student_id is null then
      insert into public.students(school_id, section_id, lrn, first_name, middle_name, last_name)
      values(v_actor.school_id, v_section.id, v_lrn, v_first_name, v_middle_name, v_last_name)
      returning id into v_student_id;

      insert into public.parents(student_id, school_id, guardian_name, phone_number)
      values(v_student_id, v_actor.school_id, v_guardian_name, v_phone_number);

      insert into public.student_enrollments(student_id, section_id, academic_year_id, school_id)
      values(v_student_id, v_section.id, v_year.id, v_actor.school_id);
      v_new_students := v_new_students + 1;
    elsif exists (
      select 1 from public.student_enrollments
      where student_id = v_student_id and academic_year_id = v_year.id
    ) then
      v_existing_skipped := v_existing_skipped + 1;
    else
      update public.students set
        section_id = v_section.id,
        first_name = v_first_name,
        middle_name = v_middle_name,
        last_name = v_last_name
      where id = v_student_id;

      select id into v_parent_id from public.parents
      where student_id = v_student_id order by created_at, id limit 1;
      if v_parent_id is null then
        insert into public.parents(student_id, school_id, guardian_name, phone_number)
        values(v_student_id, v_actor.school_id, v_guardian_name, v_phone_number);
      else
        update public.parents set
          guardian_name = v_guardian_name,
          phone_number = case when v_phone_number = '' then phone_number else v_phone_number end
        where id = v_parent_id;
      end if;

      insert into public.student_enrollments(student_id, section_id, academic_year_id, school_id)
      values(v_student_id, v_section.id, v_year.id, v_actor.school_id);
      v_existing_enrolled := v_existing_enrolled + 1;
    end if;
  end loop;

  insert into public.admin_audit_log(
    actor_id, actor_name, actor_email, action, target_type, target_id, target_label, details
  ) values (
    v_actor.id, v_actor.full_name, v_actor.email, 'student.sf1_import', 'section',
    v_section.id::text, concat_ws(' - ', v_section.grade_level, v_section.name),
    jsonb_build_object(
      'academic_year_id', v_year.id,
      'submitted', v_total,
      'new_students', v_new_students,
      'existing_students_enrolled', v_existing_enrolled,
      'already_enrolled_skipped', v_existing_skipped
    )
  );

  return jsonb_build_object(
    'submitted', v_total,
    'new_students', v_new_students,
    'existing_students_enrolled', v_existing_enrolled,
    'already_enrolled_skipped', v_existing_skipped
  );
end;
$$;

revoke all on function public.import_advisory_students(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_advisory_students(uuid, uuid, jsonb) to authenticated;

comment on function public.import_advisory_students(uuid, uuid, jsonb) is
  'Atomically imports reviewed SF1 learners for the current active year after verifying the caller is the assigned section adviser.';

-- Allow an instructor to manually add one learner to their own advisory
-- section. The same authorization and active-year boundaries used by SF1
-- imports are enforced at the database boundary.

create or replace function public.add_advisory_student(
  p_section_id uuid,
  p_academic_year_id uuid,
  p_lrn text,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_guardian_name text,
  p_phone_number text default ''
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
  v_student public.students%rowtype;
  v_parent_id uuid;
  v_lrn text := btrim(coalesce(p_lrn, ''));
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_middle_name text := btrim(coalesce(p_middle_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_guardian_name text := btrim(coalesce(p_guardian_name, ''));
  v_phone_number text := btrim(coalesce(p_phone_number, ''));
  v_created boolean := false;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role <> 'instructor'
     or coalesce(v_actor.account_status, 'active') <> 'active' then
    raise exception 'Only an active instructor can add a student';
  end if;

  select * into v_section from public.sections where id = p_section_id;
  if v_section.id is null
     or v_section.school_id is distinct from v_actor.school_id
     or v_section.adviser_id is distinct from v_actor.id then
    raise exception 'You can only add students to your assigned advisory section';
  end if;

  select * into v_year from public.academic_years where id = p_academic_year_id;
  if v_year.id is null
     or v_year.school_id is distinct from v_actor.school_id
     or not v_year.is_current
     or v_year.status <> 'active' then
    raise exception 'Students can only be added to the current active academic year';
  end if;

  if v_lrn !~ '^\d{12}$' then raise exception 'LRN must contain exactly 12 digits'; end if;
  if v_first_name = '' or length(v_first_name) > 150 then raise exception 'Enter a valid first name'; end if;
  if v_middle_name <> '' and length(v_middle_name) > 150 then raise exception 'Middle name is too long'; end if;
  if v_last_name = '' or length(v_last_name) > 150 then raise exception 'Enter a valid last name'; end if;
  if v_guardian_name = '' or length(v_guardian_name) > 250 then raise exception 'Enter a valid guardian name'; end if;
  if length(v_phone_number) > 40 then raise exception 'Contact number is too long'; end if;

  select * into v_student
  from public.students
  where school_id = v_actor.school_id and lrn = v_lrn
  for update;

  if v_student.id is not null and exists (
    select 1 from public.student_enrollments enrollment
    where enrollment.student_id = v_student.id
      and enrollment.academic_year_id = v_year.id
  ) then
    raise exception 'This LRN is already enrolled in the current academic year';
  end if;

  if v_student.id is null then
    insert into public.students (
      school_id, section_id, lrn, first_name, middle_name, last_name
    ) values (
      v_actor.school_id, v_section.id, v_lrn, v_first_name, v_middle_name, v_last_name
    ) returning * into v_student;
    v_created := true;
  else
    if coalesce(v_student.lifecycle_status, 'active') = 'graduated' then
      raise exception 'A graduated learner must be reactivated by the school administrator';
    end if;
    update public.students set
      section_id = v_section.id,
      first_name = v_first_name,
      middle_name = v_middle_name,
      last_name = v_last_name
    where id = v_student.id
    returning * into v_student;
  end if;

  insert into public.student_enrollments (
    student_id, section_id, academic_year_id, school_id
  ) values (
    v_student.id, v_section.id, v_year.id, v_actor.school_id
  );

  select id into v_parent_id
  from public.parents
  where student_id = v_student.id
  order by created_at, id
  limit 1
  for update;

  if v_parent_id is null then
    insert into public.parents (student_id, school_id, guardian_name, phone_number)
    values (v_student.id, v_actor.school_id, v_guardian_name, v_phone_number);
  else
    update public.parents set
      guardian_name = v_guardian_name,
      phone_number = case when v_phone_number = '' then phone_number else v_phone_number end
    where id = v_parent_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, actor_name, actor_email, action,
    target_type, target_id, target_label, details
  ) values (
    v_actor.id, v_actor.full_name, v_actor.email, 'student.manual_add',
    'student', v_student.id::text,
    concat_ws(', ', v_last_name, v_first_name),
    jsonb_build_object(
      'section_id', v_section.id,
      'academic_year_id', v_year.id,
      'lrn', v_lrn,
      'new_student', v_created
    )
  );

  return jsonb_build_object(
    'student_id', v_student.id,
    'created', v_created,
    'section_id', v_section.id,
    'academic_year_id', v_year.id
  );
end;
$$;

revoke all on function public.add_advisory_student(uuid,uuid,text,text,text,text,text,text) from public, anon;
grant execute on function public.add_advisory_student(uuid,uuid,text,text,text,text,text,text) to authenticated;

comment on function public.add_advisory_student(uuid,uuid,text,text,text,text,text,text) is
  'Adds or re-enrolls one learner after verifying active-year and assigned-adviser scope; writes an audit event.';

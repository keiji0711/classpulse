-- Bind SF1 imports to official school identity and the selected class.

alter table public.schools add column if not exists deped_school_id text;

alter table public.schools drop constraint if exists schools_deped_school_id_format;
alter table public.schools add constraint schools_deped_school_id_format
  check (deped_school_id is null or deped_school_id ~ '^\d{6}$');

create unique index if not exists idx_schools_deped_school_id_unique
  on public.schools(deped_school_id) where deped_school_id is not null;

drop function if exists public.create_school_with_parent_billing(text, text, numeric);
create function public.create_school_with_parent_billing(
  p_name text,
  p_deped_school_id text,
  p_address text,
  p_monthly_price numeric
)
returns public.schools
language plpgsql
security definer
set search_path = public
as $$
declare v_school public.schools%rowtype; v_price numeric(10,2); v_deped_id text;
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'School name is required'; end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then raise exception 'School address is required'; end if;
  v_deped_id := btrim(coalesce(p_deped_school_id, ''));
  if v_deped_id !~ '^\d{6}$' then raise exception 'DepEd School ID must contain exactly 6 digits'; end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 999999.99 then
    raise exception 'Monthly parent fee must be between 0.01 and 999999.99';
  end if;
  if exists(select 1 from public.schools where deped_school_id = v_deped_id) then
    raise exception 'DepEd School ID % is already assigned to another school', v_deped_id;
  end if;

  v_price := round(p_monthly_price, 2);
  insert into public.schools(name, deped_school_id, address, subscription_mode)
  values(trim(p_name), v_deped_id, trim(p_address), 'school_paid') returning * into v_school;
  insert into public.parent_access_billing_settings(
    school_id, monthly_price, grace_days, billing_enabled, updated_by, updated_at
  ) values(v_school.id, v_price, 5, true, auth.uid(), now());
  return v_school;
end;
$$;
revoke all on function public.create_school_with_parent_billing(text, text, text, numeric) from public, anon;
grant execute on function public.create_school_with_parent_billing(text, text, text, numeric) to authenticated;

drop function if exists public.update_school_with_parent_billing(uuid, text, text, numeric);
create function public.update_school_with_parent_billing(
  p_school_id uuid,
  p_name text,
  p_deped_school_id text,
  p_address text,
  p_monthly_price numeric
)
returns public.schools
language plpgsql
security definer
set search_path = public
as $$
declare v_school public.schools%rowtype; v_price numeric(10,2); v_deped_id text;
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  if p_school_id is null then raise exception 'School is required'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'School name is required'; end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then raise exception 'School address is required'; end if;
  v_deped_id := btrim(coalesce(p_deped_school_id, ''));
  if v_deped_id !~ '^\d{6}$' then raise exception 'DepEd School ID must contain exactly 6 digits'; end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 999999.99 then
    raise exception 'Monthly parent fee must be between 0.01 and 999999.99';
  end if;
  if exists(select 1 from public.schools where deped_school_id = v_deped_id and id <> p_school_id) then
    raise exception 'DepEd School ID % is already assigned to another school', v_deped_id;
  end if;

  v_price := round(p_monthly_price, 2);
  update public.schools set
    name = trim(p_name), deped_school_id = v_deped_id,
    address = trim(p_address), subscription_mode = 'school_paid'
  where id = p_school_id returning * into v_school;
  if v_school.id is null then raise exception 'School not found'; end if;

  insert into public.parent_access_billing_settings(
    school_id, monthly_price, grace_days, billing_enabled, updated_by, updated_at
  ) values(v_school.id, v_price, 5, true, auth.uid(), now())
  on conflict(school_id) do update set monthly_price=excluded.monthly_price,
    updated_by=excluded.updated_by, updated_at=excluded.updated_at;
  return v_school;
end;
$$;
revoke all on function public.update_school_with_parent_billing(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.update_school_with_parent_billing(uuid, text, text, text, numeric) to authenticated;

create or replace function public.normalize_sf1_grade(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case
    when regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]', '', 'g') in ('kinder','kindergarten','grade0') then 'kindergarten'
    else regexp_replace(regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]', '', 'g'), '^grade', '')
  end
$$;

create or replace function public.normalize_sf1_section(p_value text, p_grade text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_value text := regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]', '', 'g');
        v_grade text := public.normalize_sf1_grade(p_grade);
begin
  if v_grade = 'kindergarten' then return regexp_replace(v_value, '^(kindergarten|kinder)', ''); end if;
  return regexp_replace(v_value, '^(grade)?' || v_grade, '');
end;
$$;

revoke all on function public.normalize_sf1_grade(text) from public, anon, authenticated;
revoke all on function public.normalize_sf1_section(text, text) from public, anon, authenticated;

drop function if exists public.import_advisory_students(uuid, uuid, jsonb);
create function public.import_advisory_students(
  p_section_id uuid,
  p_academic_year_id uuid,
  p_students jsonb,
  p_source_school_id text,
  p_source_school_year text,
  p_source_grade_level text,
  p_source_section_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype; v_school public.schools%rowtype;
  v_section public.sections%rowtype; v_year public.academic_years%rowtype;
  v_record jsonb; v_student_id uuid; v_parent_id uuid;
  v_lrn text; v_first_name text; v_middle_name text; v_last_name text;
  v_guardian_name text; v_phone_number text;
  v_new_students integer := 0; v_existing_enrolled integer := 0;
  v_existing_skipped integer := 0; v_total integer;
  v_source_year text; v_target_year text; v_source_section text; v_target_section text;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role <> 'instructor' then
    raise exception 'Only an authenticated instructor can import an SF1 roster';
  end if;
  select * into v_school from public.schools where id = v_actor.school_id;
  if v_school.id is null then raise exception 'The instructor school was not found'; end if;
  if v_school.deped_school_id is null then
    raise exception 'The school DepEd ID must be configured by the platform owner before importing SF1';
  end if;
  if btrim(coalesce(p_source_school_id,'')) <> v_school.deped_school_id then
    raise exception 'SF1 school ID does not match your school';
  end if;

  select * into v_section from public.sections where id = p_section_id;
  if v_section.id is null or v_section.school_id is distinct from v_actor.school_id
     or v_section.adviser_id is distinct from v_actor.id then
    raise exception 'You can only import students into your assigned advisory section';
  end if;
  select * into v_year from public.academic_years where id = p_academic_year_id;
  if v_year.id is null or v_year.school_id is distinct from v_actor.school_id
     or not v_year.is_current or v_year.status <> 'active' then
    raise exception 'Students can only be imported into the current active academic year';
  end if;

  v_source_year := regexp_replace(coalesce(p_source_school_year,''), '[^0-9]', '', 'g');
  v_target_year := regexp_replace(coalesce(v_year.name,''), '[^0-9]', '', 'g');
  if v_source_year = '' or v_source_year <> v_target_year then
    raise exception 'SF1 school year does not match the current active academic year';
  end if;
  if public.normalize_sf1_grade(p_source_grade_level) = ''
     or public.normalize_sf1_grade(p_source_grade_level) <> public.normalize_sf1_grade(v_section.grade_level) then
    raise exception 'SF1 grade level does not match the selected section';
  end if;
  v_source_section := regexp_replace(lower(coalesce(p_source_section_name,'')), '[^a-z0-9]', '', 'g');
  v_target_section := regexp_replace(lower(coalesce(v_section.name,'')), '[^a-z0-9]', '', 'g');
  if v_source_section = '' or not (
    v_source_section = v_target_section
    or public.normalize_sf1_section(p_source_section_name, p_source_grade_level)
       = public.normalize_sf1_section(v_section.name, v_section.grade_level)
  ) then raise exception 'SF1 section does not match the selected section'; end if;

  if p_students is null or jsonb_typeof(p_students) <> 'array' then raise exception 'Student import payload must be an array'; end if;
  v_total := jsonb_array_length(p_students);
  if v_total < 1 or v_total > 500 then raise exception 'Import between 1 and 500 students at a time'; end if;
  if (select count(*) <> count(distinct item->>'lrn') from jsonb_array_elements(p_students) item) then
    raise exception 'The import contains duplicate LRNs';
  end if;

  for v_record in select value from jsonb_array_elements(p_students)
  loop
    v_lrn := btrim(coalesce(v_record->>'lrn','')); v_first_name := btrim(coalesce(v_record->>'first_name',''));
    v_middle_name := btrim(coalesce(v_record->>'middle_name','')); v_last_name := btrim(coalesce(v_record->>'last_name',''));
    v_guardian_name := btrim(coalesce(v_record->>'guardian_name','')); v_phone_number := btrim(coalesce(v_record->>'phone_number',''));
    if v_lrn !~ '^\d{12}$' then raise exception 'Invalid 12-digit LRN: %', v_lrn; end if;
    if v_first_name = '' or length(v_first_name)>150 then raise exception 'Invalid first name for LRN %',v_lrn; end if;
    if v_middle_name <> '' and length(v_middle_name)>150 then raise exception 'Invalid middle name for LRN %',v_lrn; end if;
    if v_last_name = '' or length(v_last_name)>150 then raise exception 'Invalid last name for LRN %',v_lrn; end if;
    if v_guardian_name = '' or length(v_guardian_name)>250 then raise exception 'A valid guardian is required for LRN %',v_lrn; end if;
    if length(v_phone_number)>40 then raise exception 'Contact number is too long for LRN %',v_lrn; end if;

    select id into v_student_id from public.students where school_id=v_actor.school_id and lrn=v_lrn;
    if v_student_id is null then
      insert into public.students(school_id,section_id,lrn,first_name,middle_name,last_name)
      values(v_actor.school_id,v_section.id,v_lrn,v_first_name,v_middle_name,v_last_name) returning id into v_student_id;
      insert into public.parents(student_id,school_id,guardian_name,phone_number)
      values(v_student_id,v_actor.school_id,v_guardian_name,v_phone_number);
      insert into public.student_enrollments(student_id,section_id,academic_year_id,school_id)
      values(v_student_id,v_section.id,v_year.id,v_actor.school_id); v_new_students:=v_new_students+1;
    elsif exists(select 1 from public.student_enrollments where student_id=v_student_id and academic_year_id=v_year.id) then
      v_existing_skipped:=v_existing_skipped+1;
    else
      update public.students set section_id=v_section.id,first_name=v_first_name,middle_name=v_middle_name,last_name=v_last_name where id=v_student_id;
      select id into v_parent_id from public.parents where student_id=v_student_id order by created_at,id limit 1;
      if v_parent_id is null then
        insert into public.parents(student_id,school_id,guardian_name,phone_number)
        values(v_student_id,v_actor.school_id,v_guardian_name,v_phone_number);
      else
        update public.parents set guardian_name=v_guardian_name,
          phone_number=case when v_phone_number='' then phone_number else v_phone_number end where id=v_parent_id;
      end if;
      insert into public.student_enrollments(student_id,section_id,academic_year_id,school_id)
      values(v_student_id,v_section.id,v_year.id,v_actor.school_id); v_existing_enrolled:=v_existing_enrolled+1;
    end if;
  end loop;

  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
  values(v_actor.id,v_actor.full_name,v_actor.email,'student.sf1_import','section',v_section.id::text,
    concat_ws(' - ',v_section.grade_level,v_section.name),jsonb_build_object(
      'academic_year_id',v_year.id,'source_school_id',p_source_school_id,'source_school_year',p_source_school_year,
      'source_grade_level',p_source_grade_level,'source_section_name',p_source_section_name,
      'submitted',v_total,'new_students',v_new_students,'existing_students_enrolled',v_existing_enrolled,
      'already_enrolled_skipped',v_existing_skipped));
  return jsonb_build_object('submitted',v_total,'new_students',v_new_students,
    'existing_students_enrolled',v_existing_enrolled,'already_enrolled_skipped',v_existing_skipped);
end;
$$;

revoke all on function public.import_advisory_students(uuid,uuid,jsonb,text,text,text,text) from public, anon;
grant execute on function public.import_advisory_students(uuid,uuid,jsonb,text,text,text,text) to authenticated;

comment on column public.schools.deped_school_id is 'Official unique six-digit DepEd School ID used to verify imported school forms.';
comment on function public.import_advisory_students(uuid,uuid,jsonb,text,text,text,text) is
  'Atomically imports reviewed SF1 learners only when school ID, active year, grade, section, and adviser assignment all match.';

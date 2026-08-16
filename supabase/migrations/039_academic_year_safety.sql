-- Academic-year safety hardening.
-- Protect official history, remove public enrollment access, and authorize
-- operational-year changes inside the SECURITY DEFINER function.

-- This migration intentionally does not recreate missing foundation tables.
-- Apply all earlier migrations in numeric order. Raise a useful dependency
-- error before any safety changes are attempted when the database is behind.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.academic_years') is null then v_missing := array_append(v_missing, 'academic_years (migration 018)'); end if;
  if to_regclass('public.student_enrollments') is null then v_missing := array_append(v_missing, 'student_enrollments (migration 018)'); end if;
  if to_regclass('public.grades') is null then v_missing := array_append(v_missing, 'grades (migration 003)'); end if;
  if to_regclass('public.schedules') is null then v_missing := array_append(v_missing, 'schedules (migration 001)'); end if;
  if to_regclass('public.exam_scores') is null then v_missing := array_append(v_missing, 'exam_scores (migration 027)'); end if;
  if to_regclass('public.messages') is null then v_missing := array_append(v_missing, 'messages (migration 005)'); end if;

  if cardinality(v_missing) > 0 then
    raise exception 'Migration 039 prerequisites are missing: %. Apply all missing migrations through 038 in numeric order, then rerun 039.', array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- Student enrollment membership is private school data. Parent-facing edge
-- functions use verified access and the service role instead of anonymous SQL.
drop policy if exists "anon_read_enrollments" on public.student_enrollments;

-- Ensure all denormalized school IDs on an enrollment agree with the referenced
-- student, section, and academic year.
create or replace function public.validate_student_enrollment_school()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_student_school uuid;
  v_section_school uuid;
  v_year_school uuid;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  select school_id into v_section_school from public.sections where id = new.section_id;
  select school_id into v_year_school from public.academic_years where id = new.academic_year_id;

  if v_student_school is null or v_section_school is null or v_year_school is null then
    raise exception 'Enrollment references a missing student, section, or academic year';
  end if;

  if new.school_id <> v_student_school
     or new.school_id <> v_section_school
     or new.school_id <> v_year_school then
    raise exception 'Enrollment student, section, academic year, and school must belong to the same school';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_student_enrollment_school on public.student_enrollments;
create trigger trg_validate_student_enrollment_school
  before insert or update of student_id, section_id, academic_year_id, school_id
  on public.student_enrollments
  for each row execute function public.validate_student_enrollment_school();

-- Rebuild academic-year foreign keys as RESTRICT so official records cannot be
-- silently deleted or detached from their year.
alter table public.student_enrollments
  drop constraint if exists student_enrollments_academic_year_id_fkey;
alter table public.student_enrollments
  add constraint student_enrollments_academic_year_id_fkey
  foreign key (academic_year_id) references public.academic_years(id) on delete restrict;

alter table public.schedules
  drop constraint if exists schedules_academic_year_id_fkey;
alter table public.schedules
  add constraint schedules_academic_year_id_fkey
  foreign key (academic_year_id) references public.academic_years(id) on delete restrict;

alter table public.grades
  drop constraint if exists grades_academic_year_id_fkey;
alter table public.grades
  add constraint grades_academic_year_id_fkey
  foreign key (academic_year_id) references public.academic_years(id) on delete restrict;

alter table public.exam_scores
  drop constraint if exists exam_scores_academic_year_id_fkey;
alter table public.exam_scores
  add constraint exam_scores_academic_year_id_fkey
  foreign key (academic_year_id) references public.academic_years(id) on delete restrict;

alter table public.messages
  drop constraint if exists messages_academic_year_id_fkey;
alter table public.messages
  add constraint messages_academic_year_id_fkey
  foreign key (academic_year_id) references public.academic_years(id) on delete restrict;

create or replace function public.set_current_academic_year(p_year_id uuid, p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_user_school uuid;
begin
  select role, school_id
  into v_role, v_user_school
  from public.users
  where id = auth.uid();

  if v_role is null then
    raise exception 'Authentication required';
  end if;

  if v_role <> 'super_admin'
     and not (v_role = 'school_admin' and v_user_school = p_school_id) then
    raise exception 'Not authorized to change this school academic year';
  end if;

  if not exists (
    select 1
    from public.academic_years
    where id = p_year_id and school_id = p_school_id
  ) then
    raise exception 'Academic year does not belong to the specified school';
  end if;

  update public.academic_years
  set is_current = false
  where school_id = p_school_id and is_current = true and id <> p_year_id;

  update public.academic_years
  set is_current = true
  where id = p_year_id and school_id = p_school_id;
end;
$$;

revoke all on function public.set_current_academic_year(uuid, uuid) from public;
revoke all on function public.set_current_academic_year(uuid, uuid) from anon;
grant execute on function public.set_current_academic_year(uuid, uuid) to authenticated;

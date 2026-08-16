-- Enforce lifecycle write rules at the database boundary.

create or replace function public.normalize_new_academic_year()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.users
    where id = auth.uid()
      and role = 'school_admin'
      and school_id = new.school_id
  ) then
    raise exception 'Not authorized to create an academic year for this school';
  end if;

  if exists (select 1 from public.academic_years where school_id = new.school_id and is_current) then
    new.is_current := false;
    new.status := 'draft';
  else
    new.is_current := true;
    new.status := 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_new_academic_year on public.academic_years;
create trigger trg_normalize_new_academic_year
  before insert on public.academic_years
  for each row execute function public.normalize_new_academic_year();

-- School admins can correct labels/dates, while lifecycle columns are changed
-- only by the secured rollover functions.
revoke update on public.academic_years from authenticated;
grant update (name, start_date, end_date) on public.academic_years to authenticated;
revoke delete on public.academic_years from authenticated;

revoke update on public.students from authenticated;
grant update (first_name, middle_name, last_name, lrn, section_id) on public.students to authenticated;

revoke update on public.student_enrollments from authenticated;
grant update (section_id) on public.student_enrollments to authenticated;

create or replace function public.normalize_new_student_enrollment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    new.enrollment_status := 'enrolled';
    new.year_end_outcome := null;
    new.outcome_notes := '';
    new.finalized_at := null;
    new.finalized_by := null;
    new.promoted_to_enrollment_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_new_student_enrollment on public.student_enrollments;
create trigger trg_normalize_new_student_enrollment
  before insert on public.student_enrollments
  for each row execute function public.normalize_new_student_enrollment();

create or replace function public.guard_enrollment_year_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_year_id uuid := case when tg_op = 'DELETE' then old.academic_year_id else new.academic_year_id end;
  v_status text;
begin
  select status into v_status from public.academic_years where id = v_year_id;
  if v_status not in ('active', 'draft') then
    raise exception 'Enrollments in % academic years are read-only', coalesce(v_status, 'unknown');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_enrollment_year_write on public.student_enrollments;
create trigger trg_guard_enrollment_year_write
  before insert or update or delete on public.student_enrollments
  for each row execute function public.guard_enrollment_year_write();

create or replace function public.guard_direct_year_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_year_id uuid := case when tg_op = 'DELETE' then old.academic_year_id else new.academic_year_id end;
  v_status text;
begin
  if v_year_id is null then raise exception 'Academic year is required'; end if;
  select status into v_status from public.academic_years where id = v_year_id;
  if v_status <> 'active' then
    raise exception 'Records in % academic years are read-only', coalesce(v_status, 'unknown');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_grades_year_write on public.grades;
create trigger trg_guard_grades_year_write
  before insert or update or delete on public.grades
  for each row execute function public.guard_direct_year_write();

drop trigger if exists trg_guard_exam_scores_year_write on public.exam_scores;
create trigger trg_guard_exam_scores_year_write
  before insert or update or delete on public.exam_scores
  for each row execute function public.guard_direct_year_write();

create or replace function public.guard_schedule_year_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_year_id uuid := case when tg_op = 'DELETE' then old.academic_year_id else new.academic_year_id end;
  v_status text;
begin
  if v_year_id is null then raise exception 'Academic year is required'; end if;
  select status into v_status from public.academic_years where id = v_year_id;
  if v_status not in ('active', 'draft') then
    raise exception 'Schedules in % academic years are read-only', coalesce(v_status, 'unknown');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_schedules_year_write on public.schedules;
create trigger trg_guard_schedules_year_write
  before insert or update or delete on public.schedules
  for each row execute function public.guard_schedule_year_write();

create or replace function public.guard_attendance_year_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_schedule_id uuid := case when tg_op = 'DELETE' then old.schedule_id else new.schedule_id end;
  v_status text;
begin
  select year_row.status into v_status
  from public.schedules schedule_row
  join public.academic_years year_row on year_row.id = schedule_row.academic_year_id
  where schedule_row.id = v_schedule_id;

  if v_status <> 'active' then
    raise exception 'Attendance in % academic years is read-only', coalesce(v_status, 'unknown');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_attendance_year_write on public.attendance_records;
create trigger trg_guard_attendance_year_write
  before insert or update or delete on public.attendance_records
  for each row execute function public.guard_attendance_year_write();

-- The legacy current-year switch is no longer a public lifecycle operation.
revoke all on function public.set_current_academic_year(uuid, uuid) from authenticated;

create or replace function public.archive_academic_year(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_status text;
begin
  select school_id, status into v_school_id, v_status
  from public.academic_years where id = p_year_id for update;

  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'school_admin' and school_id = v_school_id
  ) then
    raise exception 'Not authorized to archive this academic year';
  end if;
  if v_status <> 'closed' then raise exception 'Only a closed academic year can be archived'; end if;

  update public.academic_years set status = 'archived' where id = p_year_id;
end;
$$;

revoke all on function public.archive_academic_year(uuid) from public;
revoke all on function public.archive_academic_year(uuid) from anon;
grant execute on function public.archive_academic_year(uuid) to authenticated;

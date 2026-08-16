-- Atomic attendance replacement and scalable dashboard aggregation.

create or replace function public.replace_class_attendance(
  p_schedule_id uuid,
  p_date date,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_school uuid;
  v_schedule public.schedules%rowtype;
  v_year public.academic_years%rowtype;
  v_expected_count integer;
  v_record_count integer;
  v_unique_count integer;
  v_inserted jsonb;
begin
  select role, school_id into v_user_role, v_user_school
  from public.users where id = v_user_id;

  if v_user_role <> 'instructor' or v_user_school is null then
    raise exception 'Only an authenticated instructor can record attendance';
  end if;
  if not public.current_user_has_feature('attendance_take') then
    raise exception 'Attendance recording is unavailable for this school';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Attendance records must be a JSON array';
  end if;

  select * into v_schedule
  from public.schedules
  where id = p_schedule_id
    and instructor_id = v_user_id
    and school_id = v_user_school
  for update;
  if not found then raise exception 'Schedule not found or not assigned to this instructor'; end if;

  select * into v_year
  from public.academic_years
  where id = v_schedule.academic_year_id and school_id = v_user_school;
  if not found or v_year.status <> 'active' then raise exception 'Attendance can only be recorded in the active academic year'; end if;
  if p_date < v_year.start_date or p_date > v_year.end_date then raise exception 'Attendance date is outside the active academic year'; end if;

  select count(*) into v_expected_count
  from public.student_enrollments
  where school_id = v_user_school
    and academic_year_id = v_schedule.academic_year_id
    and section_id = v_schedule.section_id
    and enrollment_status = 'enrolled';

  v_record_count := jsonb_array_length(p_records);
  select count(distinct record.student_id) into v_unique_count
  from jsonb_to_recordset(p_records) as record(student_id uuid, status text);

  if v_record_count <> v_expected_count or v_unique_count <> v_expected_count then
    raise exception 'Attendance must contain exactly one record for every enrolled student';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_records) as record(student_id uuid, status text)
    left join public.student_enrollments enrollment
      on enrollment.student_id = record.student_id
     and enrollment.school_id = v_user_school
     and enrollment.academic_year_id = v_schedule.academic_year_id
     and enrollment.section_id = v_schedule.section_id
     and enrollment.enrollment_status = 'enrolled'
    where enrollment.id is null
       or record.status not in ('present', 'absent', 'late', 'excused')
  ) then
    raise exception 'Attendance contains an invalid student or status';
  end if;

  delete from public.attendance_records
  where schedule_id = p_schedule_id and date = p_date;

  with inserted as (
    insert into public.attendance_records (schedule_id, student_id, date, status, recorded_by)
    select p_schedule_id, record.student_id, p_date, record.status, v_user_id
    from jsonb_to_recordset(p_records) as record(student_id uuid, status text)
    returning id, student_id, schedule_id, status, date, recorded_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_inserted from inserted;

  return jsonb_build_object('count', v_record_count, 'records', v_inserted);
end;
$$;

revoke all on function public.replace_class_attendance(uuid, date, jsonb) from public;
revoke all on function public.replace_class_attendance(uuid, date, jsonb) from anon;
grant execute on function public.replace_class_attendance(uuid, date, jsonb) to authenticated;

create or replace function public.get_taken_attendance_schedule_ids(
  p_academic_year_id uuid,
  p_date date
)
returns table(schedule_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select distinct attendance.schedule_id
  from public.attendance_records attendance
  join public.schedules schedule on schedule.id = attendance.schedule_id
  join public.users current_user_row on current_user_row.id = auth.uid()
  where current_user_row.role = 'instructor'
    and schedule.instructor_id = auth.uid()
    and schedule.school_id = current_user_row.school_id
    and schedule.academic_year_id = p_academic_year_id
    and attendance.date = p_date;
$$;

revoke all on function public.get_taken_attendance_schedule_ids(uuid, date) from public;
revoke all on function public.get_taken_attendance_schedule_ids(uuid, date) from anon;
grant execute on function public.get_taken_attendance_schedule_ids(uuid, date) to authenticated;

create or replace function public.get_instructor_attendance_history(
  p_academic_year_id uuid,
  p_date_from date,
  p_date_to date,
  p_status text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_total integer;
  v_records jsonb;
begin
  select role into v_role from public.users where id = v_user_id;
  if v_role <> 'instructor' then raise exception 'Only an instructor can view instructor attendance history'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Page size must be between 1 and 100'; end if;
  if p_offset < 0 then raise exception 'Page offset cannot be negative'; end if;
  if p_status is not null and p_status not in ('present', 'absent', 'late', 'excused') then raise exception 'Invalid attendance status'; end if;

  with filtered as materialized (
    select attendance.id, attendance.student_id, attendance.schedule_id,
      attendance.date, attendance.status, attendance.recorded_by, attendance.recorded_at,
      student.first_name, student.last_name, student.lrn,
      subject.name as subject_name, subject.code as subject_code,
      section.name as section_name
    from public.attendance_records attendance
    join public.schedules schedule on schedule.id = attendance.schedule_id
    join public.students student on student.id = attendance.student_id
    join public.subjects subject on subject.id = schedule.subject_id
    join public.sections section on section.id = schedule.section_id
    where schedule.instructor_id = v_user_id
      and schedule.academic_year_id = p_academic_year_id
      and attendance.date between p_date_from and p_date_to
      and (p_status is null or attendance.status = p_status)
      and (
        v_search is null
        or student.first_name ilike '%' || v_search || '%'
        or student.last_name ilike '%' || v_search || '%'
        or student.lrn ilike '%' || v_search || '%'
        or subject.name ilike '%' || v_search || '%'
        or section.name ilike '%' || v_search || '%'
      )
  ), page_rows as (
    select * from filtered
    order by date desc, recorded_at desc
    limit p_limit offset p_offset
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', page_rows.id,
      'student_id', page_rows.student_id,
      'schedule_id', page_rows.schedule_id,
      'date', page_rows.date,
      'status', page_rows.status,
      'recorded_by', page_rows.recorded_by,
      'recorded_at', page_rows.recorded_at,
      'student', jsonb_build_object('first_name', page_rows.first_name, 'last_name', page_rows.last_name, 'lrn', page_rows.lrn),
      'schedule', jsonb_build_object(
        'id', page_rows.schedule_id,
        'subject', jsonb_build_object('name', page_rows.subject_name, 'code', page_rows.subject_code),
        'section', jsonb_build_object('name', page_rows.section_name)
      )
    ) order by page_rows.date desc, page_rows.recorded_at desc), '[]'::jsonb)
  into v_total, v_records
  from page_rows;

  return jsonb_build_object('total', coalesce(v_total, 0), 'records', v_records);
end;
$$;

revoke all on function public.get_instructor_attendance_history(uuid, date, date, text, text, integer, integer) from public;
revoke all on function public.get_instructor_attendance_history(uuid, date, date, text, text, integer, integer) from anon;
grant execute on function public.get_instructor_attendance_history(uuid, date, date, text, text, integer, integer) to authenticated;

create or replace function public.get_school_attendance_dashboard(
  p_academic_year_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_school_id uuid;
  v_role text;
  v_result jsonb;
begin
  select school_id, role into v_school_id, v_role from public.users where id = v_user_id;
  if v_role <> 'school_admin' or v_school_id is null then raise exception 'Only a school administrator can view this dashboard'; end if;
  if not exists (
    select 1 from public.academic_years
    where id = p_academic_year_id and school_id = v_school_id
  ) then raise exception 'Academic year not found'; end if;

  with filtered as materialized (
    select attendance.student_id, attendance.status, attendance.date
    from public.attendance_records attendance
    join public.schedules schedule on schedule.id = attendance.schedule_id
    where schedule.school_id = v_school_id
      and schedule.academic_year_id = p_academic_year_id
      and attendance.date between p_date_from and p_date_to
  ),
  today_counts as (
    select
      count(*) filter (where status = 'present')::integer as present,
      count(*) filter (where status = 'absent')::integer as absent,
      count(*) filter (where status = 'late')::integer as late,
      count(*) filter (where status = 'excused')::integer as excused,
      count(*)::integer as total
    from filtered where date = p_date_to
  ),
  daily as (
    select date,
      round(100.0 * count(*) filter (where status in ('present', 'late', 'excused')) / nullif(count(*), 0), 1) as rate
    from filtered group by date order by date
  ),
  student_counts as (
    select student_id, count(*)::integer as total,
      count(*) filter (where status = 'absent')::integer as absences,
      round(100.0 * count(*) filter (where status = 'absent') / nullif(count(*), 0), 1) as rate
    from filtered group by student_id
  ),
  risk as (
    select counts.student_id as id,
      student.last_name || ', ' || student.first_name as name,
      section.name as section,
      counts.rate, counts.absences, counts.total
    from student_counts counts
    join public.student_enrollments enrollment
      on enrollment.student_id = counts.student_id
     and enrollment.school_id = v_school_id
     and enrollment.academic_year_id = p_academic_year_id
    join public.students student on student.id = counts.student_id
    join public.sections section on section.id = enrollment.section_id
    where counts.rate >= 10
    order by counts.rate desc, counts.absences desc, student.last_name, student.first_name
    limit 50
  ),
  parent_access as (
    select
      count(distinct parent.student_id)::integer as total,
      count(distinct parent.student_id) filter (where coalesce(preference.enabled, true))::integer as on_count,
      count(distinct parent.student_id) filter (where not coalesce(preference.enabled, true))::integer as off_count
    from public.parents parent
    left join public.student_notification_preferences preference on preference.student_id = parent.student_id
    where parent.school_id = v_school_id
  )
  select jsonb_build_object(
    'today', (select to_jsonb(today_counts) from today_counts),
    'trend', coalesce((select jsonb_agg(to_jsonb(daily) order by date) from daily), '[]'::jsonb),
    'at_risk', coalesce((select jsonb_agg(to_jsonb(risk)) from risk), '[]'::jsonb),
    'parent_access', (select jsonb_build_object('total', total, 'on', on_count, 'off', off_count) from parent_access)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_school_attendance_dashboard(uuid, date, date) from public;
revoke all on function public.get_school_attendance_dashboard(uuid, date, date) from anon;
grant execute on function public.get_school_attendance_dashboard(uuid, date, date) to authenticated;

create index if not exists idx_attendance_records_schedule_date
  on public.attendance_records (schedule_id, date desc);

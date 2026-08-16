-- Fix: restore named parameters on attendance RPC wrapper functions.
-- Migration 060 created them with positional-only signatures, breaking
-- PostgREST named-parameter routing used by the frontend.

drop function public.replace_class_attendance(uuid,date,jsonb);
drop function public.get_taken_attendance_schedule_ids(uuid,date);
drop function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer);
drop function public.get_school_attendance_dashboard(uuid,date,date);

create function public.replace_class_attendance(
  p_schedule_id uuid,
  p_date date,
  p_records jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role() <> 'instructor' then
    raise exception 'Active instructor access is required';
  end if;
  return public.replace_class_attendance_internal(p_schedule_id, p_date, p_records);
end;$$;

create function public.get_taken_attendance_schedule_ids(
  p_academic_year_id uuid,
  p_date date
)
returns table(schedule_id uuid) language plpgsql security definer stable set search_path = public as $$
begin
  if public.get_user_role() <> 'instructor' then
    raise exception 'Active instructor access is required';
  end if;
  return query
    select result.schedule_id
    from public.get_taken_attendance_schedule_ids_internal(p_academic_year_id, p_date) result;
end;$$;

create function public.get_instructor_attendance_history(
  p_academic_year_id uuid,
  p_date_from date,
  p_date_to date,
  p_status text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if public.get_user_role() <> 'instructor' then
    raise exception 'Active instructor access is required';
  end if;
  return public.get_instructor_attendance_history_internal(
    p_academic_year_id, p_date_from, p_date_to, p_status, p_search, p_limit, p_offset
  );
end;$$;

create function public.get_school_attendance_dashboard(
  p_academic_year_id uuid,
  p_date_from date,
  p_date_to date
)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if public.get_user_role() <> 'school_admin' then
    raise exception 'School administrator access with MFA is required';
  end if;
  return public.get_school_attendance_dashboard_internal(p_academic_year_id, p_date_from, p_date_to);
end;$$;

revoke all on function public.replace_class_attendance(uuid,date,jsonb) from public, anon;
revoke all on function public.get_taken_attendance_schedule_ids(uuid,date) from public, anon;
revoke all on function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer) from public, anon;
revoke all on function public.get_school_attendance_dashboard(uuid,date,date) from public, anon;

grant execute on function public.replace_class_attendance(uuid,date,jsonb) to authenticated;
grant execute on function public.get_taken_attendance_schedule_ids(uuid,date) to authenticated;
grant execute on function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer) to authenticated;
grant execute on function public.get_school_attendance_dashboard(uuid,date,date) to authenticated;

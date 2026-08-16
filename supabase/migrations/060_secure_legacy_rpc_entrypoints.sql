-- Wrap legacy SECURITY DEFINER entry points with the centralized active-account
-- and MFA-aware role checks without duplicating their transaction logic.

alter function public.finalize_school_year_rollover(uuid,uuid,jsonb,uuid)
  rename to finalize_school_year_rollover_internal;
alter function public.activate_school_year_rollover(uuid)
  rename to activate_school_year_rollover_internal;
alter function public.archive_academic_year(uuid)
  rename to archive_academic_year_internal;
alter function public.replace_class_attendance(uuid,date,jsonb)
  rename to replace_class_attendance_internal;
alter function public.get_taken_attendance_schedule_ids(uuid,date)
  rename to get_taken_attendance_schedule_ids_internal;
alter function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer)
  rename to get_instructor_attendance_history_internal;
alter function public.get_school_attendance_dashboard(uuid,date,date)
  rename to get_school_attendance_dashboard_internal;

revoke all on function public.finalize_school_year_rollover_internal(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.activate_school_year_rollover_internal(uuid) from public,anon,authenticated;
revoke all on function public.archive_academic_year_internal(uuid) from public,anon,authenticated;
revoke all on function public.replace_class_attendance_internal(uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.get_taken_attendance_schedule_ids_internal(uuid,date) from public,anon,authenticated;
revoke all on function public.get_instructor_attendance_history_internal(uuid,date,date,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.get_school_attendance_dashboard_internal(uuid,date,date) from public,anon,authenticated;

create function public.finalize_school_year_rollover(uuid,uuid,jsonb,uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.get_user_role()<>'school_admin' then raise exception 'School administrator access with MFA is required'; end if;
  return public.finalize_school_year_rollover_internal($1,$2,$3,$4);
end;$$;

create function public.activate_school_year_rollover(uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.get_user_role()<>'school_admin' then raise exception 'School administrator access with MFA is required'; end if;
  return public.activate_school_year_rollover_internal($1);
end;$$;

create function public.archive_academic_year(uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.get_user_role()<>'school_admin' then raise exception 'School administrator access with MFA is required'; end if;
  perform public.archive_academic_year_internal($1);
end;$$;

create function public.replace_class_attendance(uuid,date,jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.get_user_role()<>'instructor' then raise exception 'Active instructor access is required'; end if;
  return public.replace_class_attendance_internal($1,$2,$3);
end;$$;

create function public.get_taken_attendance_schedule_ids(uuid,date)
returns table(schedule_id uuid) language plpgsql security definer stable set search_path=public as $$
begin
  if public.get_user_role()<>'instructor' then raise exception 'Active instructor access is required'; end if;
  return query select result.schedule_id from public.get_taken_attendance_schedule_ids_internal($1,$2) result;
end;$$;

create function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer)
returns jsonb language plpgsql security definer stable set search_path=public as $$
begin
  if public.get_user_role()<>'instructor' then raise exception 'Active instructor access is required'; end if;
  return public.get_instructor_attendance_history_internal($1,$2,$3,$4,$5,$6,$7);
end;$$;

create function public.get_school_attendance_dashboard(uuid,date,date)
returns jsonb language plpgsql security definer stable set search_path=public as $$
begin
  if public.get_user_role()<>'school_admin' then raise exception 'School administrator access with MFA is required'; end if;
  return public.get_school_attendance_dashboard_internal($1,$2,$3);
end;$$;

revoke all on function public.finalize_school_year_rollover(uuid,uuid,jsonb,uuid) from public,anon;
revoke all on function public.activate_school_year_rollover(uuid) from public,anon;
revoke all on function public.archive_academic_year(uuid) from public,anon;
revoke all on function public.replace_class_attendance(uuid,date,jsonb) from public,anon;
revoke all on function public.get_taken_attendance_schedule_ids(uuid,date) from public,anon;
revoke all on function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer) from public,anon;
revoke all on function public.get_school_attendance_dashboard(uuid,date,date) from public,anon;
grant execute on function public.finalize_school_year_rollover(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.activate_school_year_rollover(uuid) to authenticated;
grant execute on function public.archive_academic_year(uuid) to authenticated;
grant execute on function public.replace_class_attendance(uuid,date,jsonb) to authenticated;
grant execute on function public.get_taken_attendance_schedule_ids(uuid,date) to authenticated;
grant execute on function public.get_instructor_attendance_history(uuid,date,date,text,text,integer,integer) to authenticated;
grant execute on function public.get_school_attendance_dashboard(uuid,date,date) to authenticated;


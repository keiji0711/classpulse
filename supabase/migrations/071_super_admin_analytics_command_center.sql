-- Rich, privacy-safe platform analytics for the super-admin command center.
-- All results are aggregate; no student or guardian personal data is returned.

create index if not exists idx_attendance_records_date
  on public.attendance_records (date);

create or replace function public.get_platform_operations_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role <> 'super_admin' then
    raise exception 'Super admin access required';
  end if;

  with school_usage as (
    select
      s.id,
      s.name,
      s.address,
      s.operational_status,
      s.status_reason,
      s.created_at,
      s.status_changed_at,
      (select count(*) from public.users u where u.school_id = s.id and u.role = 'school_admin')::int admins,
      (select count(*) from public.users u where u.school_id = s.id and u.role = 'instructor')::int instructors,
      (select count(*) from public.students st where st.school_id = s.id)::int students,
      (select count(*) from public.sections sec where sec.school_id = s.id)::int sections,
      (select count(*) from public.schedules sch where sch.school_id = s.id)::int schedules,
      (select max(ar.recorded_at) from public.attendance_records ar join public.schedules sch on sch.id = ar.schedule_id where sch.school_id = s.id) last_attendance,
      (select count(*) from public.attendance_records ar join public.schedules sch on sch.id = ar.schedule_id where sch.school_id = s.id and ar.date >= current_date - 6)::int attendance_7d,
      (select count(*) from public.notification_logs nl where nl.school_id = s.id and nl.status = 'failed' and nl.created_at >= now() - interval '7 days')::int notification_failures_7d,
      (select count(*) from public.support_threads t where t.school_id = s.id and t.status = 'open')::int open_support,
      (select count(distinct p.student_id)
         from public.parents p
         join public.parent_access_subscriptions pas
           on pas.family_id = p.family_id and pas.school_id = p.school_id
        where p.school_id = s.id
          and pas.provider = 'google_play'
          and pas.entitlement_id = 'parent_access'
          and pas.status = 'active'
          and (pas.expires_at is null or pas.expires_at > now()))::int google_play_students,
      exists(select 1 from public.academic_years ay where ay.school_id = s.id and ay.status = 'active') has_active_year
    from public.schools s
  ),
  day_series as (
    select generate_series(current_date - 29, current_date, interval '1 day')::date metric_date
  ),
  attendance_by_day as (
    select ds.metric_date,
      count(ar.id)::int records,
      count(distinct sch.school_id)::int active_schools
    from day_series ds
    left join public.attendance_records ar on ar.date = ds.metric_date
    left join public.schedules sch on sch.id = ar.schedule_id
    group by ds.metric_date
    order by ds.metric_date
  ),
  notifications_by_day as (
    select ds.metric_date,
      count(nl.id) filter(where nl.status = 'delivered')::int delivered,
      count(nl.id) filter(where nl.status = 'failed')::int failed,
      count(nl.id) filter(where nl.status = 'no_token')::int no_token
    from day_series ds
    left join public.notification_logs nl
      on (nl.created_at at time zone 'Asia/Manila')::date = ds.metric_date
    group by ds.metric_date
    order by ds.metric_date
  ),
  notification_health as (
    select
      count(*)::int attempts,
      count(*) filter(where status = 'delivered')::int delivered,
      count(*) filter(where status = 'failed')::int failed,
      count(*) filter(where status = 'no_token')::int no_token,
      count(*) filter(where status = 'skipped')::int skipped,
      coalesce(round(avg(latency_ms) filter(where latency_ms is not null)), 0)::int avg_latency_ms
    from public.notification_logs
    where created_at >= now() - interval '24 hours'
  ),
  parent_access as (
    select
      (select count(*) from public.students)::int eligible,
      (select count(*) from public.parent_access_payments pap
        where pap.billing_month = date_trunc('month', current_date)::date and pap.status = 'paid')::int cash_paid,
      (select count(*) from public.parent_access_payments pap
        where pap.billing_month = date_trunc('month', current_date)::date and pap.status = 'waived')::int waived,
      (select count(distinct pas.family_id) from public.parent_access_subscriptions pas
        where pas.provider = 'google_play' and pas.entitlement_id = 'parent_access'
          and pas.status = 'active' and (pas.expires_at is null or pas.expires_at > now()))::int google_play_families,
      (select count(distinct p.student_id)
         from public.parents p
         join public.parent_access_subscriptions pas
           on pas.family_id = p.family_id and pas.school_id = p.school_id
        where pas.provider = 'google_play' and pas.entitlement_id = 'parent_access'
          and pas.status = 'active' and (pas.expires_at is null or pas.expires_at > now()))::int google_play_students,
      coalesce((select sum(pap.amount_paid) from public.parent_access_payments pap
        where pap.billing_month = date_trunc('month', current_date)::date
          and pap.status = 'paid' and pap.remittance_status = 'verified'), 0) verified_cash_revenue,
      (select count(*) from public.parent_access_payments pap
        where pap.billing_month = date_trunc('month', current_date)::date
          and pap.status = 'paid' and pap.remittance_status <> 'verified')::int pending_cash_records
  ),
  health_summary as (
    select
      count(*) filter(where resolved_at is null)::int open,
      count(*) filter(where resolved_at is null and severity = 'critical')::int critical,
      count(*) filter(where resolved_at is null and severity = 'warning')::int warning
    from public.platform_health_events
  ),
  support_summary as (
    select
      count(*) filter(where status = 'open')::int open,
      count(*) filter(where status = 'open' and unread_for_admin)::int unread
    from public.support_threads
  )
  select jsonb_build_object(
    'generated_at', now(),
    'schools', coalesce((select jsonb_agg(to_jsonb(school_usage) order by name) from school_usage), '[]'::jsonb),
    'totals', jsonb_build_object(
      'schools', (select count(*) from school_usage),
      'active', (select count(*) from school_usage where operational_status = 'active'),
      'attention', (select count(*) from school_usage where operational_status in ('new','setup','inactive','suspended')),
      'students', (select coalesce(sum(students), 0) from school_usage),
      'instructors', (select coalesce(sum(instructors), 0) from school_usage),
      'admins', (select coalesce(sum(admins), 0) from school_usage),
      'new_schools_30d', (select count(*) from school_usage where created_at >= now() - interval '30 days')
    ),
    'activity', jsonb_build_object(
      'attendance_today', (select records from attendance_by_day where metric_date = current_date),
      'attendance_7d', (select coalesce(sum(records), 0) from attendance_by_day where metric_date >= current_date - 6),
      'active_schools_today', (select active_schools from attendance_by_day where metric_date = current_date),
      'active_schools_7d', (select count(*) from school_usage where attendance_7d > 0),
      'days', (select jsonb_agg(jsonb_build_object('date', metric_date, 'records', records, 'active_schools', active_schools) order by metric_date) from attendance_by_day)
    ),
    'notifications', (select to_jsonb(notification_health) from notification_health),
    'notification_days', (select jsonb_agg(jsonb_build_object('date', metric_date, 'delivered', delivered, 'failed', failed, 'no_token', no_token) order by metric_date) from notifications_by_day),
    'parent_access', (select to_jsonb(parent_access) from parent_access),
    'health', (select to_jsonb(health_summary) from health_summary),
    'support', (select to_jsonb(support_summary) from support_summary),
    'open_health_events', (select open from health_summary),
    'open_support', (select open from support_summary)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_platform_operations_snapshot() from public, anon;
grant execute on function public.get_platform_operations_snapshot() to authenticated;

comment on function public.get_platform_operations_snapshot() is
  'Aggregate, privacy-safe platform command-center analytics for super administrators.';

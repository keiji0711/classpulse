-- Distinguish permanently invalid device tokens from transient delivery errors.
alter table public.notification_logs drop constraint if exists notification_logs_status_check;
alter table public.notification_logs add constraint notification_logs_status_check
  check (status in ('delivered', 'failed', 'no_token', 'skipped', 'stale_token'));

create or replace function public.get_security_reliability_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_result jsonb;
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  select jsonb_build_object(
    'admins', (select count(*) from public.users where role in ('super_admin','school_admin')),
    'mfa_enrolled', (select count(*) from public.admin_security_profiles where mfa_enrolled),
    'mfa_required', (select count(*) from public.admin_security_profiles where mfa_required),
    'failed_logins_24h', (select count(*) from public.security_login_events where not success and created_at >= now() - interval '24 hours'),
    'active_devices_30d', (select count(*) from public.user_device_sessions where revoked_at is null and last_seen_at >= now() - interval '30 days'),
    'push_attempts_24h', (select count(*) from public.notification_logs where created_at >= now() - interval '24 hours'),
    'push_delivered_24h', (select count(*) from public.notification_logs where status = 'delivered' and created_at >= now() - interval '24 hours'),
    'push_failures_24h', (select count(*) from public.notification_logs where status = 'failed' and created_at >= now() - interval '24 hours'),
    'stale_tokens_24h', (select count(*) from public.notification_logs where status = 'stale_token' and created_at >= now() - interval '24 hours'),
    'failed_jobs', (select count(*) from public.reliability_jobs where status = 'failed'),
    'open_errors', (select count(*) from public.application_error_events where resolved_at is null),
    'pending_deletions', (select count(*) from public.data_deletion_requests where status = 'pending'),
    'last_backup_check', (select max(created_at) from public.backup_verifications),
    'last_restore_test', (select max(restore_tested_at) from public.backup_verifications where restore_tested)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function public.get_security_reliability_snapshot() to authenticated;

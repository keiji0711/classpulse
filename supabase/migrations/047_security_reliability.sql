-- Security and reliability control plane.
-- Destructive retention execution is intentionally not automated in this release.

create table if not exists public.admin_security_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  mfa_required boolean not null default false,
  mfa_enrolled boolean not null default false,
  mfa_enrolled_at timestamptz,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.admin_security_profiles (user_id)
select id from public.users where role in ('super_admin', 'school_admin')
on conflict (user_id) do nothing;

create table if not exists public.security_login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  email text not null,
  success boolean not null,
  failure_reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_security_login_events_created on public.security_login_events(created_at desc);
create index if not exists idx_security_login_events_school on public.security_login_events(school_id, created_at desc);
create index if not exists idx_security_login_events_failed on public.security_login_events(created_at desc) where success = false;

create table if not exists public.user_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  device_id text not null,
  device_name text not null,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  unique (user_id, device_id)
);
create index if not exists idx_user_device_sessions_user on public.user_device_sessions(user_id, last_seen_at desc);

create table if not exists public.reliability_jobs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  job_type text not null,
  status text not null default 'failed' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error text,
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reliability_jobs_status on public.reliability_jobs(status, next_attempt_at, created_at);
create unique index if not exists idx_reliability_job_notification_unique
  on public.reliability_jobs ((payload->>'notification_log_id'))
  where job_type = 'attendance_push_retry';

create table if not exists public.application_error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  source text not null default 'web',
  severity text not null default 'error' check (severity in ('warning', 'error', 'critical')),
  message text not null,
  stack text,
  route text,
  context jsonb not null default '{}'::jsonb,
  occurrence_count integer not null default 1,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_application_errors_open on public.application_error_events(resolved_at, last_seen_at desc);

create table if not exists public.backup_verifications (
  id uuid primary key default gen_random_uuid(),
  backup_provider text not null default 'Supabase',
  backup_type text not null check (backup_type in ('scheduled', 'point_in_time', 'manual_export')),
  backup_timestamp timestamptz not null,
  restore_tested boolean not null default false,
  restore_tested_at timestamptz,
  result text not null check (result in ('passed', 'failed', 'partial')),
  evidence_reference text,
  notes text,
  verified_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  data_type text not null unique,
  retention_days integer not null check (retention_days between 30 and 3650),
  action text not null default 'delete' check (action in ('delete', 'anonymize', 'archive')),
  enabled boolean not null default false,
  legal_basis text,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.data_retention_policies (data_type, retention_days, action, enabled, legal_basis) values
  ('notification_logs', 365, 'delete', false, 'Operational delivery diagnostics'),
  ('security_login_events', 180, 'delete', false, 'Security investigation window'),
  ('application_error_events', 90, 'delete', false, 'Reliability diagnostics'),
  ('admin_audit_log', 730, 'archive', false, 'Administrative accountability')
on conflict (data_type) do nothing;

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  requester_user_id uuid references public.users(id) on delete set null,
  requester_email text not null,
  target_type text not null check (target_type in ('user', 'parent', 'student', 'school')),
  target_id uuid,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'scheduled', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_deletion_requests_status on public.data_deletion_requests(status, created_at desc);

alter table public.admin_security_profiles enable row level security;
alter table public.security_login_events enable row level security;
alter table public.user_device_sessions enable row level security;
alter table public.reliability_jobs enable row level security;
alter table public.application_error_events enable row level security;
alter table public.backup_verifications enable row level security;
alter table public.data_retention_policies enable row level security;
alter table public.data_deletion_requests enable row level security;

create policy "admins read own security profile" on public.admin_security_profiles for select
  using (user_id = auth.uid() or public.get_user_role() = 'super_admin');
create policy "super admins manage security profiles" on public.admin_security_profiles for all
  using (public.get_user_role() = 'super_admin') with check (public.get_user_role() = 'super_admin');

create policy "super admins read all login events" on public.security_login_events for select
  using (public.get_user_role() = 'super_admin');
create policy "school admins read school login events" on public.security_login_events for select
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

create policy "users read own devices" on public.user_device_sessions for select using (user_id = auth.uid());
create policy "super admins read all devices" on public.user_device_sessions for select using (public.get_user_role() = 'super_admin');

create policy "super admins read jobs" on public.reliability_jobs for select using (public.get_user_role() = 'super_admin');
create policy "school admins read school jobs" on public.reliability_jobs for select
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

create policy "authenticated users report errors" on public.application_error_events for insert
  with check (auth.uid() = user_id and school_id is not distinct from public.get_user_school_id());
create policy "super admins manage errors" on public.application_error_events for all
  using (public.get_user_role() = 'super_admin') with check (public.get_user_role() = 'super_admin');
create policy "school admins read school errors" on public.application_error_events for select
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

create policy "super admins manage backup checks" on public.backup_verifications for all
  using (public.get_user_role() = 'super_admin') with check (public.get_user_role() = 'super_admin');
create policy "super admins manage retention" on public.data_retention_policies for all
  using (public.get_user_role() = 'super_admin') with check (public.get_user_role() = 'super_admin');
create policy "super admins manage deletion requests" on public.data_deletion_requests for all
  using (public.get_user_role() = 'super_admin') with check (public.get_user_role() = 'super_admin');
create policy "school admins submit deletion requests" on public.data_deletion_requests for insert
  with check (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id() and requester_user_id = auth.uid());
create policy "school admins read deletion requests" on public.data_deletion_requests for select
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

create or replace function public.set_own_mfa_enrollment(p_enrolled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role() not in ('super_admin', 'school_admin') then
    raise exception 'Administrator account required';
  end if;
  insert into public.admin_security_profiles (user_id, mfa_enrolled, mfa_enrolled_at, updated_by, updated_at)
  values (auth.uid(), p_enrolled, case when p_enrolled then now() else null end, auth.uid(), now())
  on conflict (user_id) do update set
    mfa_enrolled = excluded.mfa_enrolled,
    mfa_enrolled_at = excluded.mfa_enrolled_at,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
end;
$$;
grant execute on function public.set_own_mfa_enrollment(boolean) to authenticated;

create or replace function public.set_admin_mfa_requirement(p_user_id uuid, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  if not exists (select 1 from public.users where id = p_user_id and role in ('super_admin', 'school_admin')) then
    raise exception 'Administrator not found';
  end if;
  insert into public.admin_security_profiles (user_id, mfa_required, updated_by, updated_at)
  values (p_user_id, p_required, auth.uid(), now())
  on conflict (user_id) do update set mfa_required = excluded.mfa_required, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.admin_audit_log(actor_id, actor_name, actor_email, action, target_type, target_id, target_label, details)
  select actor.id, actor.full_name, actor.email, 'security.mfa_requirement', 'user', target.id::text, target.email,
    jsonb_build_object('required', p_required)
  from public.users actor cross join public.users target where actor.id = auth.uid() and target.id = p_user_id;
end;
$$;
grant execute on function public.set_admin_mfa_requirement(uuid, boolean) to authenticated;

create or replace function public.register_device_session(p_device_id text, p_device_name text, p_user_agent text default null)
returns public.user_device_sessions language plpgsql security definer set search_path = public as $$
declare v_profile public.users%rowtype; v_result public.user_device_sessions%rowtype;
begin
  select * into v_profile from public.users where id = auth.uid();
  if v_profile.id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_device_id), '') is null then raise exception 'Device identifier required'; end if;
  insert into public.user_device_sessions(user_id, school_id, device_id, device_name, user_agent)
  values(v_profile.id, v_profile.school_id, left(trim(p_device_id), 200), left(trim(coalesce(p_device_name, 'Unknown device')), 200), left(p_user_agent, 1000))
  on conflict(user_id, device_id) do update set device_name = excluded.device_name, user_agent = excluded.user_agent,
    last_seen_at = now(), school_id = excluded.school_id
  returning * into v_result;
  return v_result;
end;
$$;
grant execute on function public.register_device_session(text, text, text) to authenticated;

create or replace function public.revoke_device_session(p_device_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.user_device_sessions set revoked_at = now(), revoked_by = auth.uid()
  where id = p_device_session_id and (user_id = auth.uid() or public.get_user_role() = 'super_admin');
  if not found then raise exception 'Device session not found'; end if;
end;
$$;
grant execute on function public.revoke_device_session(uuid) to authenticated;

create or replace function public.resolve_application_error(p_error_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  update public.application_error_events set resolved_at = now(), resolved_by = auth.uid() where id = p_error_id;
end;
$$;
grant execute on function public.resolve_application_error(uuid) to authenticated;

create or replace function public.get_retention_preview()
returns table(data_type text, retention_days integer, enabled boolean, eligible_rows bigint)
language plpgsql security definer stable set search_path = public as $$
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  return query
  select p.data_type, p.retention_days, p.enabled,
    case p.data_type
      when 'notification_logs' then (select count(*) from public.notification_logs n where n.created_at < now() - make_interval(days => p.retention_days))
      when 'security_login_events' then (select count(*) from public.security_login_events e where e.created_at < now() - make_interval(days => p.retention_days))
      when 'application_error_events' then (select count(*) from public.application_error_events e where e.created_at < now() - make_interval(days => p.retention_days))
      when 'admin_audit_log' then (select count(*) from public.admin_audit_log a where a.created_at < now() - make_interval(days => p.retention_days))
      else 0
    end::bigint
  from public.data_retention_policies p order by p.data_type;
end;
$$;
grant execute on function public.get_retention_preview() to authenticated;

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
    'push_failures_24h', (select count(*) from public.notification_logs where status = 'failed' and created_at >= now() - interval '24 hours'),
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

-- Convert retryable failed attendance pushes into visible jobs. The original
-- notification record remains the source of truth and no token is stored here.
create or replace function public.queue_failed_attendance_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and new.type = 'attendance_push' and new.attendance_record_id is not null then
    insert into public.reliability_jobs(school_id, job_type, status, payload, last_error)
    values(new.school_id, 'attendance_push_retry', 'failed', jsonb_build_object('notification_log_id', new.id, 'attendance_record_id', new.attendance_record_id), new.error_message)
    on conflict ((payload->>'notification_log_id')) where job_type = 'attendance_push_retry' do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists queue_failed_attendance_push_trigger on public.notification_logs;
create trigger queue_failed_attendance_push_trigger after insert on public.notification_logs
for each row execute function public.queue_failed_attendance_push();

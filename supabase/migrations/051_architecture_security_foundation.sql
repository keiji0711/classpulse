-- ClassPulse architecture hardening: tenant privacy, platform authorization,
-- administrator MFA enforcement, explicit guardian families, and distributed
-- parent-auth throttling.

-- ---------------------------------------------------------------------------
-- 1. Parent data is never directly public. Parent clients use authenticated
--    Edge Functions whose service-role reads are scoped to token relationships.
-- ---------------------------------------------------------------------------
drop policy if exists "anon_select_attendance" on public.attendance_records;
drop policy if exists "anon_select_messages" on public.messages;
drop policy if exists "anon_select_grades" on public.grades;
drop policy if exists "anon_read_own_parent_sub" on public.parent_subscriptions;
drop policy if exists "anon_read_academic_years" on public.academic_years;
drop policy if exists "anon_read_enrollments" on public.student_enrollments;

-- Migration 058 replaces the legacy anonymous schools-table policy with a
-- column-narrow list_login_schools() directory for the login picker.

-- ---------------------------------------------------------------------------
-- 2. Platform authorization and MFA are enforced below the React router.
-- ---------------------------------------------------------------------------
create or replace function public.current_auth_aal()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'super_admin'
      and u.is_platform_owner = true
      and public.current_auth_aal() = 'aal2'
  );
$$;

create or replace function public.has_platform_permission(p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'super_admin'
      and public.current_auth_aal() = 'aal2'
      and (u.is_platform_owner = true or p_permission = any(u.permissions))
  );
$$;

-- All existing policies and SECURITY DEFINER functions that call
-- get_user_role() now receive "platform_staff" for a scoped staff account,
-- instead of accidentally granting it owner-level super_admin authority.
-- Administrators marked as MFA-required receive no operational role until the
-- current JWT has aal2.
create or replace function public.get_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when u.role in ('super_admin', 'school_admin')
      and coalesce(s.mfa_required, false)
      and public.current_auth_aal() <> 'aal2'
      then 'mfa_pending'
    when u.role = 'super_admin' and not coalesce(u.is_platform_owner, false)
      then 'platform_staff'
    else u.role
  end
  from public.users u
  left join public.admin_security_profiles s on s.user_id = u.id
  where u.id = auth.uid();
$$;

-- MFA is mandatory for current and future platform/school administrators.
insert into public.admin_security_profiles(user_id, mfa_required)
select id, true from public.users where role in ('super_admin', 'school_admin')
on conflict(user_id) do update set mfa_required = true, updated_at = now();

create or replace function public.ensure_admin_security_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('super_admin', 'school_admin') then
    insert into public.admin_security_profiles(user_id, mfa_required)
    values(new.id, true)
    on conflict(user_id) do update set mfa_required = true, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_admin_security_profile_trigger on public.users;
create trigger ensure_admin_security_profile_trigger
after insert or update of role on public.users
for each row execute function public.ensure_admin_security_profile();

-- Scoped platform staff receive read access only to explicitly granted areas.
-- Mutations remain owner-only through the existing super_admin policies, which
-- now depend on the hardened get_user_role().
drop policy if exists "platform staff read schools" on public.schools;
create policy "platform staff read schools" on public.schools for select
  using (public.has_platform_permission('schools'));

drop policy if exists "platform staff read school admins" on public.users;
create policy "platform staff read school admins" on public.users for select
  using (
    public.has_platform_permission('school_admins')
    and role = 'school_admin'
  );

drop policy if exists "platform staff read support threads" on public.support_threads;
create policy "platform staff read support threads" on public.support_threads for select
  using (public.has_platform_permission('support'));

drop policy if exists "platform staff read support messages" on public.support_messages;
create policy "platform staff read support messages" on public.support_messages for select
  using (public.has_platform_permission('support'));

drop policy if exists "platform staff read audit log" on public.admin_audit_log;
create policy "platform staff read audit log" on public.admin_audit_log for select
  using (public.has_platform_permission('audit'));

drop policy if exists "support_threads_super_admin_all" on public.support_threads;
create policy "platform owners manage support threads" on public.support_threads for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "support_messages_super_admin_all" on public.support_messages;
create policy "platform owners manage support messages" on public.support_messages for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "audit_super_admin_read" on public.admin_audit_log;
create policy "platform owners read audit log" on public.admin_audit_log for select
  using (public.is_platform_owner());

-- Replace policies that inspected users.role directly and therefore bypassed
-- the hardened role helper.
drop policy if exists "super admins read notification logs" on public.notification_logs;
drop policy if exists "super_admin_notification_logs" on public.notification_logs;
drop policy if exists "super_admin_all_notification_logs" on public.notification_logs;
create policy "platform owners read notification logs" on public.notification_logs for select
  using (public.is_platform_owner());

drop policy if exists "super admins read all login events" on public.security_login_events;
create policy "platform owners read all login events" on public.security_login_events for select
  using (public.is_platform_owner());

drop policy if exists "super admins read all devices" on public.user_device_sessions;
create policy "platform owners read all devices" on public.user_device_sessions for select
  using (public.is_platform_owner());

-- ---------------------------------------------------------------------------
-- 3. Explicit guardian-family relationships replace guardian-name matching.
-- ---------------------------------------------------------------------------
alter table public.parents add column if not exists family_id uuid;
update public.parents set family_id = gen_random_uuid() where family_id is null;
alter table public.parents alter column family_id set default gen_random_uuid();
alter table public.parents alter column family_id set not null;
create index if not exists idx_parents_family on public.parents(school_id, family_id);

create or replace function public.link_parent_family(p_parent_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_school_id uuid;
  v_family_id uuid := gen_random_uuid();
  v_expected integer;
  v_updated integer;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or public.get_user_role() not in ('school_admin', 'super_admin') then
    raise exception 'Administrator access with MFA is required';
  end if;
  if coalesce(array_length(p_parent_ids, 1), 0) < 2 then
    raise exception 'Select at least two guardian records';
  end if;

  v_expected := array_length(p_parent_ids, 1);
  select school_id into v_school_id
  from public.parents where id = any(p_parent_ids)
  limit 1;

  if v_school_id is null
     or (v_actor.role = 'school_admin' and v_school_id <> v_actor.school_id)
     or exists(select 1 from public.parents where id = any(p_parent_ids) and school_id <> v_school_id)
     or (select count(*) from public.parents where id = any(p_parent_ids)) <> v_expected then
    raise exception 'Guardian records must exist in the same authorized school';
  end if;

  update public.parents set family_id = v_family_id where id = any(p_parent_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then raise exception 'Not all guardian records were linked'; end if;

  insert into public.admin_audit_log(
    actor_id, actor_name, actor_email, action, target_type, target_id,
    target_label, details
  ) values (
    v_actor.id, v_actor.full_name, v_actor.email, 'guardian.family_linked',
    'guardian_family', v_family_id::text, 'Linked guardian family',
    jsonb_build_object('parent_ids', p_parent_ids, 'school_id', v_school_id)
  );
  return v_family_id;
end;
$$;
revoke all on function public.link_parent_family(uuid[]) from public, anon;
grant execute on function public.link_parent_family(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Distributed, atomic parent-login throttling.
-- ---------------------------------------------------------------------------
create table if not exists public.parent_auth_rate_limits (
  key_hash text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.parent_auth_rate_limits enable row level security;
revoke all on public.parent_auth_rate_limits from anon, authenticated;

create or replace function public.consume_parent_auth_attempt(
  p_key_hash text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 300,
  p_block_seconds integer default 900
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parent_auth_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash is null or length(p_key_hash) <> 64 then
    raise exception 'Invalid rate-limit key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select * into v_row from public.parent_auth_rate_limits where key_hash = p_key_hash for update;

  if v_row.key_hash is null then
    insert into public.parent_auth_rate_limits(key_hash, attempt_count, window_started_at, updated_at)
    values(p_key_hash, 1, v_now, v_now);
    return query select true, 0;
    return;
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.parent_auth_rate_limits
    set attempt_count = 1, window_started_at = v_now, blocked_until = null, updated_at = v_now
    where key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if v_row.attempt_count + 1 > p_max_attempts then
    update public.parent_auth_rate_limits
    set attempt_count = attempt_count + 1,
        blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    where key_hash = p_key_hash;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.parent_auth_rate_limits
  set attempt_count = attempt_count + 1, updated_at = v_now
  where key_hash = p_key_hash;
  return query select true, 0;
end;
$$;

create or replace function public.clear_parent_auth_attempts(p_key_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.parent_auth_rate_limits where key_hash = p_key_hash;
$$;

revoke all on function public.consume_parent_auth_attempt(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_parent_auth_attempts(text) from public, anon, authenticated;
grant execute on function public.consume_parent_auth_attempt(text, integer, integer, integer) to service_role;
grant execute on function public.clear_parent_auth_attempts(text) to service_role;

-- Keep the throttle table bounded without requiring destructive application
-- code. The reliability scheduler added by the next migration calls this.
create or replace function public.cleanup_parent_auth_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from public.parent_auth_rate_limits
  where updated_at < now() - interval '2 days'
    and (blocked_until is null or blocked_until < now());
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_parent_auth_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_parent_auth_rate_limits() to service_role;

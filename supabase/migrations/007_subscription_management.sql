-- ============================================
-- Subscription Management (Manual Payment Ready)
-- ============================================

-- Plans catalog
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  monthly_price numeric(10,2) not null default 0,
  features jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Add optional columns if table already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'features'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN features jsonb not null default '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'limits'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN limits jsonb not null default '{}'::jsonb;
  END IF;
END $$;

-- School subscriptions (manual payment workflow)
create table if not exists public.school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status text not null check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')) default 'trialing',
  started_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  manual_payment_reference text,
  paid_at timestamptz,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique (school_id)
);

-- Feature overrides per school
create table if not exists public.school_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null,
  limit_override int,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (school_id, feature_key)
);

create index if not exists idx_school_subscriptions_school_id on public.school_subscriptions(school_id);
create index if not exists idx_school_subscriptions_status on public.school_subscriptions(status);
create index if not exists idx_school_feature_overrides_school_id on public.school_feature_overrides(school_id);

-- Seed default plans (manual billing compatible)
insert into public.plans (code, name, description, monthly_price, features, limits, is_active)
values
  (
    'starter',
    'Starter',
    'Manual payment starter plan',
    0,
    '{"attendance_take": true, "grades_manage": true, "exports_download": false, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
    '{"max_students": 200, "max_instructors": 15}'::jsonb,
    true
  ),
  (
    'growth',
    'Growth',
    'Manual payment growth plan',
    0,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
    '{"max_students": 1000, "max_instructors": 80}'::jsonb,
    true
  ),
  (
    'premium',
    'Premium',
    'Manual payment premium plan',
    0,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
    '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
    true
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  features = excluded.features,
  limits = excluded.limits,
  is_active = excluded.is_active;

-- RLS
alter table public.plans enable row level security;
alter table public.school_subscriptions enable row level security;
alter table public.school_feature_overrides enable row level security;

drop policy if exists "super_admin_manage_plans" on public.plans;
create policy "super_admin_manage_plans" on public.plans
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "authenticated_read_plans" on public.plans;
create policy "authenticated_read_plans" on public.plans
  for select using (auth.uid() is not null);

drop policy if exists "super_admin_manage_subscriptions" on public.school_subscriptions;
create policy "super_admin_manage_subscriptions" on public.school_subscriptions
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_users_read_own_subscription" on public.school_subscriptions;
create policy "school_users_read_own_subscription" on public.school_subscriptions
  for select using (
    school_id = public.get_user_school_id()
    and public.get_user_role() in ('school_admin', 'instructor')
  );

drop policy if exists "super_admin_manage_feature_overrides" on public.school_feature_overrides;
create policy "super_admin_manage_feature_overrides" on public.school_feature_overrides
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_users_read_own_feature_overrides" on public.school_feature_overrides;
create policy "school_users_read_own_feature_overrides" on public.school_feature_overrides
  for select using (
    school_id = public.get_user_school_id()
    and public.get_user_role() in ('school_admin', 'instructor')
  );

-- Build effective entitlement object for UI and policy checks
create or replace function public.get_school_entitlements(p_school_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_school_id uuid;
  v_status text;
  v_plan_code text;
  v_plan_name text;
  v_features jsonb := '{}'::jsonb;
  v_limits jsonb := '{}'::jsonb;
  v_overrides jsonb := '{}'::jsonb;
  v_grace_until timestamptz;
  v_current_period_end timestamptz;
  v_has_access boolean := false;
begin
  v_role := public.get_user_role();

  if p_school_id is not null then
    v_school_id := p_school_id;
  else
    v_school_id := public.get_user_school_id();
  end if;

  -- Non-super-admin users can only request their own school entitlement.
  if v_role <> 'super_admin' and p_school_id is not null and p_school_id <> public.get_user_school_id() then
    return jsonb_build_object(
      'school_id', p_school_id,
      'status', 'inactive',
      'has_access', false,
      'plan_code', null,
      'plan_name', null,
      'features', '{}'::jsonb,
      'limits', '{}'::jsonb,
      'grace_until', null,
      'current_period_end', null
    );
  end if;

  if v_role = 'super_admin' and p_school_id is null then
    return jsonb_build_object(
      'school_id', null,
      'status', 'active',
      'has_access', true,
      'plan_code', 'super_admin',
      'plan_name', 'Super Admin',
      'features', jsonb_build_object(
        'attendance_take', true,
        'grades_manage', true,
        'exports_download', true,
        'parent_messaging', true,
        'analytics_advanced', true
      ),
      'limits', '{}'::jsonb,
      'grace_until', null,
      'current_period_end', null
    );
  end if;

  if v_school_id is null then
    return jsonb_build_object(
      'school_id', null,
      'status', 'inactive',
      'has_access', false,
      'plan_code', null,
      'plan_name', null,
      'features', '{}'::jsonb,
      'limits', '{}'::jsonb,
      'grace_until', null,
      'current_period_end', null
    );
  end if;

  select
    coalesce(ss.status, 'trialing'),
    ss.grace_until,
    ss.current_period_end,
    p.code,
    p.name,
    coalesce(p.features, '{}'::jsonb),
    coalesce(p.limits, '{}'::jsonb)
  into
    v_status,
    v_grace_until,
    v_current_period_end,
    v_plan_code,
    v_plan_name,
    v_features,
    v_limits
  from public.schools sc
  left join public.school_subscriptions ss on ss.school_id = sc.id
  left join public.plans p on p.id = ss.plan_id
  where sc.id = v_school_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'school_id', v_school_id,
      'status', 'inactive',
      'has_access', false,
      'plan_code', null,
      'plan_name', null,
      'features', '{}'::jsonb,
      'limits', '{}'::jsonb,
      'grace_until', null,
      'current_period_end', null
    );
  end if;

  -- If no subscription/plan is linked yet, use default manual starter behavior
  if v_plan_code is null then
    v_plan_code := 'manual_default';
    v_plan_name := 'Manual Default';
    v_features := jsonb_build_object(
      'attendance_take', true,
      'grades_manage', true,
      'exports_download', false,
      'parent_messaging', true,
      'analytics_advanced', false
    );
    v_limits := jsonb_build_object('max_students', 200, 'max_instructors', 15);
  end if;

  select coalesce(jsonb_object_agg(feature_key, to_jsonb(enabled)), '{}'::jsonb)
  into v_overrides
  from public.school_feature_overrides
  where school_id = v_school_id;

  v_features := v_features || v_overrides;

  v_has_access := case
    when v_status in ('active', 'trialing') then true
    when v_status = 'past_due' and (v_grace_until is null or v_grace_until >= now()) then true
    else false
  end;

  return jsonb_build_object(
    'school_id', v_school_id,
    'status', v_status,
    'has_access', v_has_access,
    'plan_code', v_plan_code,
    'plan_name', v_plan_name,
    'features', v_features,
    'limits', v_limits,
    'grace_until', v_grace_until,
    'current_period_end', v_current_period_end
  );
end;
$$;

create or replace function public.current_user_has_feature(p_feature_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_ent jsonb;
  v_enabled text;
begin
  v_role := public.get_user_role();
  if v_role = 'super_admin' then
    return true;
  end if;

  v_ent := public.get_school_entitlements(null);

  if coalesce((v_ent->>'has_access')::boolean, false) = false then
    return false;
  end if;

  v_enabled := v_ent->'features'->>p_feature_key;
  return coalesce(v_enabled::boolean, false);
exception
  when others then
    return false;
end;
$$;

-- Split instructor attendance policies into read vs write + feature gate

drop policy if exists "instructor_manage_attendance" on public.attendance_records;
drop policy if exists "instructor_read_own_attendance" on public.attendance_records;
drop policy if exists "instructor_insert_attendance" on public.attendance_records;
drop policy if exists "instructor_update_attendance" on public.attendance_records;
drop policy if exists "instructor_delete_attendance" on public.attendance_records;

create policy "instructor_read_own_attendance" on public.attendance_records
  for select using (
    public.get_user_role() = 'instructor'
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
        and schedules.instructor_id = auth.uid()
    )
  );

create policy "instructor_insert_attendance" on public.attendance_records
  for insert with check (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('attendance_take')
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
        and schedules.instructor_id = auth.uid()
    )
  );

create policy "instructor_update_attendance" on public.attendance_records
  for update using (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('attendance_take')
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
        and schedules.instructor_id = auth.uid()
    )
  )
  with check (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('attendance_take')
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
        and schedules.instructor_id = auth.uid()
    )
  );

create policy "instructor_delete_attendance" on public.attendance_records
  for delete using (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('attendance_take')
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
        and schedules.instructor_id = auth.uid()
    )
  );

-- Split instructor grades policies into read vs write + feature gate

drop policy if exists "instructor_manage_grades" on public.grades;
drop policy if exists "instructor_read_own_grades" on public.grades;
drop policy if exists "instructor_insert_grades" on public.grades;
drop policy if exists "instructor_update_grades" on public.grades;
drop policy if exists "instructor_delete_grades" on public.grades;

create policy "instructor_read_own_grades" on public.grades
  for select using (
    public.get_user_role() = 'instructor'
    and created_by = auth.uid()
  );

create policy "instructor_insert_grades" on public.grades
  for insert with check (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('grades_manage')
    and created_by = auth.uid()
  );

create policy "instructor_update_grades" on public.grades
  for update using (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('grades_manage')
    and created_by = auth.uid()
  )
  with check (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('grades_manage')
    and created_by = auth.uid()
  );

create policy "instructor_delete_grades" on public.grades
  for delete using (
    public.get_user_role() = 'instructor'
    and public.current_user_has_feature('grades_manage')
    and created_by = auth.uid()
  );

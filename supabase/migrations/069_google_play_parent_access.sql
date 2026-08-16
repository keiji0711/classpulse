-- Verified Google Play subscriptions are additive to the existing cash and
-- waived monthly access records. A single subscription belongs to a guardian
-- family and therefore covers every linked student in that family.

create table if not exists public.parent_access_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  family_id uuid not null,
  app_user_id text not null,
  provider text not null default 'google_play' check (provider in ('google_play')),
  entitlement_id text not null,
  product_id text,
  status text not null check (status in ('active', 'inactive')),
  original_transaction_id text,
  latest_transaction_id text,
  purchased_at timestamptz,
  expires_at timestamptz,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_access_subscriptions_app_user_unique
    unique (app_user_id, entitlement_id),
  constraint parent_access_subscriptions_family_unique
    unique (family_id, provider, entitlement_id)
);

create index if not exists idx_parent_access_subscriptions_active_family
  on public.parent_access_subscriptions (family_id, expires_at)
  where status = 'active';

alter table public.parent_access_subscriptions enable row level security;

create or replace function public.parent_access_is_enabled(
  p_student_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_school_id uuid;
  v_manual_enabled boolean := true;
  v_billing_enabled boolean := false;
  v_grace_days integer := 5;
  v_month date := public.parent_billing_month(p_at);
  v_local_day integer := extract(day from (p_at at time zone 'Asia/Manila'))::integer;
  v_status text;
  v_google_play_active boolean := false;
begin
  select school_id into v_school_id from public.students where id = p_student_id;
  if v_school_id is null then return false; end if;

  select enabled into v_manual_enabled
  from public.student_notification_preferences
  where student_id = p_student_id;
  v_manual_enabled := coalesce(v_manual_enabled, true);
  if not v_manual_enabled then return false; end if;

  select exists (
    select 1
    from public.parents parent
    join public.parent_access_subscriptions subscription
      on subscription.family_id = parent.family_id
      and subscription.school_id = parent.school_id
    where parent.student_id = p_student_id
      and parent.school_id = v_school_id
      and subscription.provider = 'google_play'
      and subscription.entitlement_id = 'parent_access'
      and subscription.status = 'active'
      and (subscription.expires_at is null or subscription.expires_at > p_at)
  ) into v_google_play_active;
  if v_google_play_active then return true; end if;

  select billing_enabled, grace_days
  into v_billing_enabled, v_grace_days
  from public.parent_access_billing_settings
  where school_id = v_school_id;

  if not found or not coalesce(v_billing_enabled, false) then
    return true;
  end if;

  select status into v_status
  from public.parent_access_payments
  where student_id = p_student_id and billing_month = v_month;

  if v_status in ('paid', 'waived') then return true; end if;
  if v_status = 'refunded' then return false; end if;

  return v_local_day <= coalesce(v_grace_days, 5);
end;
$$;

revoke all on function public.parent_access_is_enabled(uuid, timestamptz) from public;
grant execute on function public.parent_access_is_enabled(uuid, timestamptz)
  to authenticated, service_role;

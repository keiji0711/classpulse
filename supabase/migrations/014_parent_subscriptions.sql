-- ============================================
-- Parent Subscriptions
-- ₱50/month — all features
-- (Idempotent — safe to re-run)
-- ============================================

create table if not exists public.parent_subscriptions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'expired', 'canceled')),
  plan_amount numeric(10,2) not null default 50.00,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  payment_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, student_id)
);

-- Indexes
create index if not exists idx_parent_subs_parent_id on public.parent_subscriptions(parent_id);
create index if not exists idx_parent_subs_student_id on public.parent_subscriptions(student_id);
create index if not exists idx_parent_subs_status on public.parent_subscriptions(status);

-- RLS
alter table public.parent_subscriptions enable row level security;

-- Super admin can do everything
drop policy if exists "super_admin_all_parent_subs" on public.parent_subscriptions;
create policy "super_admin_all_parent_subs" on public.parent_subscriptions
  for all using (public.get_user_role() = 'super_admin');

-- School admin can read/update subscriptions for their school's students
drop policy if exists "school_admin_parent_subs" on public.parent_subscriptions;
create policy "school_admin_parent_subs" on public.parent_subscriptions
  for all using (
    public.get_user_role() = 'school_admin'
    and student_id in (
      select id from public.students where school_id = public.get_user_school_id()
    )
  );

-- Enable realtime
alter table public.parent_subscriptions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and tablename = 'parent_subscriptions'
  ) then
    alter publication supabase_realtime add table public.parent_subscriptions;
  end if;
end $$;

-- Anon users can read their own subscription (for mobile app)
drop policy if exists "anon_read_own_parent_sub" on public.parent_subscriptions;
create policy "anon_read_own_parent_sub" on public.parent_subscriptions
  for select using (true);

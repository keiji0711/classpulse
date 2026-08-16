-- ============================================================
-- Billing Invoices
-- Stores generated invoices per school for manual-payment tracking
-- ============================================================

-- Invoice records
create table if not exists public.school_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  invoice_number text not null,
  billing_period_start date not null,
  billing_period_end date not null,
  student_count integer not null default 0,
  rate_per_student numeric(10,2),
  minimum_monthly numeric(10,2),
  subtotal numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  plan_name text,
  billing_model text not null default 'per_student',
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  notes text not null default '',
  payment_reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint school_invoices_number_unique unique (invoice_number)
);

-- RLS
alter table public.school_invoices enable row level security;

drop policy if exists "Super admins manage all invoices" on public.school_invoices;
create policy "Super admins manage all invoices"
  on public.school_invoices for all
  using ((select role from public.users where id = auth.uid()) = 'super_admin')
  with check ((select role from public.users where id = auth.uid()) = 'super_admin');

-- Helper: student count per school (bypasses RLS via SECURITY DEFINER)
create or replace function public.get_student_counts_by_school()
returns table (school_id uuid, student_count bigint)
language sql
security definer
set search_path = public
as $$
  select school_id, count(*) as student_count
  from public.students
  group by school_id;
$$;

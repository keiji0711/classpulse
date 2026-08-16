-- ============================================================
-- Email Logs
-- Stores all email sending events for auditing and debugging
-- ============================================================

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed', 'bounced')) default 'sent',
  error_message text,
  school_id uuid references public.schools(id) on delete set null,
  invoice_id uuid references public.school_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists idx_email_logs_school_id on public.email_logs(school_id);
create index if not exists idx_email_logs_invoice_id on public.email_logs(invoice_id);
create index if not exists idx_email_logs_status on public.email_logs(status);
create index if not exists idx_email_logs_created_at on public.email_logs(created_at);

-- RLS: Super admins can read all email logs
alter table public.email_logs enable row level security;

drop policy if exists "Super admins read all email logs" on public.email_logs;
create policy "Super admins read all email logs"
  on public.email_logs for select
  using ((select role from public.users where id = auth.uid()) = 'super_admin');

drop policy if exists "School admins read their email logs" on public.email_logs;
create policy "School admins read their email logs"
  on public.email_logs for select
  using (
    school_id in (
      select school_id from public.users where id = auth.uid()
    )
  );

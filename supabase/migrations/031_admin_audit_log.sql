-- ═══════════════════════════════════════════════════════════════════════
-- Admin Audit Log
-- Records sensitive platform actions (staff management, support replies, …).
-- Written only by edge functions (service role) so entries can't be forged or
-- edited from the client. Super admins can read.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  actor_email text,
  action text not null,          -- e.g. 'staff.create', 'staff.update', 'staff.remove', 'support.reply'
  target_type text,              -- e.g. 'staff', 'support_thread'
  target_id text,
  target_label text,             -- human-readable target (name / email / school)
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_created on public.admin_audit_log(created_at desc);
create index if not exists idx_admin_audit_action on public.admin_audit_log(action);
create index if not exists idx_admin_audit_actor on public.admin_audit_log(actor_id);

alter table public.admin_audit_log enable row level security;

-- Super admins read all; no client writes (service role only).
drop policy if exists "audit_super_admin_read" on public.admin_audit_log;
create policy "audit_super_admin_read" on public.admin_audit_log
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  );

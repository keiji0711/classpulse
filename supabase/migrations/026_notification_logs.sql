-- ============================================
-- Notification Logs — Track push delivery
-- ============================================

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  schedule_id uuid references public.schedules(id) on delete cascade,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  type text not null default 'attendance_push',
  status text not null check (status in ('delivered', 'failed', 'no_token', 'skipped')),
  fcm_token_preview text,          -- last 8 chars for debugging
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_logs_school on public.notification_logs(school_id);
create index if not exists idx_notification_logs_student on public.notification_logs(student_id);
create index if not exists idx_notification_logs_created on public.notification_logs(created_at);
create index if not exists idx_notification_logs_status on public.notification_logs(status);

-- RLS
alter table public.notification_logs enable row level security;

-- Super admin reads all
drop policy if exists "super_admin_all_notification_logs" on public.notification_logs;
create policy "super_admin_all_notification_logs" on public.notification_logs
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  );

-- School admin reads own school
drop policy if exists "school_admin_read_notification_logs" on public.notification_logs;
create policy "school_admin_read_notification_logs" on public.notification_logs
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'school_admin' and school_id = notification_logs.school_id)
  );

-- Service role can insert (edge functions)
-- (service_role bypasses RLS, so no policy needed for inserts from edge functions)

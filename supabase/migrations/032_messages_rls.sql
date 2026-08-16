-- ═══════════════════════════════════════════════════════════════════════
-- SECURITY FIX: enable RLS on public.messages
-- This table was created (005) without RLS, leaving it readable/writable by
-- anyone holding the public anon key. All legitimate access goes through
-- service-role edge functions (get-student-feed, send-message) which bypass
-- RLS, plus role-based access for staff below. Parents are unaffected (they
-- read via the feed function and are alerted by push notifications).
-- ═══════════════════════════════════════════════════════════════════════

alter table public.messages enable row level security;

drop policy if exists "messages_super_admin_all" on public.messages;
create policy "messages_super_admin_all" on public.messages
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "messages_school_admin_read" on public.messages;
create policy "messages_school_admin_read" on public.messages
  for select using (
    public.get_user_role() = 'school_admin'
    and exists (
      select 1 from public.students s
      where s.id = messages.student_id and s.school_id = public.get_user_school_id()
    )
  );

drop policy if exists "messages_instructor_own" on public.messages;
create policy "messages_instructor_own" on public.messages
  for select using (
    public.get_user_role() = 'instructor' and instructor_id = auth.uid()
  );

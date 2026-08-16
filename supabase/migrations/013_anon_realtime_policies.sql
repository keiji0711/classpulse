-- Allow the anon role to SELECT from tables used by mobile realtime subscriptions.
-- The mobile app connects with the anon key (custom auth, not Supabase Auth),
-- so Supabase Realtime needs anon SELECT policies to deliver postgres_changes events.

-- attendance_records: parent mobile app listens for attendance updates
drop policy if exists "anon_select_attendance" on public.attendance_records;
create policy "anon_select_attendance" on public.attendance_records
  for select
  to anon
  using (true);

-- messages: parent mobile app listens for new instructor messages
drop policy if exists "anon_select_messages" on public.messages;
create policy "anon_select_messages" on public.messages
  for select
  to anon
  using (true);

-- grades: parent mobile app listens for grade updates
drop policy if exists "anon_select_grades" on public.grades;
create policy "anon_select_grades" on public.grades
  for select
  to anon
  using (true);

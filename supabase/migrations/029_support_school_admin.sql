-- ═══════════════════════════════════════════════════════════════════════
-- Extend Support Chat to school admins.
-- School admins authenticate via Supabase Auth (users table), so they reuse
-- the instructor_user_id column as the owning user id. sender_role
-- distinguishes 'instructor' vs 'school_admin'. One thread per user is still
-- enforced by support_threads_instructor_unique (instructor_user_id).
-- ═══════════════════════════════════════════════════════════════════════

-- ── Broaden the role checks ───────────────────────────────────────────
alter table public.support_threads drop constraint if exists support_threads_sender_role_check;
alter table public.support_threads
  add constraint support_threads_sender_role_check
  check (sender_role in ('parent', 'instructor', 'school_admin'));

alter table public.support_threads drop constraint if exists support_threads_one_sender;
alter table public.support_threads
  add constraint support_threads_one_sender check (
    (sender_role = 'parent' and parent_id is not null and instructor_user_id is null)
    or (sender_role in ('instructor', 'school_admin') and instructor_user_id is not null and parent_id is null)
  );

alter table public.support_messages drop constraint if exists support_messages_sender_role_check;
alter table public.support_messages
  add constraint support_messages_sender_role_check
  check (sender_role in ('parent', 'instructor', 'school_admin', 'super_admin'));

-- ── RLS for school admins ─────────────────────────────────────────────
-- (Reads of their own thread messages and thread updates are already covered
--  by the instructor policies, which key on instructor_user_id = auth.uid()
--  without a role check. We add the school_admin-specific read/insert below.)

drop policy if exists "support_threads_school_admin_read" on public.support_threads;
create policy "support_threads_school_admin_read"
  on public.support_threads for select
  using (
    instructor_user_id = auth.uid()
    and exists (select 1 from public.users where id = auth.uid() and role = 'school_admin')
  );

drop policy if exists "support_threads_school_admin_insert" on public.support_threads;
create policy "support_threads_school_admin_insert"
  on public.support_threads for insert
  with check (
    sender_role = 'school_admin'
    and instructor_user_id = auth.uid()
    and exists (select 1 from public.users where id = auth.uid() and role = 'school_admin')
  );

drop policy if exists "support_messages_school_admin_insert" on public.support_messages;
create policy "support_messages_school_admin_insert"
  on public.support_messages for insert
  with check (
    sender_role = 'school_admin'
    and exists (
      select 1 from public.support_threads t
      where t.id = thread_id and t.instructor_user_id = auth.uid()
    )
  );

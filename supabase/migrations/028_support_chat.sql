-- ═══════════════════════════════════════════════════════════════════════
-- Support Chat: parents and instructors can message the super admin.
-- One thread per (parent_id) or (instructor_user_id). New messages append.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  -- Exactly one of these is set, depending on sender_role.
  parent_id uuid references public.parents(id) on delete cascade,
  instructor_user_id uuid references public.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('parent', 'instructor')),
  sender_name text not null,
  sender_email text,
  subject text not null default 'Support request',
  status text not null default 'open' check (status in ('open', 'closed')),
  unread_for_admin boolean not null default true,
  unread_for_user boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  constraint support_threads_one_sender check (
    (sender_role = 'parent' and parent_id is not null and instructor_user_id is null)
    or (sender_role = 'instructor' and instructor_user_id is not null and parent_id is null)
  )
);

create unique index if not exists support_threads_parent_unique
  on public.support_threads(parent_id) where parent_id is not null;
create unique index if not exists support_threads_instructor_unique
  on public.support_threads(instructor_user_id) where instructor_user_id is not null;
create index if not exists support_threads_status_idx
  on public.support_threads(status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_role text not null check (sender_role in ('parent', 'instructor', 'super_admin')),
  sender_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx
  on public.support_messages(thread_id, created_at);

-- ── Realtime ──────────────────────────────────────────────────────────
alter table public.support_threads replica identity full;
alter table public.support_messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_threads'
  ) then
    alter publication supabase_realtime add table public.support_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- super_admin: full access
drop policy if exists "support_threads_super_admin_all" on public.support_threads;
create policy "support_threads_super_admin_all"
  on public.support_threads for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  );

drop policy if exists "support_messages_super_admin_all" on public.support_messages;
create policy "support_messages_super_admin_all"
  on public.support_messages for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  );

-- instructor: read/insert own thread (instructors authenticate via supabase auth)
drop policy if exists "support_threads_instructor_read" on public.support_threads;
create policy "support_threads_instructor_read"
  on public.support_threads for select
  using (
    instructor_user_id = auth.uid()
    and exists (select 1 from public.users where id = auth.uid() and role = 'instructor')
  );

drop policy if exists "support_threads_instructor_insert" on public.support_threads;
create policy "support_threads_instructor_insert"
  on public.support_threads for insert
  with check (
    sender_role = 'instructor'
    and instructor_user_id = auth.uid()
    and exists (select 1 from public.users where id = auth.uid() and role = 'instructor')
  );

drop policy if exists "support_threads_instructor_update" on public.support_threads;
create policy "support_threads_instructor_update"
  on public.support_threads for update
  using (instructor_user_id = auth.uid())
  with check (instructor_user_id = auth.uid());

drop policy if exists "support_messages_instructor_read" on public.support_messages;
create policy "support_messages_instructor_read"
  on public.support_messages for select
  using (
    exists (
      select 1 from public.support_threads t
      where t.id = thread_id and t.instructor_user_id = auth.uid()
    )
  );

drop policy if exists "support_messages_instructor_insert" on public.support_messages;
create policy "support_messages_instructor_insert"
  on public.support_messages for insert
  with check (
    sender_role = 'instructor'
    and exists (
      select 1 from public.support_threads t
      where t.id = thread_id and t.instructor_user_id = auth.uid()
    )
  );

-- Parents access via edge functions (service role); no public RLS needed.

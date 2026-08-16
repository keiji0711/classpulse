-- Messages table for instructor-to-parent messaging
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  instructor_id uuid references public.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);

-- Index for querying messages by student
create index if not exists idx_messages_student_id on public.messages(student_id);
create index if not exists idx_messages_instructor_id on public.messages(instructor_id);
create index if not exists idx_messages_created_at on public.messages(created_at desc);

-- Enable realtime on messages table for message updates
alter publication supabase_realtime add table messages;

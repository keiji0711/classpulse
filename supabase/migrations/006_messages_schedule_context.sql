-- Add schedule context to instructor messages and ensure realtime metadata is enabled
alter table public.messages
  add column if not exists schedule_id uuid references public.schedules(id) on delete set null;

create index if not exists idx_messages_schedule_id on public.messages(schedule_id);

alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

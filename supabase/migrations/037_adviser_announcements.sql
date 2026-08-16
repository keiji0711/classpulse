-- Add advisory announcements to the existing parent message feed without
-- forcing them into a subject schedule.

alter table public.messages
  add column if not exists school_id uuid references public.schools(id) on delete cascade,
  add column if not exists section_id uuid references public.sections(id) on delete set null,
  add column if not exists academic_year_id uuid references public.academic_years(id) on delete set null,
  add column if not exists message_type text not null default 'subject_message',
  add column if not exists announcement_type text,
  add column if not exists title text,
  add column if not exists event_at timestamptz;

alter table public.messages
  drop constraint if exists messages_message_type_check;
alter table public.messages
  add constraint messages_message_type_check
  check (message_type in ('subject_message', 'adviser_announcement'));

alter table public.messages
  drop constraint if exists messages_announcement_type_check;
alter table public.messages
  add constraint messages_announcement_type_check
  check (
    announcement_type is null
    or announcement_type in ('general', 'meeting', 'reminder', 'urgent')
  );

update public.messages message
set
  school_id = schedule.school_id,
  section_id = schedule.section_id,
  academic_year_id = schedule.academic_year_id
from public.schedules schedule
where message.schedule_id = schedule.id
  and (
    message.school_id is null
    or message.section_id is null
    or message.academic_year_id is null
  );

create index if not exists idx_messages_section_created
  on public.messages(section_id, created_at desc);
create index if not exists idx_messages_academic_year
  on public.messages(academic_year_id);
create index if not exists idx_messages_type
  on public.messages(message_type);

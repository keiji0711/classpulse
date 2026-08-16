-- ============================================
-- Attendance Interventions & Tracking
-- Allows admins/instructors to log and track
-- intervention actions for at-risk students
-- ============================================

-- Interventions table
create table if not exists public.attendance_interventions (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  action_type text not null check (action_type in ('call_parent', 'sms', 'email', 'meeting_scheduled', 'home_visit', 'referral', 'other')),
  notes text not null default '',
  follow_up_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'resolved', 'escalated')),
  outcome text check (outcome in ('improved', 'stable', 'declined', 'critical', null)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Intervention action log (track changes/notes added over time)
create table if not exists public.intervention_actions (
  id uuid primary key default uuid_generate_v4(),
  intervention_id uuid not null references public.attendance_interventions(id) on delete cascade,
  action_type text not null check (action_type in ('created', 'status_updated', 'outcome_set', 'note_added', 'follow_up_updated')),
  description text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- RLS Policies for interventions
alter table public.attendance_interventions enable row level security;
alter table public.intervention_actions enable row level security;

-- Allow school admins to view/manage interventions for their school
create policy attendance_interventions_admin_read
  on public.attendance_interventions
  for select
  using (
    auth.uid() = created_by or
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.school_id = attendance_interventions.school_id
      and u.role in ('school_admin', 'super_admin')
    )
  );

create policy attendance_interventions_admin_write
  on public.attendance_interventions
  for insert
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.school_id = attendance_interventions.school_id
      and u.role in ('school_admin', 'instructor', 'super_admin')
    )
  );

create policy attendance_interventions_admin_update
  on public.attendance_interventions
  for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.school_id = attendance_interventions.school_id
      and u.role in ('school_admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.school_id = attendance_interventions.school_id
      and u.role in ('school_admin', 'super_admin')
    )
  );

-- Instructors can view interventions for their students
create policy attendance_interventions_instructor_read
  on public.attendance_interventions
  for select
  using (
    auth.uid() = created_by or
    exists (
      select 1 from public.users u
      inner join public.schedules s on s.instructor_id = u.id
      inner join public.students st on st.section_id = s.section_id
      where u.id = auth.uid()
      and st.id = attendance_interventions.student_id
    )
  );

-- Allow intervention actions
alter table public.intervention_actions enable row level security;

create policy intervention_actions_view
  on public.intervention_actions
  for select
  using (
    exists (
      select 1 from public.attendance_interventions ai
      where ai.id = intervention_actions.intervention_id
      and (
        auth.uid() = ai.created_by
        or exists (
          select 1 from public.users u
          where u.id = auth.uid()
          and u.school_id = ai.school_id
          and u.role in ('school_admin', 'super_admin', 'instructor')
        )
      )
    )
  );

create policy intervention_actions_insert
  on public.intervention_actions
  for insert
  with check (
    exists (
      select 1 from public.attendance_interventions ai
      where ai.id = intervention_actions.intervention_id
      and exists (
        select 1 from public.users u
        where u.id = auth.uid()
        and u.school_id = ai.school_id
        and u.role in ('school_admin', 'instructor', 'super_admin')
      )
    )
  );

-- Performance indexes
create index if not exists idx_interventions_school_student
  on public.attendance_interventions (school_id, student_id, created_at desc);

create index if not exists idx_interventions_follow_up_status
  on public.attendance_interventions (school_id, status, follow_up_date)
  where follow_up_date is not null;

create index if not exists idx_intervention_actions_intervention
  on public.intervention_actions (intervention_id, created_at desc);

-- Enable realtime for interventions
alter publication supabase_realtime add table public.attendance_interventions;
alter publication supabase_realtime add table public.intervention_actions;

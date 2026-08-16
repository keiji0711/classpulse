-- Per-student parent notification control.
-- Missing rows default to enabled so existing schools keep their current behavior.

-- Subscription access is retired. Keep the legacy column for compatibility,
-- but make every existing and future school fully accessible.
alter table public.schools
  alter column subscription_mode set default 'school_paid';

update public.schools
set subscription_mode = 'school_paid'
where subscription_mode <> 'school_paid';

create table if not exists public.student_notification_preferences (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  enabled boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_student_notification_preferences_school
  on public.student_notification_preferences (school_id);

alter table public.student_notification_preferences enable row level security;

drop policy if exists "super_admin_manage_notification_preferences"
  on public.student_notification_preferences;
create policy "super_admin_manage_notification_preferences"
  on public.student_notification_preferences
  for all
  using (public.get_user_role() = 'super_admin')
  with check (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_notification_preferences"
  on public.student_notification_preferences;
create policy "school_admin_manage_notification_preferences"
  on public.student_notification_preferences
  for all
  using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  )
  with check (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_notification_preferences"
  on public.student_notification_preferences;
create policy "instructor_read_notification_preferences"
  on public.student_notification_preferences
  for select
  using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.students st
      join public.schedules sc on sc.section_id = st.section_id
      where st.id = student_notification_preferences.student_id
        and sc.instructor_id = auth.uid()
    )
  );

drop policy if exists "instructor_insert_notification_preferences"
  on public.student_notification_preferences;
create policy "instructor_insert_notification_preferences"
  on public.student_notification_preferences
  for insert
  with check (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and updated_by = auth.uid()
    and exists (
      select 1
      from public.students st
      join public.schedules sc on sc.section_id = st.section_id
      where st.id = student_notification_preferences.student_id
        and st.school_id = student_notification_preferences.school_id
        and sc.instructor_id = auth.uid()
    )
  );

drop policy if exists "instructor_update_notification_preferences"
  on public.student_notification_preferences;
create policy "instructor_update_notification_preferences"
  on public.student_notification_preferences
  for update
  using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.students st
      join public.schedules sc on sc.section_id = st.section_id
      where st.id = student_notification_preferences.student_id
        and sc.instructor_id = auth.uid()
    )
  )
  with check (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and updated_by = auth.uid()
  );

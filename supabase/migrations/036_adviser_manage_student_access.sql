-- Allow an assigned section adviser to manage parent app access for students
-- in that advisory section, even without a teaching schedule in the section.

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
      where st.id = student_notification_preferences.student_id
        and (
          exists (
            select 1 from public.schedules sc
            where sc.section_id = st.section_id
              and sc.instructor_id = auth.uid()
          )
          or exists (
            select 1 from public.sections sec
            where sec.id = st.section_id
              and sec.adviser_id = auth.uid()
          )
          or exists (
            select 1
            from public.student_enrollments enrollment
            join public.sections sec on sec.id = enrollment.section_id
            where enrollment.student_id = st.id
              and sec.adviser_id = auth.uid()
          )
        )
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
      where st.id = student_notification_preferences.student_id
        and st.school_id = student_notification_preferences.school_id
        and (
          exists (
            select 1 from public.schedules sc
            where sc.section_id = st.section_id
              and sc.instructor_id = auth.uid()
          )
          or exists (
            select 1 from public.sections sec
            where sec.id = st.section_id
              and sec.adviser_id = auth.uid()
          )
          or exists (
            select 1
            from public.student_enrollments enrollment
            join public.sections sec on sec.id = enrollment.section_id
            where enrollment.student_id = st.id
              and sec.adviser_id = auth.uid()
          )
        )
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
      where st.id = student_notification_preferences.student_id
        and (
          exists (
            select 1 from public.schedules sc
            where sc.section_id = st.section_id
              and sc.instructor_id = auth.uid()
          )
          or exists (
            select 1 from public.sections sec
            where sec.id = st.section_id
              and sec.adviser_id = auth.uid()
          )
          or exists (
            select 1
            from public.student_enrollments enrollment
            join public.sections sec on sec.id = enrollment.section_id
            where enrollment.student_id = st.id
              and sec.adviser_id = auth.uid()
          )
        )
    )
  )
  with check (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and updated_by = auth.uid()
  );

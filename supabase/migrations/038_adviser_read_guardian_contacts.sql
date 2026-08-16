-- Advisers need guardian contact details on My Students. Limit access to
-- students in a section currently assigned to that teacher as adviser.

drop policy if exists "adviser_read_guardian_contacts" on public.parents;
create policy "adviser_read_guardian_contacts"
  on public.parents
  for select
  using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.students student
      where student.id = parents.student_id
        and (
          exists (
            select 1
            from public.sections section
            where section.id = student.section_id
              and section.adviser_id = auth.uid()
          )
          or exists (
            select 1
            from public.student_enrollments enrollment
            join public.sections section on section.id = enrollment.section_id
            where enrollment.student_id = student.id
              and section.adviser_id = auth.uid()
          )
        )
    )
  );

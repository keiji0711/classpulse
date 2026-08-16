-- Enforce the full tenant, roster, year, and teacher assignment boundary for
-- grades and exam scores. Client-supplied school/student/subject identifiers
-- are never sufficient authorization on their own.

create or replace function public.can_instructor_manage_academic_record(
  p_student_id uuid,
  p_subject_id uuid,
  p_academic_year_id uuid,
  p_school_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.get_user_role() = 'instructor'
    and p_school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.student_enrollments enrollment
      join public.schedules schedule
        on schedule.school_id = enrollment.school_id
       and schedule.section_id = enrollment.section_id
       and schedule.academic_year_id = enrollment.academic_year_id
       and schedule.subject_id = p_subject_id
      where enrollment.student_id = p_student_id
        and enrollment.school_id = p_school_id
        and enrollment.academic_year_id = p_academic_year_id
        and enrollment.enrollment_status = 'enrolled'
        and schedule.instructor_id = auth.uid()
    );
$$;

revoke all on function public.can_instructor_manage_academic_record(uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.can_instructor_manage_academic_record(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.validate_academic_record_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_student_school uuid;
  v_subject_school uuid;
  v_year_school uuid;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  select school_id into v_subject_school from public.subjects where id = new.subject_id;
  select school_id into v_year_school from public.academic_years where id = new.academic_year_id;

  if new.academic_year_id is null then
    raise exception 'Academic year is required';
  end if;
  if v_student_school is null or v_subject_school is null or v_year_school is null then
    raise exception 'Student, subject, or academic year was not found';
  end if;
  if new.school_id is distinct from v_student_school
     or new.school_id is distinct from v_subject_school
     or new.school_id is distinct from v_year_school then
    raise exception 'Academic record crosses a school boundary';
  end if;
  if not exists (
    select 1 from public.student_enrollments enrollment
    where enrollment.student_id = new.student_id
      and enrollment.school_id = new.school_id
      and enrollment.academic_year_id = new.academic_year_id
  ) then
    raise exception 'Student is not enrolled in this academic year';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_grades_scope on public.grades;
create trigger trg_validate_grades_scope
  before insert or update of school_id, student_id, subject_id, academic_year_id
  on public.grades for each row execute function public.validate_academic_record_scope();

drop trigger if exists trg_validate_exam_scores_scope on public.exam_scores;
create trigger trg_validate_exam_scores_scope
  before insert or update of school_id, student_id, subject_id, academic_year_id
  on public.exam_scores for each row execute function public.validate_academic_record_scope();

drop policy if exists "instructor_manage_grades" on public.grades;
drop policy if exists "super_admin_all_grades" on public.grades;
create policy "platform owners manage grades" on public.grades for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());
drop policy if exists "instructors insert assigned grades" on public.grades;
create policy "instructors insert assigned grades" on public.grades for insert
  with check (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors update assigned grades" on public.grades;
create policy "instructors update assigned grades" on public.grades for update
  using (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  ) with check (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors delete assigned grades" on public.grades;
create policy "instructors delete assigned grades" on public.grades for delete
  using (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors read school grades" on public.grades;
create policy "instructors read school grades" on public.grades for select
  using (public.get_user_role() = 'instructor' and school_id = public.get_user_school_id());

drop policy if exists "instructor_manage_exam_scores" on public.exam_scores;
drop policy if exists "instructor_read_school_exam_scores" on public.exam_scores;
drop policy if exists "instructors insert assigned exam scores" on public.exam_scores;
create policy "instructors insert assigned exam scores" on public.exam_scores for insert
  with check (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors update assigned exam scores" on public.exam_scores;
create policy "instructors update assigned exam scores" on public.exam_scores for update
  using (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  ) with check (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors delete assigned exam scores" on public.exam_scores;
create policy "instructors delete assigned exam scores" on public.exam_scores for delete
  using (
    created_by = auth.uid()
    and public.can_instructor_manage_academic_record(student_id,subject_id,academic_year_id,school_id)
  );
drop policy if exists "instructors read school exam scores" on public.exam_scores;
create policy "instructors read school exam scores" on public.exam_scores for select
  using (public.get_user_role() = 'instructor' and school_id = public.get_user_school_id());

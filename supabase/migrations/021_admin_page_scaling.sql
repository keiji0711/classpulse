-- ============================================
-- Admin page scaling indexes
-- Speeds up large student, attendance, and grade queries
-- ============================================

create extension if not exists pg_trgm;

create index if not exists idx_students_school_section_name
  on public.students (school_id, section_id, last_name, first_name);

create index if not exists idx_students_school_lrn
  on public.students (school_id, lrn);

create index if not exists idx_students_name_search
  on public.students using gin (
    lower(coalesce(first_name, '') || ' ' || coalesce(middle_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops
  );

create index if not exists idx_parents_guardian_search
  on public.parents using gin (
    lower(coalesce(guardian_name, '')) gin_trgm_ops
  );

create index if not exists idx_sections_school_grade_name
  on public.sections (school_id, grade_level, name);

create index if not exists idx_attendance_records_date_schedule_student
  on public.attendance_records (date desc, schedule_id, student_id);

create index if not exists idx_grades_school_year_student_subject
  on public.grades (school_id, academic_year_id, student_id, subject_id, quarter);

create index if not exists idx_student_enrollments_school_year_section_student
  on public.student_enrollments (school_id, academic_year_id, section_id, student_id);

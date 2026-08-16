-- ============================================
-- Grades Table + RLS Policies
-- (Idempotent — safe to re-run)
-- ============================================

-- Grades (per student, per subject, per quarter)
create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  quarter int not null check (quarter between 1 and 4),
  grade numeric(5,2) not null check (grade >= 0 and grade <= 100),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, quarter)
);

-- Indexes
create index if not exists idx_grades_school_id on public.grades(school_id);
create index if not exists idx_grades_student_id on public.grades(student_id);
create index if not exists idx_grades_subject_id on public.grades(subject_id);
create index if not exists idx_grades_created_by on public.grades(created_by);

-- RLS
alter table public.grades enable row level security;

drop policy if exists "super_admin_all_grades" on public.grades;
create policy "super_admin_all_grades" on public.grades
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_read_grades" on public.grades;
create policy "school_admin_read_grades" on public.grades
  for select using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_manage_grades" on public.grades;
create policy "instructor_manage_grades" on public.grades
  for all using (
    public.get_user_role() = 'instructor'
    and created_by = auth.uid()
  );

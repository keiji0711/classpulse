-- ============================================
-- Exam Scores & MPS (Mean Percentage Score)
-- Periodical test scores per student
-- ============================================

-- Exam types: quarterly periodical tests
do $$ begin
  create type public.exam_period as enum ('1st_quarter', '2nd_quarter', '3rd_quarter', '4th_quarter');
exception when duplicate_object then null;
end $$;

create table if not exists public.exam_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  exam_period exam_period not null,
  total_items integer not null check (total_items > 0 and total_items <= 200),
  score integer not null check (score >= 0),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One score per student per subject per exam period per academic year
  constraint uq_exam_score unique (student_id, subject_id, exam_period, academic_year_id),
  -- Score cannot exceed total items
  constraint chk_score_within_items check (score <= total_items)
);

-- Indexes
create index if not exists idx_exam_scores_school on public.exam_scores(school_id);
create index if not exists idx_exam_scores_student on public.exam_scores(student_id);
create index if not exists idx_exam_scores_subject on public.exam_scores(subject_id);
create index if not exists idx_exam_scores_academic_year on public.exam_scores(academic_year_id);
create index if not exists idx_exam_scores_created_by on public.exam_scores(created_by);
create index if not exists idx_exam_scores_period on public.exam_scores(exam_period);

-- Enable RLS
alter table public.exam_scores enable row level security;

-- Super admin: full access
drop policy if exists "super_admin_all_exam_scores" on public.exam_scores;
create policy "super_admin_all_exam_scores" on public.exam_scores
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'super_admin')
  );

-- School admin: read own school
drop policy if exists "school_admin_read_exam_scores" on public.exam_scores;
create policy "school_admin_read_exam_scores" on public.exam_scores
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'school_admin' and school_id = exam_scores.school_id)
  );

-- Instructor: manage own records (created_by)
drop policy if exists "instructor_manage_exam_scores" on public.exam_scores;
create policy "instructor_manage_exam_scores" on public.exam_scores
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'instructor')
    and created_by = auth.uid()
  ) with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'instructor')
    and created_by = auth.uid()
  );

-- Instructor: read all scores in their school for viewing
drop policy if exists "instructor_read_school_exam_scores" on public.exam_scores;
create policy "instructor_read_school_exam_scores" on public.exam_scores
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'instructor' and school_id = exam_scores.school_id)
  );

-- Enable realtime
do $$ begin
  alter publication supabase_realtime add table public.exam_scores;
exception when duplicate_object then null;
end $$;

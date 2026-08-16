-- ============================================
-- Academic Years & Student Enrollments
-- Enables year-over-year data isolation
-- (Idempotent — safe to re-run)
-- ============================================

-- =====================
-- Academic Years table
-- =====================
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,                -- e.g. "2024-2025"
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

-- Only one current year per school
create unique index if not exists idx_academic_years_current
  on public.academic_years (school_id)
  where (is_current = true);

create index if not exists idx_academic_years_school_id
  on public.academic_years(school_id);

-- =====================
-- Student Enrollments table
-- Links students to sections per academic year
-- =====================
create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);

create index if not exists idx_student_enrollments_student on public.student_enrollments(student_id);
create index if not exists idx_student_enrollments_section on public.student_enrollments(section_id);
create index if not exists idx_student_enrollments_year on public.student_enrollments(academic_year_id);
create index if not exists idx_student_enrollments_school on public.student_enrollments(school_id);

-- =====================
-- Add academic_year_id to schedules
-- =====================
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schedules' and column_name='academic_year_id'
  ) then
    alter table public.schedules
      add column academic_year_id uuid references public.academic_years(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_schedules_academic_year on public.schedules(academic_year_id);

-- =====================
-- Add academic_year_id to grades
-- =====================
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='grades' and column_name='academic_year_id'
  ) then
    alter table public.grades
      add column academic_year_id uuid references public.academic_years(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_grades_academic_year on public.grades(academic_year_id);

-- =====================
-- Update grades unique constraint
-- Old: unique(student_id, subject_id, quarter)
-- New: unique(student_id, subject_id, quarter, academic_year_id)
-- =====================
do $$ begin
  -- Drop old constraint if it exists
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema='public'
      and table_name='grades'
      and constraint_type='UNIQUE'
      and constraint_name='grades_student_id_subject_id_quarter_key'
  ) then
    alter table public.grades drop constraint grades_student_id_subject_id_quarter_key;
  end if;
end $$;

-- Create new unique constraint (allows same student+subject+quarter in different years)
-- Use a unique index instead of constraint to handle NULLs gracefully during migration
drop index if exists idx_grades_student_subject_quarter_year;
create unique index idx_grades_student_subject_quarter_year
  on public.grades (student_id, subject_id, quarter, academic_year_id);

-- =====================
-- RLS Policies for academic_years
-- =====================
alter table public.academic_years enable row level security;

drop policy if exists "super_admin_all_academic_years" on public.academic_years;
create policy "super_admin_all_academic_years" on public.academic_years
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_academic_years" on public.academic_years;
create policy "school_admin_manage_academic_years" on public.academic_years
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_academic_years" on public.academic_years;
create policy "instructor_read_academic_years" on public.academic_years
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "anon_read_academic_years" on public.academic_years;
create policy "anon_read_academic_years" on public.academic_years
  for select using (true);

-- =====================
-- RLS Policies for student_enrollments
-- =====================
alter table public.student_enrollments enable row level security;

drop policy if exists "super_admin_all_enrollments" on public.student_enrollments;
create policy "super_admin_all_enrollments" on public.student_enrollments
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_enrollments" on public.student_enrollments;
create policy "school_admin_manage_enrollments" on public.student_enrollments
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_enrollments" on public.student_enrollments;
create policy "instructor_read_enrollments" on public.student_enrollments
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "anon_read_enrollments" on public.student_enrollments;
create policy "anon_read_enrollments" on public.student_enrollments
  for select using (true);

-- =====================
-- Enable realtime for new tables
-- =====================
do $$ begin
  alter publication supabase_realtime add table public.academic_years;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.student_enrollments;
exception when duplicate_object then null;
end $$;

-- =====================
-- Helper function: get current academic year for a school
-- =====================
create or replace function public.get_current_academic_year_id(p_school_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select id from public.academic_years
  where school_id = p_school_id and is_current = true
  limit 1;
$$;

-- =====================
-- Helper function: set exactly one year as current
-- =====================
create or replace function public.set_current_academic_year(p_year_id uuid, p_school_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Unset all current years for this school
  update public.academic_years
  set is_current = false
  where school_id = p_school_id and is_current = true;

  -- Set the specified year as current
  update public.academic_years
  set is_current = true
  where id = p_year_id and school_id = p_school_id;
end;
$$;

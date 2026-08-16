-- ============================================
-- AttendEase: Multi-School Attendance SaaS
-- Full Database Schema + RLS Policies
-- (Idempotent — safe to re-run)
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =====================
-- TABLES
-- =====================

-- Schools
create table if not exists public.schools (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null default '',
  logo_url text,
  created_at timestamptz not null default now()
);

-- Users (Super Admin, School Admin, Instructor)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('super_admin', 'school_admin', 'instructor')),
  school_id uuid references public.schools(id) on delete set null,
  full_name text not null default '',
  phone_number text not null default '',
  address text not null default '',
  created_at timestamptz not null default now()
);

-- Add columns if table already exists (idempotent)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='phone_number') then
    alter table public.users add column phone_number text not null default '';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='address') then
    alter table public.users add column address text not null default '';
  end if;
end $$;

-- Strands (for Senior High School — GAS, TVL, STEM, ABM, HUMSS, etc.)
create table if not exists public.strands (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  code text not null default '',
  created_at timestamptz not null default now()
);

-- Sections
create table if not exists public.sections (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  grade_level text not null default '',
  strand_id uuid references public.strands(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Add strand_id if table already exists (idempotent)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sections' and column_name='strand_id') then
    alter table public.sections add column strand_id uuid references public.strands(id) on delete set null;
  end if;
end $$;

-- Subjects
create table if not exists public.subjects (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  code text not null default '',
  created_at timestamptz not null default now()
);

-- Students
create table if not exists public.students (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  lrn text not null,
  first_name text not null,
  middle_name text not null default '',
  last_name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, lrn)
);

-- Add middle_name if table already exists (idempotent)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='students' and column_name='middle_name') then
    alter table public.students add column middle_name text not null default '';
  end if;
end $$;

-- Parents / Guardians
create table if not exists public.parents (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  guardian_name text not null default '',
  phone_number text not null default '',
  expo_push_token text,
  created_at timestamptz not null default now()
);

-- Schedules
create table if not exists public.schedules (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid not null references public.schools(id) on delete cascade,
  instructor_id uuid not null references public.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  time_start time not null,
  time_end time not null,
  room text not null default '',
  created_at timestamptz not null default now()
);

-- Section Subjects (which subjects are assigned to each section)
create table if not exists public.section_subjects (
  id uuid primary key default uuid_generate_v4(),
  section_id uuid not null references public.sections(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (section_id, subject_id)
);

-- Attendance Records
create table if not exists public.attendance_records (
  id uuid primary key default uuid_generate_v4(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  recorded_by uuid not null references public.users(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  unique (schedule_id, student_id, date)
);

-- =====================
-- INDEXES
-- =====================

create index if not exists idx_users_school_id on public.users(school_id);
create index if not exists idx_users_role on public.users(role);
create index if not exists idx_strands_school_id on public.strands(school_id);
create index if not exists idx_sections_school_id on public.sections(school_id);
create index if not exists idx_sections_strand_id on public.sections(strand_id);
create index if not exists idx_subjects_school_id on public.subjects(school_id);
create index if not exists idx_students_school_id on public.students(school_id);
create index if not exists idx_students_section_id on public.students(section_id);
create index if not exists idx_students_lrn on public.students(school_id, lrn);
create index if not exists idx_parents_student_id on public.parents(student_id);
create index if not exists idx_parents_school_id on public.parents(school_id);
create index if not exists idx_schedules_school_id on public.schedules(school_id);
create index if not exists idx_schedules_instructor_id on public.schedules(instructor_id);
create index if not exists idx_section_subjects_section_id on public.section_subjects(section_id);
create index if not exists idx_section_subjects_subject_id on public.section_subjects(subject_id);
create index if not exists idx_section_subjects_school_id on public.section_subjects(school_id);
create index if not exists idx_attendance_schedule_id on public.attendance_records(schedule_id);
create index if not exists idx_attendance_student_id on public.attendance_records(student_id);
create index if not exists idx_attendance_date on public.attendance_records(date);

-- =====================
-- ROW LEVEL SECURITY
-- =====================

alter table public.schools enable row level security;
alter table public.users enable row level security;
alter table public.strands enable row level security;
alter table public.sections enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.parents enable row level security;
alter table public.schedules enable row level security;
alter table public.section_subjects enable row level security;
alter table public.attendance_records enable row level security;

-- Helper function: get current user's role
create or replace function public.get_user_role()
returns text
language sql
security definer
stable
as $$
  select role from public.users where id = auth.uid();
$$;

-- Helper function: get current user's school_id
create or replace function public.get_user_school_id()
returns uuid
language sql
security definer
stable
as $$
  select school_id from public.users where id = auth.uid();
$$;

-- =====================
-- SCHOOLS policies
-- =====================

drop policy if exists "super_admin_all_schools" on public.schools;
create policy "super_admin_all_schools" on public.schools
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "read_own_school" on public.schools;
create policy "read_own_school" on public.schools
  for select using (id = public.get_user_school_id());

-- =====================
-- USERS policies
-- =====================

drop policy if exists "super_admin_all_users" on public.users;
create policy "super_admin_all_users" on public.users
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_users" on public.users;
create policy "school_admin_manage_users" on public.users
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "read_own_profile" on public.users;
create policy "read_own_profile" on public.users
  for select using (id = auth.uid());

-- =====================
-- STRANDS policies
-- =====================

drop policy if exists "super_admin_all_strands" on public.strands;
create policy "super_admin_all_strands" on public.strands
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_strands" on public.strands;
create policy "school_admin_manage_strands" on public.strands
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_strands" on public.strands;
create policy "instructor_read_strands" on public.strands
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- SECTIONS policies
-- =====================

drop policy if exists "super_admin_all_sections" on public.sections;
create policy "super_admin_all_sections" on public.sections
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_sections" on public.sections;
create policy "school_admin_manage_sections" on public.sections
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_sections" on public.sections;
create policy "instructor_read_sections" on public.sections
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- SUBJECTS policies
-- =====================

drop policy if exists "super_admin_all_subjects" on public.subjects;
create policy "super_admin_all_subjects" on public.subjects
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_subjects" on public.subjects;
create policy "school_admin_manage_subjects" on public.subjects
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_subjects" on public.subjects;
create policy "instructor_read_subjects" on public.subjects
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- STUDENTS policies
-- =====================

drop policy if exists "super_admin_all_students" on public.students;
create policy "super_admin_all_students" on public.students
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_students" on public.students;
create policy "school_admin_manage_students" on public.students
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_students" on public.students;
create policy "instructor_read_students" on public.students
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- PARENTS policies
-- =====================

drop policy if exists "super_admin_all_parents" on public.parents;
create policy "super_admin_all_parents" on public.parents
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_parents" on public.parents;
create policy "school_admin_manage_parents" on public.parents
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- SCHEDULES policies
-- =====================

drop policy if exists "super_admin_all_schedules" on public.schedules;
create policy "super_admin_all_schedules" on public.schedules
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_schedules" on public.schedules;
create policy "school_admin_manage_schedules" on public.schedules
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_own_schedules" on public.schedules;
create policy "instructor_read_own_schedules" on public.schedules
  for select using (
    public.get_user_role() = 'instructor'
    and instructor_id = auth.uid()
  );

-- =====================
-- SECTION_SUBJECTS policies
-- =====================

drop policy if exists "super_admin_all_section_subjects" on public.section_subjects;
create policy "super_admin_all_section_subjects" on public.section_subjects
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_manage_section_subjects" on public.section_subjects;
create policy "school_admin_manage_section_subjects" on public.section_subjects
  for all using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists "instructor_read_section_subjects" on public.section_subjects;
create policy "instructor_read_section_subjects" on public.section_subjects
  for select using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
  );

-- =====================
-- ATTENDANCE_RECORDS policies
-- =====================

drop policy if exists "super_admin_all_attendance" on public.attendance_records;
create policy "super_admin_all_attendance" on public.attendance_records
  for all using (public.get_user_role() = 'super_admin');

drop policy if exists "school_admin_read_attendance" on public.attendance_records;
create policy "school_admin_read_attendance" on public.attendance_records
  for select using (
    public.get_user_role() = 'school_admin'
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
      and schedules.school_id = public.get_user_school_id()
    )
  );

drop policy if exists "instructor_manage_attendance" on public.attendance_records;
create policy "instructor_manage_attendance" on public.attendance_records
  for all using (
    public.get_user_role() = 'instructor'
    and exists (
      select 1 from public.schedules
      where schedules.id = attendance_records.schedule_id
      and schedules.instructor_id = auth.uid()
    )
  );

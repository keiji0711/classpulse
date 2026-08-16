-- School-year lifecycle, student outcomes, and rollover audit records.

alter table public.academic_years
  add column if not exists status text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.users(id) on delete set null,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references public.users(id) on delete set null;

update public.academic_years
set status = case
  when is_current then 'active'
  when end_date < current_date then 'closed'
  else 'draft'
end
where status is null;

alter table public.academic_years alter column status set default 'draft';
alter table public.academic_years alter column status set not null;
alter table public.academic_years drop constraint if exists academic_years_status_check;
alter table public.academic_years add constraint academic_years_status_check
  check (status in ('draft', 'active', 'closing', 'closed', 'archived'));

create unique index if not exists idx_academic_years_active_status
  on public.academic_years(school_id)
  where status = 'active';

alter table public.students
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists graduation_date date;

alter table public.students drop constraint if exists students_lifecycle_status_check;
alter table public.students add constraint students_lifecycle_status_check
  check (lifecycle_status in ('active', 'graduated', 'transferred', 'withdrawn', 'dropped'));

alter table public.student_enrollments
  add column if not exists enrollment_status text not null default 'enrolled',
  add column if not exists year_end_outcome text,
  add column if not exists outcome_notes text not null default '',
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by uuid references public.users(id) on delete set null,
  add column if not exists promoted_to_enrollment_id uuid;

alter table public.student_enrollments drop constraint if exists student_enrollments_status_check;
alter table public.student_enrollments add constraint student_enrollments_status_check
  check (enrollment_status in ('enrolled', 'completed', 'transferred', 'withdrawn', 'dropped'));

alter table public.student_enrollments drop constraint if exists student_enrollments_outcome_check;
alter table public.student_enrollments add constraint student_enrollments_outcome_check
  check (
    year_end_outcome is null
    or year_end_outcome in ('promoted', 'retained', 'graduated', 'transferred', 'withdrawn', 'dropped', 'pending')
  );

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_enrollments_promoted_to_fkey'
      and conrelid = 'public.student_enrollments'::regclass
  ) then
    alter table public.student_enrollments
      add constraint student_enrollments_promoted_to_fkey
      foreign key (promoted_to_enrollment_id)
      references public.student_enrollments(id)
      on delete restrict;
  end if;
end $$;

create table if not exists public.school_year_rollover_batches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  source_year_id uuid not null references public.academic_years(id) on delete restrict,
  target_year_id uuid not null references public.academic_years(id) on delete restrict,
  idempotency_key uuid not null,
  status text not null default 'processing'
    check (status in ('processing', 'finalized', 'activated', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  activated_at timestamptz,
  constraint school_year_rollover_different_years check (source_year_id <> target_year_id),
  unique (school_id, idempotency_key),
  unique (source_year_id, target_year_id)
);

create table if not exists public.school_year_rollover_details (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.school_year_rollover_batches(id) on delete cascade,
  source_enrollment_id uuid not null references public.student_enrollments(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  outcome text not null
    check (outcome in ('promoted', 'retained', 'graduated', 'transferred', 'withdrawn', 'dropped')),
  target_section_id uuid references public.sections(id) on delete restrict,
  target_enrollment_id uuid references public.student_enrollments(id) on delete restrict,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (batch_id, source_enrollment_id),
  unique (batch_id, student_id)
);

create index if not exists idx_rollover_batches_school on public.school_year_rollover_batches(school_id, created_at desc);
create index if not exists idx_rollover_details_batch on public.school_year_rollover_details(batch_id);

alter table public.school_year_rollover_batches enable row level security;
alter table public.school_year_rollover_details enable row level security;

drop policy if exists school_admin_manage_rollover_batches on public.school_year_rollover_batches;
create policy school_admin_manage_rollover_batches
  on public.school_year_rollover_batches
  for all
  using (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  )
  with check (
    public.get_user_role() = 'school_admin'
    and school_id = public.get_user_school_id()
  );

drop policy if exists school_admin_manage_rollover_details on public.school_year_rollover_details;
create policy school_admin_manage_rollover_details
  on public.school_year_rollover_details
  for all
  using (
    exists (
      select 1 from public.school_year_rollover_batches batch
      where batch.id = school_year_rollover_details.batch_id
        and batch.school_id = public.get_user_school_id()
        and public.get_user_role() = 'school_admin'
    )
  )
  with check (
    exists (
      select 1 from public.school_year_rollover_batches batch
      where batch.id = school_year_rollover_details.batch_id
        and batch.school_id = public.get_user_school_id()
        and public.get_user_role() = 'school_admin'
    )
  );

do $$ begin
  alter publication supabase_realtime add table public.school_year_rollover_batches;
exception when duplicate_object then null;
end $$;


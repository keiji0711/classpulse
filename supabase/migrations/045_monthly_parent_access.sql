-- Monthly parent access collection and entitlement enforcement.
-- Default commercial model: PHP 20 per student, 5-day monthly grace period.

create table if not exists public.parent_access_billing_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  monthly_price numeric(10,2) not null default 20 check (monthly_price >= 0),
  grace_days integer not null default 5 check (grace_days between 0 and 28),
  billing_enabled boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.parent_access_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid references public.parents(id) on delete set null,
  billing_month date not null,
  status text not null check (status in ('paid', 'waived', 'refunded')),
  amount_due numeric(10,2) not null default 20 check (amount_due >= 0),
  amount_paid numeric(10,2) not null default 0 check (amount_paid >= 0),
  payment_method text not null default 'cash',
  payment_reference text,
  notes text,
  collected_by uuid references public.users(id) on delete set null,
  collected_at timestamptz,
  remittance_status text not null default 'pending'
    check (remittance_status in ('pending', 'submitted', 'verified')),
  remitted_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_access_payment_month_start
    check (billing_month = date_trunc('month', billing_month)::date),
  constraint parent_access_payment_unique_month unique (student_id, billing_month)
);

create index if not exists idx_parent_access_payments_school_month
  on public.parent_access_payments (school_id, billing_month, status);
create index if not exists idx_parent_access_payments_collector_month
  on public.parent_access_payments (collected_by, billing_month);

alter table public.parent_access_billing_settings enable row level security;
alter table public.parent_access_payments enable row level security;

drop policy if exists "platform owners manage parent billing settings" on public.parent_access_billing_settings;
create policy "platform owners manage parent billing settings"
  on public.parent_access_billing_settings for all
  using (public.get_user_role() = 'super_admin')
  with check (public.get_user_role() = 'super_admin');

drop policy if exists "school admins read parent billing settings" on public.parent_access_billing_settings;
create policy "school admins read parent billing settings"
  on public.parent_access_billing_settings for select
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

drop policy if exists "instructors read parent billing settings" on public.parent_access_billing_settings;
create policy "instructors read parent billing settings"
  on public.parent_access_billing_settings for select
  using (public.get_user_role() = 'instructor' and school_id = public.get_user_school_id());

drop policy if exists "platform owners read parent payments" on public.parent_access_payments;
create policy "platform owners read parent payments"
  on public.parent_access_payments for select
  using (public.get_user_role() = 'super_admin');

drop policy if exists "school admins manage parent payments" on public.parent_access_payments;
create policy "school admins manage parent payments"
  on public.parent_access_payments for all
  using (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id())
  with check (public.get_user_role() = 'school_admin' and school_id = public.get_user_school_id());

drop policy if exists "advisers read parent payments" on public.parent_access_payments;
create policy "advisers read parent payments"
  on public.parent_access_payments for select
  using (
    public.get_user_role() = 'instructor'
    and school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.students st
      where st.id = parent_access_payments.student_id
        and (
          exists (
            select 1 from public.sections sec
            where sec.id = st.section_id and sec.adviser_id = auth.uid()
          )
          or exists (
            select 1
            from public.student_enrollments enrollment
            join public.sections sec on sec.id = enrollment.section_id
            where enrollment.student_id = st.id and sec.adviser_id = auth.uid()
          )
        )
    )
  );

create or replace function public.parent_billing_month(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select date_trunc('month', p_at at time zone 'Asia/Manila')::date;
$$;

create or replace function public.parent_access_is_enabled(
  p_student_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_school_id uuid;
  v_manual_enabled boolean := true;
  v_billing_enabled boolean := false;
  v_grace_days integer := 5;
  v_month date := public.parent_billing_month(p_at);
  v_local_day integer := extract(day from (p_at at time zone 'Asia/Manila'))::integer;
  v_status text;
begin
  select school_id into v_school_id from public.students where id = p_student_id;
  if v_school_id is null then return false; end if;

  select enabled into v_manual_enabled
  from public.student_notification_preferences
  where student_id = p_student_id;
  v_manual_enabled := coalesce(v_manual_enabled, true);
  if not v_manual_enabled then return false; end if;

  select billing_enabled, grace_days
  into v_billing_enabled, v_grace_days
  from public.parent_access_billing_settings
  where school_id = v_school_id;

  if not found or not coalesce(v_billing_enabled, false) then
    return true;
  end if;

  select status into v_status
  from public.parent_access_payments
  where student_id = p_student_id and billing_month = v_month;

  if v_status in ('paid', 'waived') then return true; end if;
  if v_status = 'refunded' then return false; end if;

  return v_local_day <= coalesce(v_grace_days, 5);
end;
$$;

revoke all on function public.parent_access_is_enabled(uuid, timestamptz) from public;
grant execute on function public.parent_access_is_enabled(uuid, timestamptz) to authenticated, service_role;

create or replace function public.parent_access_statuses(
  p_student_ids uuid[],
  p_at timestamptz default now()
)
returns table(student_id uuid, enabled boolean)
language sql
security definer
stable
set search_path = public
as $$
  select requested.student_id, public.parent_access_is_enabled(requested.student_id, p_at)
  from unnest(p_student_ids) as requested(student_id);
$$;

revoke all on function public.parent_access_statuses(uuid[], timestamptz) from public;
grant execute on function public.parent_access_statuses(uuid[], timestamptz) to authenticated, service_role;

create or replace function public.record_parent_access_payment(
  p_student_id uuid,
  p_billing_month date default public.parent_billing_month(),
  p_action text default 'paid',
  p_amount numeric default null,
  p_payment_reference text default null,
  p_notes text default null
)
returns public.parent_access_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_student public.students%rowtype;
  v_parent_id uuid;
  v_price numeric(10,2) := 20;
  v_month date := date_trunc('month', p_billing_month)::date;
  v_allowed boolean := false;
  v_result public.parent_access_payments%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or v_actor.role not in ('instructor', 'school_admin', 'super_admin') then
    raise exception 'Only authorized school staff can record parent payments';
  end if;

  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then raise exception 'Student not found'; end if;

  if v_actor.role = 'super_admin' then
    v_allowed := true;
  elsif v_actor.school_id = v_student.school_id and v_actor.role = 'school_admin' then
    v_allowed := true;
  elsif v_actor.school_id = v_student.school_id and v_actor.role = 'instructor' then
    select exists (
      select 1 from public.sections sec
      where sec.id = v_student.section_id and sec.adviser_id = v_actor.id
    ) or exists (
      select 1
      from public.student_enrollments enrollment
      join public.sections sec on sec.id = enrollment.section_id
      where enrollment.student_id = v_student.id and sec.adviser_id = v_actor.id
    ) into v_allowed;
  end if;

  if not v_allowed then raise exception 'You cannot manage payment access for this student'; end if;
  if p_action not in ('paid', 'waived', 'refunded') then raise exception 'Invalid payment action'; end if;

  select monthly_price into v_price
  from public.parent_access_billing_settings where school_id = v_student.school_id;
  v_price := coalesce(v_price, 20);
  select id into v_parent_id from public.parents where student_id = v_student.id order by created_at limit 1;

  insert into public.parent_access_payments (
    school_id, student_id, parent_id, billing_month, status,
    amount_due, amount_paid, payment_method, payment_reference, notes,
    collected_by, collected_at, remittance_status, updated_at
  ) values (
    v_student.school_id, v_student.id, v_parent_id, v_month, p_action,
    v_price,
    case when p_action = 'paid' then coalesce(p_amount, v_price) else 0 end,
    'cash', nullif(trim(p_payment_reference), ''), nullif(trim(p_notes), ''),
    v_actor.id, case when p_action in ('paid', 'waived') then now() else null end,
    'pending', now()
  )
  on conflict (student_id, billing_month) do update set
    parent_id = excluded.parent_id,
    status = excluded.status,
    amount_due = excluded.amount_due,
    amount_paid = excluded.amount_paid,
    payment_reference = excluded.payment_reference,
    notes = excluded.notes,
    collected_by = excluded.collected_by,
    collected_at = excluded.collected_at,
    remittance_status = 'pending',
    remitted_at = null,
    verified_by = null,
    verified_at = null,
    updated_at = now()
  returning * into v_result;

  insert into public.student_notification_preferences (student_id, school_id, enabled, updated_by, updated_at)
  values (v_student.id, v_student.school_id, p_action <> 'refunded', v_actor.id, now())
  on conflict (student_id) do update set
    enabled = excluded.enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return v_result;
end;
$$;

revoke all on function public.record_parent_access_payment(uuid, date, text, numeric, text, text) from public;
grant execute on function public.record_parent_access_payment(uuid, date, text, numeric, text, text) to authenticated;

create or replace function public.verify_parent_access_payment(p_payment_id uuid)
returns public.parent_access_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_payment public.parent_access_payments%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  select * into v_payment from public.parent_access_payments where id = p_payment_id;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if v_actor.role <> 'super_admin'
    and not (v_actor.role = 'school_admin' and v_actor.school_id = v_payment.school_id) then
    raise exception 'Only the school administrator can verify collections';
  end if;

  update public.parent_access_payments set
    remittance_status = 'verified',
    remitted_at = coalesce(remitted_at, now()),
    verified_by = v_actor.id,
    verified_at = now(),
    updated_at = now()
  where id = p_payment_id
  returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function public.verify_parent_access_payment(uuid) from public;
grant execute on function public.verify_parent_access_payment(uuid) to authenticated;

create or replace function public.get_school_parent_collection_summary(
  p_billing_month date default public.parent_billing_month()
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_month date := date_trunc('month', p_billing_month)::date;
  v_price numeric := 20;
  v_result jsonb;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.role not in ('school_admin', 'super_admin') or v_actor.school_id is null then
    raise exception 'School administrator access required';
  end if;
  select monthly_price into v_price from public.parent_access_billing_settings where school_id = v_actor.school_id;
  v_price := coalesce(v_price, 20);

  select jsonb_build_object(
    'billing_month', v_month,
    'monthly_price', v_price,
    'eligible', (select count(*) from public.students where school_id = v_actor.school_id),
    'paid', (select count(*) from public.parent_access_payments where school_id = v_actor.school_id and billing_month = v_month and status = 'paid'),
    'waived', (select count(*) from public.parent_access_payments where school_id = v_actor.school_id and billing_month = v_month and status = 'waived'),
    'collected', coalesce((select sum(amount_paid) from public.parent_access_payments where school_id = v_actor.school_id and billing_month = v_month and status = 'paid'), 0),
    'verified', coalesce((select sum(amount_paid) from public.parent_access_payments where school_id = v_actor.school_id and billing_month = v_month and status = 'paid' and remittance_status = 'verified'), 0),
    'pending_verification', (select count(*) from public.parent_access_payments where school_id = v_actor.school_id and billing_month = v_month and status = 'paid' and remittance_status <> 'verified')
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_school_parent_collection_summary(date) from public;
grant execute on function public.get_school_parent_collection_summary(date) to authenticated;

create or replace function public.get_school_parent_collection_rows(
  p_billing_month date default public.parent_billing_month(),
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  student_id uuid,
  student_name text,
  lrn text,
  section_name text,
  guardian_name text,
  payment_id uuid,
  payment_status text,
  amount_paid numeric,
  collected_at timestamptz,
  collector_name text,
  remittance_status text,
  access_enabled boolean,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_month date := date_trunc('month', p_billing_month)::date;
  v_query text := '%' || lower(trim(coalesce(p_search, ''))) || '%';
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.role not in ('school_admin', 'super_admin') or v_actor.school_id is null then
    raise exception 'School administrator access required';
  end if;

  return query
  select
    st.id,
    concat_ws(' ', st.first_name, nullif(st.middle_name, ''), st.last_name),
    st.lrn,
    trim(concat_ws(' · ', sec.grade_level, sec.name)),
    coalesce(parent.guardian_name, ''),
    payment.id,
    coalesce(payment.status, 'unpaid'),
    coalesce(payment.amount_paid, 0),
    payment.collected_at,
    coalesce(collector.full_name, ''),
    coalesce(payment.remittance_status, 'pending'),
    public.parent_access_is_enabled(st.id),
    count(*) over()
  from public.students st
  left join public.sections sec on sec.id = st.section_id
  left join lateral (
    select p.guardian_name from public.parents p where p.student_id = st.id order by p.created_at limit 1
  ) parent on true
  left join public.parent_access_payments payment
    on payment.student_id = st.id and payment.billing_month = v_month
  left join public.users collector on collector.id = payment.collected_by
  where st.school_id = v_actor.school_id
    and (
      trim(coalesce(p_search, '')) = ''
      or lower(concat_ws(' ', st.first_name, st.middle_name, st.last_name)) like v_query
      or lower(st.lrn) like v_query
      or lower(coalesce(parent.guardian_name, '')) like v_query
      or lower(concat_ws(' ', sec.grade_level, sec.name)) like v_query
    )
  order by st.last_name, st.first_name
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.get_school_parent_collection_rows(date, text, integer, integer) from public;
grant execute on function public.get_school_parent_collection_rows(date, text, integer, integer) to authenticated;

create or replace function public.get_parent_access_revenue(
  p_billing_month date default public.parent_billing_month()
)
returns table(
  school_id uuid,
  school_name text,
  monthly_price numeric,
  eligible bigint,
  paid bigint,
  waived bigint,
  collected numeric,
  verified numeric,
  pending_verification bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_billing_month)::date;
begin
  if public.get_user_role() <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  return query
  select
    school.id,
    school.name,
    coalesce(settings.monthly_price, 20),
    (select count(*) from public.students st where st.school_id = school.id),
    (select count(*) from public.parent_access_payments payment where payment.school_id = school.id and payment.billing_month = v_month and payment.status = 'paid'),
    (select count(*) from public.parent_access_payments payment where payment.school_id = school.id and payment.billing_month = v_month and payment.status = 'waived'),
    coalesce((select sum(payment.amount_paid) from public.parent_access_payments payment where payment.school_id = school.id and payment.billing_month = v_month and payment.status = 'paid'), 0),
    coalesce((select sum(payment.amount_paid) from public.parent_access_payments payment where payment.school_id = school.id and payment.billing_month = v_month and payment.status = 'paid' and payment.remittance_status = 'verified'), 0),
    (select count(*) from public.parent_access_payments payment where payment.school_id = school.id and payment.billing_month = v_month and payment.status = 'paid' and payment.remittance_status <> 'verified')
  from public.schools school
  left join public.parent_access_billing_settings settings on settings.school_id = school.id
  order by school.name;
end;
$$;

revoke all on function public.get_parent_access_revenue(date) from public;
grant execute on function public.get_parent_access_revenue(date) to authenticated;

-- Enable monthly billing for every existing school using the agreed defaults.
insert into public.parent_access_billing_settings (school_id, monthly_price, grace_days, billing_enabled)
select id, 20, 5, true from public.schools
on conflict (school_id) do nothing;

-- Safe rollout: preserve currently enabled parent access for this month without
-- counting it as income. Existing explicit OFF preferences remain OFF.
insert into public.parent_access_payments (
  school_id, student_id, parent_id, billing_month, status,
  amount_due, amount_paid, payment_method, notes, remittance_status
)
select
  st.school_id,
  st.id,
  p.id,
  public.parent_billing_month(),
  'waived',
  settings.monthly_price,
  0,
  'rollout',
  'Initial monthly-access rollout carryover',
  'verified'
from public.students st
join public.parent_access_billing_settings settings on settings.school_id = st.school_id
left join lateral (
  select id from public.parents where student_id = st.id order by created_at limit 1
) p on true
left join public.student_notification_preferences pref on pref.student_id = st.id
where coalesce(pref.enabled, true) = true
on conflict (student_id, billing_month) do nothing;

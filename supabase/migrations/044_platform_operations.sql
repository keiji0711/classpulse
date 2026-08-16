-- Platform operations for a non-billing ClassPulse deployment.

alter table public.schools
  add column if not exists operational_status text not null default 'active',
  add column if not exists status_reason text not null default '',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references public.users(id) on delete set null,
  add column if not exists archived_at timestamptz;

alter table public.schools drop constraint if exists schools_operational_status_check;
alter table public.schools add constraint schools_operational_status_check
  check (operational_status in ('new', 'setup', 'ready', 'active', 'inactive', 'suspended', 'archived'));
create index if not exists idx_schools_operational_status on public.schools(operational_status);

alter table public.support_threads
  add column if not exists priority text not null default 'normal',
  add column if not exists category text not null default 'general',
  add column if not exists assigned_to uuid references public.users(id) on delete set null,
  add column if not exists internal_notes text not null default '',
  add column if not exists due_at timestamptz;
alter table public.support_threads drop constraint if exists support_threads_priority_check;
alter table public.support_threads add constraint support_threads_priority_check check(priority in ('low','normal','high','urgent'));

create table if not exists public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'maintenance', 'warning', 'critical', 'release')),
  audience text not null default 'all' check (audience in ('all', 'school_admins', 'instructors', 'selected_schools')),
  school_ids uuid[] not null default '{}',
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  enabled_globally boolean not null default false,
  school_ids uuid[] not null default '{}',
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_health_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  school_id uuid references public.schools(id) on delete set null,
  message text not null,
  details jsonb not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_platform_health_events_open on public.platform_health_events(created_at desc) where resolved_at is null;

alter table public.platform_announcements enable row level security;
alter table public.platform_feature_flags enable row level security;
alter table public.platform_health_events enable row level security;

create policy "platform owners manage announcements" on public.platform_announcements for all
  using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'))
  with check (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'));
create policy "school users read announcements" on public.platform_announcements for select
  using (published_at is not null and published_at <= now() and (expires_at is null or expires_at > now()) and exists(
    select 1 from public.users u where u.id=auth.uid() and u.school_id is not null and (
      audience='all' or (audience='school_admins' and u.role='school_admin') or
      (audience='instructors' and u.role='instructor') or
      (audience='selected_schools' and u.school_id=any(school_ids))
    )
  ));
create policy "platform owners manage flags" on public.platform_feature_flags for all
  using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'))
  with check (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'));
create policy "authenticated read enabled flags" on public.platform_feature_flags for select
  using (auth.uid() is not null);
create policy "platform owners manage health" on public.platform_health_events for all
  using (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'))
  with check (exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'));

create or replace function public.audit_platform_operation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_action text; v_id text; v_label text; v_row jsonb;
begin
  select * into v_actor from public.users where id=auth.uid();
  if v_actor.role <> 'super_admin' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_action := tg_table_name || '.' || lower(tg_op);
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := v_row->>'id';
  v_label := coalesce(v_row->>'title',v_row->>'name',v_row->>'key');
  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
    values(v_actor.id,v_actor.full_name,v_actor.email,v_action,tg_table_name,v_id,v_label,jsonb_build_object('operation',tg_op));
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists audit_platform_announcements on public.platform_announcements;
create trigger audit_platform_announcements after insert or update or delete on public.platform_announcements for each row execute function public.audit_platform_operation();
drop trigger if exists audit_platform_feature_flags on public.platform_feature_flags;
create trigger audit_platform_feature_flags after insert or update or delete on public.platform_feature_flags for each row execute function public.audit_platform_operation();

create or replace function public.set_school_operational_status(p_school_id uuid, p_status text, p_reason text)
returns public.schools language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_school public.schools%rowtype;
begin
  select * into v_actor from public.users where id=auth.uid();
  if v_actor.role <> 'super_admin' or not coalesce(v_actor.is_platform_owner,false) then raise exception 'Only a platform owner can change school status'; end if;
  if p_status not in ('new','setup','ready','active','inactive','suspended','archived') then raise exception 'Invalid school status'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required'; end if;
  update public.schools set operational_status=p_status, status_reason=trim(p_reason), status_changed_at=now(),
    status_changed_by=auth.uid(), archived_at=case when p_status='archived' then now() else null end
    where id=p_school_id returning * into v_school;
  if not found then raise exception 'School not found'; end if;
  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
    values(v_actor.id,v_actor.full_name,v_actor.email,'school.status_change','school',v_school.id::text,v_school.name,
      jsonb_build_object('status',p_status,'reason',trim(p_reason)));
  return v_school;
end $$;
revoke all on function public.set_school_operational_status(uuid,text,text) from public, anon;
grant execute on function public.set_school_operational_status(uuid,text,text) to authenticated;

create or replace function public.get_platform_operations_snapshot()
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_role text; v_result jsonb;
begin
  select role into v_role from public.users where id=auth.uid();
  if v_role <> 'super_admin' then raise exception 'Super admin access required'; end if;
  with school_usage as (
    select s.id,s.name,s.address,s.operational_status,s.status_reason,s.created_at,s.status_changed_at,
      (select count(*) from public.users u where u.school_id=s.id and u.role='school_admin')::int admins,
      (select count(*) from public.users u where u.school_id=s.id and u.role='instructor')::int instructors,
      (select count(*) from public.students st where st.school_id=s.id)::int students,
      (select count(*) from public.sections sec where sec.school_id=s.id)::int sections,
      (select count(*) from public.schedules sch where sch.school_id=s.id)::int schedules,
      (select max(ar.recorded_at) from public.attendance_records ar join public.schedules sch on sch.id=ar.schedule_id where sch.school_id=s.id) last_attendance,
      (select count(*) from public.support_threads t where t.school_id=s.id and t.status='open')::int open_support,
      exists(select 1 from public.academic_years ay where ay.school_id=s.id and ay.status='active') has_active_year
    from public.schools s
  ), notification_health as (
    select count(*)::int attempts, count(*) filter(where status='delivered')::int delivered,
      count(*) filter(where status='failed')::int failed from public.notification_logs where created_at >= now()-interval '24 hours'
  )
  select jsonb_build_object(
    'schools',coalesce((select jsonb_agg(to_jsonb(school_usage) order by name) from school_usage),'[]'::jsonb),
    'totals',jsonb_build_object('schools',(select count(*) from school_usage),'active',(select count(*) from school_usage where operational_status='active'),
      'attention',(select count(*) from school_usage where operational_status in ('new','setup','inactive','suspended')),
      'students',(select coalesce(sum(students),0) from school_usage),'instructors',(select coalesce(sum(instructors),0) from school_usage)),
    'notifications',(select to_jsonb(notification_health) from notification_health),
    'open_health_events',(select count(*) from public.platform_health_events where resolved_at is null),
    'open_support',(select count(*) from public.support_threads where status='open')
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.get_platform_operations_snapshot() from public, anon;
grant execute on function public.get_platform_operations_snapshot() to authenticated;

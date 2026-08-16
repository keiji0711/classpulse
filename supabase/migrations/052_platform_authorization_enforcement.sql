-- Server-enforced platform permissions and administrator assurance.

-- Policies that previously inspected users.role directly bypassed the scoped
-- platform-staff model and MFA-aware get_user_role().
drop policy if exists "super_admin_all_exam_scores" on public.exam_scores;
create policy "platform owners manage exam scores" on public.exam_scores for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "Super admins manage all invoices" on public.school_invoices;
create policy "platform owners manage all invoices" on public.school_invoices for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "Super admins read all email logs" on public.email_logs;
create policy "platform owners read all email logs" on public.email_logs for select
  using (public.is_platform_owner());

drop policy if exists "platform owners manage announcements" on public.platform_announcements;
create policy "platform owners manage announcements" on public.platform_announcements for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "platform owners manage flags" on public.platform_feature_flags;
create policy "platform owners manage flags" on public.platform_feature_flags for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "platform owners manage health" on public.platform_health_events;
create policy "platform owners manage health" on public.platform_health_events for all
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "platform staff read announcements" on public.platform_announcements;
create policy "platform staff read announcements" on public.platform_announcements for select
  using (public.has_platform_permission('operations'));

drop policy if exists "platform staff read flags" on public.platform_feature_flags;
create policy "platform staff read flags" on public.platform_feature_flags for select
  using (public.has_platform_permission('operations'));

drop policy if exists "platform staff read health" on public.platform_health_events;
create policy "platform staff read health" on public.platform_health_events for select
  using (public.has_platform_permission('operations'));

-- A scoped analyst may inspect school operations but cannot change them.
create or replace function public.get_platform_operations_snapshot()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.has_platform_permission('operations') then
    raise exception 'Platform operations permission with MFA is required';
  end if;
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
end;
$$;
revoke all on function public.get_platform_operations_snapshot() from public, anon;
grant execute on function public.get_platform_operations_snapshot() to authenticated;

create or replace function public.get_student_counts_by_school()
returns table (school_id uuid, student_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.has_platform_permission('schools') then
    raise exception 'Schools permission with MFA is required';
  end if;
  return query select s.school_id, count(*) from public.students s group by s.school_id;
end;
$$;
revoke all on function public.get_student_counts_by_school() from public, anon;
grant execute on function public.get_student_counts_by_school() to authenticated;

create or replace function public.set_school_operational_status(p_school_id uuid, p_status text, p_reason text)
returns public.schools
language plpgsql
security definer
set search_path = public
as $$
declare v_actor public.users%rowtype; v_school public.schools%rowtype;
begin
  if not public.is_platform_owner() then
    raise exception 'Platform owner access with MFA is required';
  end if;
  select * into v_actor from public.users where id=auth.uid();
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
end;
$$;

-- MFA cannot be made optional for administrator accounts. This preserves the
-- existing API shape while enforcing the platform policy server-side.
create or replace function public.set_admin_mfa_requirement(p_user_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor public.users%rowtype; target public.users%rowtype;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access with MFA is required'; end if;
  if not p_required then raise exception 'MFA is mandatory for administrator accounts'; end if;
  select * into actor from public.users where id=auth.uid();
  select * into target from public.users where id=p_user_id and role in ('super_admin','school_admin');
  if target.id is null then raise exception 'Administrator not found'; end if;
  insert into public.admin_security_profiles(user_id,mfa_required,updated_by,updated_at)
  values(target.id,true,actor.id,now())
  on conflict(user_id) do update set mfa_required=true,updated_by=actor.id,updated_at=now();
  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
  values(actor.id,actor.full_name,actor.email,'security.mfa_requirement','user',target.id::text,target.email,jsonb_build_object('required',true));
end;
$$;

-- Security/reliability control-plane functions are owner-only, including MFA.
create or replace function public.resolve_application_error(p_error_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access with MFA is required'; end if;
  update public.application_error_events set resolved_at=now(),resolved_by=auth.uid() where id=p_error_id;
end;
$$;

revoke all on function public.set_admin_mfa_requirement(uuid, boolean) from public, anon;
revoke all on function public.resolve_application_error(uuid) from public, anon;
grant execute on function public.set_admin_mfa_requirement(uuid, boolean) to authenticated;
grant execute on function public.resolve_application_error(uuid) to authenticated;

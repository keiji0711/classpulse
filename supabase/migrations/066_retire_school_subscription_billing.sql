-- Retire school subscription fees while preserving legacy records for audit.
-- Monthly parent-access billing remains active and is intentionally untouched.

update public.plans set is_active = false where is_active = true;

create or replace function public.get_school_entitlements(p_school_id uuid default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_role text; v_school_id uuid; v_school_exists boolean;
begin
  v_role := public.get_user_role();
  v_school_id := coalesce(p_school_id, public.get_user_school_id());

  if v_role = 'super_admin' and p_school_id is null then
    return jsonb_build_object('school_id',null,'status','active','has_access',true,
      'plan_code','platform_owner','plan_name','Platform Owner',
      'features',jsonb_build_object('attendance_take',true,'grades_manage',true,
        'exports_download',true,'parent_messaging',true,'analytics_advanced',true),
      'limits','{}'::jsonb,'grace_until',null,'current_period_end',null);
  end if;

  if v_role <> 'super_admin' and p_school_id is not null
     and p_school_id is distinct from public.get_user_school_id() then
    return jsonb_build_object('school_id',p_school_id,'status','inactive','has_access',false,
      'plan_code',null,'plan_name',null,'features','{}'::jsonb,'limits','{}'::jsonb,
      'grace_until',null,'current_period_end',null);
  end if;

  select exists(select 1 from public.schools where id = v_school_id) into v_school_exists;
  if v_school_id is null or not v_school_exists then
    return jsonb_build_object('school_id',v_school_id,'status','inactive','has_access',false,
      'plan_code',null,'plan_name',null,'features','{}'::jsonb,'limits','{}'::jsonb,
      'grace_until',null,'current_period_end',null);
  end if;

  return jsonb_build_object('school_id',v_school_id,'status','active','has_access',true,
    'plan_code','school_access','plan_name','School Access',
    'features',jsonb_build_object('attendance_take',true,'grades_manage',true,
      'exports_download',true,'parent_messaging',true,'analytics_advanced',true),
    'limits','{}'::jsonb,'grace_until',null,'current_period_end',null);
end $$;

create or replace function public.current_user_has_feature(p_feature_key text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare v_role text; v_school_id uuid;
begin
  perform p_feature_key;
  select role, school_id into v_role, v_school_id from public.users where id = auth.uid();
  return v_role = 'super_admin'
    or (v_role in ('school_admin','instructor') and v_school_id is not null);
end $$;

comment on table public.school_subscriptions is 'Historical records; school subscription billing retired in migration 066.';
comment on table public.school_invoices is 'Historical records; new school invoices are no longer generated.';
comment on table public.plans is 'Historical school plan catalog retired in migration 066.';

-- Require the platform owner to configure the parent-access fee when a school
-- is created, and keep school details + billing settings in one transaction.

create or replace function public.create_school_with_parent_billing(
  p_name text,
  p_address text,
  p_monthly_price numeric
)
returns public.schools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school public.schools%rowtype;
  v_price numeric(10,2);
begin
  if public.get_user_role() <> 'super_admin' then
    raise exception 'Platform owner access required';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'School name is required';
  end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then
    raise exception 'School address is required';
  end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 999999.99 then
    raise exception 'Monthly parent fee must be between 0.01 and 999999.99';
  end if;

  v_price := round(p_monthly_price, 2);

  insert into public.schools (name, address, subscription_mode)
  values (trim(p_name), trim(p_address), 'school_paid')
  returning * into v_school;

  insert into public.parent_access_billing_settings (
    school_id, monthly_price, grace_days, billing_enabled, updated_by, updated_at
  ) values (
    v_school.id, v_price, 5, true, auth.uid(), now()
  );

  return v_school;
end;
$$;

revoke all on function public.create_school_with_parent_billing(text, text, numeric) from public;
grant execute on function public.create_school_with_parent_billing(text, text, numeric) to authenticated;

create or replace function public.update_school_with_parent_billing(
  p_school_id uuid,
  p_name text,
  p_address text,
  p_monthly_price numeric
)
returns public.schools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school public.schools%rowtype;
  v_price numeric(10,2);
begin
  if public.get_user_role() <> 'super_admin' then
    raise exception 'Platform owner access required';
  end if;
  if p_school_id is null then
    raise exception 'School is required';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'School name is required';
  end if;
  if nullif(trim(coalesce(p_address, '')), '') is null then
    raise exception 'School address is required';
  end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 999999.99 then
    raise exception 'Monthly parent fee must be between 0.01 and 999999.99';
  end if;

  v_price := round(p_monthly_price, 2);

  update public.schools
  set name = trim(p_name), address = trim(p_address), subscription_mode = 'school_paid'
  where id = p_school_id
  returning * into v_school;

  if v_school.id is null then
    raise exception 'School not found';
  end if;

  insert into public.parent_access_billing_settings (
    school_id, monthly_price, grace_days, billing_enabled, updated_by, updated_at
  ) values (
    v_school.id, v_price, 5, true, auth.uid(), now()
  )
  on conflict (school_id) do update set
    monthly_price = excluded.monthly_price,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return v_school;
end;
$$;

revoke all on function public.update_school_with_parent_billing(uuid, text, text, numeric) from public;
grant execute on function public.update_school_with_parent_billing(uuid, text, text, numeric) to authenticated;

-- Administrators must be able to record their first verified factor even while
-- their operational role is intentionally blocked pending AAL2.

create or replace function public.set_own_mfa_enrollment(p_enrolled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  select * into v_user from public.users where id=auth.uid();
  if v_user.id is null or v_user.account_status <> 'active'
     or v_user.role not in ('super_admin','school_admin') then
    raise exception 'Active administrator account required';
  end if;
  if not p_enrolled then
    raise exception 'MFA is mandatory for administrator accounts';
  end if;
  if public.current_auth_aal() <> 'aal2' then
    raise exception 'A verified MFA challenge is required';
  end if;

  insert into public.admin_security_profiles(
    user_id,mfa_required,mfa_enrolled,mfa_enrolled_at,updated_by,updated_at
  ) values(v_user.id,true,true,now(),v_user.id,now())
  on conflict(user_id) do update set
    mfa_required=true,mfa_enrolled=true,mfa_enrolled_at=now(),
    updated_by=v_user.id,updated_at=now();
end;
$$;

revoke all on function public.set_own_mfa_enrollment(boolean) from public, anon;
grant execute on function public.set_own_mfa_enrollment(boolean) to authenticated;


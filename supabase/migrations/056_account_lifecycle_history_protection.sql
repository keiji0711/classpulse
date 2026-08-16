-- Deactivation replaces hard deletion for staff accounts so official schedules,
-- attendance, grades, and exam history cannot disappear through FK cascades.

alter table public.users add column if not exists account_status text not null default 'active';
alter table public.users drop constraint if exists users_account_status_check;
alter table public.users add constraint users_account_status_check check(account_status in ('active','deactivated'));
alter table public.users add column if not exists deactivated_at timestamptz;
alter table public.users add column if not exists deactivated_by uuid references public.users(id) on delete set null;
create index if not exists idx_users_account_status on public.users(account_status,role,school_id);

alter table public.users drop constraint if exists users_id_fkey;
alter table public.users add constraint users_id_fkey foreign key(id) references auth.users(id) on delete restrict;
alter table public.schedules drop constraint if exists schedules_instructor_id_fkey;
alter table public.schedules add constraint schedules_instructor_id_fkey foreign key(instructor_id) references public.users(id) on delete restrict;
alter table public.attendance_records drop constraint if exists attendance_records_recorded_by_fkey;
alter table public.attendance_records add constraint attendance_records_recorded_by_fkey foreign key(recorded_by) references public.users(id) on delete restrict;
alter table public.grades drop constraint if exists grades_created_by_fkey;
alter table public.grades add constraint grades_created_by_fkey foreign key(created_by) references public.users(id) on delete restrict;
alter table public.exam_scores drop constraint if exists exam_scores_created_by_fkey;
alter table public.exam_scores add constraint exam_scores_created_by_fkey foreign key(created_by) references public.users(id) on delete restrict;
alter table public.support_threads drop constraint if exists support_threads_instructor_user_id_fkey;
alter table public.support_threads add constraint support_threads_instructor_user_id_fkey foreign key(instructor_user_id) references public.users(id) on delete set null;

create or replace function public.get_user_role()
returns text language sql security definer stable set search_path=public as $$
  select case
    when u.account_status<>'active' then 'deactivated'
    when u.role in ('super_admin','school_admin') and coalesce(s.mfa_required,false) and public.current_auth_aal()<>'aal2' then 'mfa_pending'
    when u.role='super_admin' and not coalesce(u.is_platform_owner,false) then 'platform_staff'
    else u.role end
  from public.users u left join public.admin_security_profiles s on s.user_id=u.id where u.id=auth.uid();
$$;

create or replace function public.is_platform_owner()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin'
    and u.account_status='active' and u.is_platform_owner=true and public.current_auth_aal()='aal2');
$$;

create or replace function public.has_platform_permission(p_permission text)
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.users u where u.id=auth.uid() and u.role='super_admin' and u.account_status='active'
    and public.current_auth_aal()='aal2' and (u.is_platform_owner=true or p_permission=any(u.permissions)));
$$;

drop policy if exists "super_admin_all_users" on public.users;
drop policy if exists "school_admin_manage_users" on public.users;
create policy "platform owners read users" on public.users for select using(public.is_platform_owner());
create policy "school admins read school users" on public.users for select
  using(public.get_user_role()='school_admin' and school_id=public.get_user_school_id());
drop policy if exists "platform owners update users" on public.users;
drop policy if exists "school admins update school users" on public.users;
drop policy if exists "users update own basic profile" on public.users;

create or replace function public.update_user_profile(
  p_user_id uuid,p_full_name text,p_phone_number text default null,p_address text default null,p_school_id uuid default null
)
returns public.users language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;v_target public.users%rowtype;v_result public.users%rowtype;v_allowed boolean:=false;
begin
  select * into v_actor from public.users where id=auth.uid();
  select * into v_target from public.users where id=p_user_id;
  if v_actor.id is null or v_target.id is null or v_actor.account_status<>'active' then raise exception 'Active account required'; end if;
  if v_actor.id=v_target.id then v_allowed:=true;
  elsif public.is_platform_owner() and v_target.role='school_admin' then v_allowed:=true;
  elsif public.get_user_role()='school_admin' and v_target.role='instructor' and v_target.school_id=v_actor.school_id then v_allowed:=true;
  end if;
  if not v_allowed then raise exception 'Not authorized to update this profile'; end if;
  if nullif(trim(coalesce(p_full_name,'')),'') is null then raise exception 'Full name is required'; end if;
  update public.users set full_name=left(trim(p_full_name),200),
    phone_number=case when p_phone_number is null then phone_number else left(trim(p_phone_number),50) end,
    address=case when p_address is null then address else left(trim(p_address),500) end,
    school_id=case when public.is_platform_owner() and v_target.role='school_admin' then p_school_id else school_id end
  where id=p_user_id returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.update_user_profile(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.update_user_profile(uuid,text,text,text,uuid) to authenticated;

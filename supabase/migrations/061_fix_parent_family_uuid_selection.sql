-- PostgreSQL has no min(uuid) aggregate. Select one candidate school and keep
-- the existing explicit same-school/count validations for the complete array.
create or replace function public.link_parent_family(p_parent_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_school_id uuid;
  v_family_id uuid := gen_random_uuid();
  v_expected integer;
  v_updated integer;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or public.get_user_role() not in ('school_admin', 'super_admin') then
    raise exception 'Administrator access with MFA is required';
  end if;
  if coalesce(array_length(p_parent_ids, 1), 0) < 2 then
    raise exception 'Select at least two guardian records';
  end if;

  v_expected := array_length(p_parent_ids, 1);
  select school_id into v_school_id
  from public.parents where id = any(p_parent_ids)
  limit 1;

  if v_school_id is null
     or (v_actor.role = 'school_admin' and v_school_id <> v_actor.school_id)
     or exists(select 1 from public.parents where id = any(p_parent_ids) and school_id <> v_school_id)
     or (select count(*) from public.parents where id = any(p_parent_ids)) <> v_expected then
    raise exception 'Guardian records must exist in the same authorized school';
  end if;

  update public.parents set family_id = v_family_id where id = any(p_parent_ids);
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then raise exception 'Not all guardian records were linked'; end if;

  insert into public.admin_audit_log(
    actor_id, actor_name, actor_email, action, target_type, target_id,
    target_label, details
  ) values (
    v_actor.id, v_actor.full_name, v_actor.email, 'guardian.family_linked',
    'guardian_family', v_family_id::text, 'Linked guardian family',
    jsonb_build_object('parent_ids', p_parent_ids, 'school_id', v_school_id)
  );
  return v_family_id;
end;
$$;
revoke all on function public.link_parent_family(uuid[]) from public, anon;
grant execute on function public.link_parent_family(uuid[]) to authenticated;


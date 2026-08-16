-- Authenticated account-deletion requests and audited review workflow.

create or replace function public.request_own_account_deletion(p_reason text)
returns public.data_deletion_requests
language plpgsql security definer set search_path = public as $$
declare v_actor public.users%rowtype; v_result public.data_deletion_requests%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Please provide a reason of at least 10 characters'; end if;
  if exists (select 1 from public.data_deletion_requests where requester_user_id = v_actor.id and target_type = 'user' and target_id = v_actor.id and status in ('pending','approved','scheduled')) then
    raise exception 'You already have an active deletion request';
  end if;
  insert into public.data_deletion_requests(school_id, requester_user_id, requester_email, target_type, target_id, reason)
  values(v_actor.school_id, v_actor.id, v_actor.email, 'user', v_actor.id, left(trim(p_reason), 2000))
  returning * into v_result;
  return v_result;
end;
$$;
grant execute on function public.request_own_account_deletion(text) to authenticated;

create or replace function public.review_data_deletion_request(p_request_id uuid, p_status text, p_notes text)
returns public.data_deletion_requests
language plpgsql security definer set search_path = public as $$
declare v_actor public.users%rowtype; v_request public.data_deletion_requests%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.role <> 'super_admin' then raise exception 'Platform owner access required'; end if;
  if p_status not in ('approved','rejected','cancelled') then raise exception 'Invalid review decision'; end if;
  update public.data_deletion_requests set
    status = p_status,
    reviewed_by = v_actor.id,
    reviewed_at = now(),
    review_notes = nullif(trim(p_notes), ''),
    scheduled_for = case when p_status = 'approved' then now() + interval '7 days' else null end,
    updated_at = now()
  where id = p_request_id and status = 'pending'
  returning * into v_request;
  if v_request.id is null then raise exception 'Pending deletion request not found'; end if;
  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
  values(v_actor.id,v_actor.full_name,v_actor.email,'data_deletion.review','deletion_request',v_request.id::text,v_request.requester_email,jsonb_build_object('decision',p_status,'scheduled_for',v_request.scheduled_for,'notes',p_notes));
  return v_request;
end;
$$;
grant execute on function public.review_data_deletion_request(uuid, text, text) to authenticated;

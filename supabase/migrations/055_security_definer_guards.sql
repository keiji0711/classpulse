-- Close SECURITY DEFINER paths that inspected the raw users.role column and
-- therefore bypassed MFA/scoped-platform authorization.

create or replace function public.record_parent_access_payment(
  p_student_id uuid,p_billing_month date default public.parent_billing_month(),
  p_action text default 'paid',p_amount numeric default null,
  p_payment_reference text default null,p_notes text default null
)
returns public.parent_access_payments language plpgsql security definer set search_path=public as $$
declare
  v_actor public.users%rowtype; v_effective_role text; v_student public.students%rowtype;
  v_parent_id uuid; v_price numeric(10,2):=20; v_month date:=date_trunc('month',p_billing_month)::date;
  v_allowed boolean:=false; v_result public.parent_access_payments%rowtype;
begin
  select * into v_actor from public.users where id=auth.uid();
  v_effective_role:=public.get_user_role();
  if v_actor.id is null or v_effective_role not in ('instructor','school_admin','super_admin') then
    raise exception 'Authorized school staff access is required';
  end if;
  select * into v_student from public.students where id=p_student_id;
  if v_student.id is null then raise exception 'Student not found'; end if;
  if v_effective_role='super_admin' then v_allowed:=public.is_platform_owner();
  elsif v_effective_role='school_admin' and v_actor.school_id=v_student.school_id then v_allowed:=true;
  elsif v_effective_role='instructor' and v_actor.school_id=v_student.school_id then
    select exists(select 1 from public.sections sec where sec.id=v_student.section_id and sec.adviser_id=v_actor.id)
      or exists(select 1 from public.student_enrollments e join public.sections sec on sec.id=e.section_id
        where e.student_id=v_student.id and sec.adviser_id=v_actor.id) into v_allowed;
  end if;
  if not v_allowed then raise exception 'You cannot manage payment access for this student'; end if;
  if p_action not in ('paid','waived','refunded') then raise exception 'Invalid payment action'; end if;
  select monthly_price into v_price from public.parent_access_billing_settings where school_id=v_student.school_id;
  v_price:=coalesce(v_price,20);
  select id into v_parent_id from public.parents where student_id=v_student.id order by created_at limit 1;
  insert into public.parent_access_payments(school_id,student_id,parent_id,billing_month,status,amount_due,amount_paid,
    payment_method,payment_reference,notes,collected_by,collected_at,remittance_status,updated_at)
  values(v_student.school_id,v_student.id,v_parent_id,v_month,p_action,v_price,
    case when p_action='paid' then coalesce(p_amount,v_price) else 0 end,'cash',nullif(trim(p_payment_reference),''),
    nullif(trim(p_notes),''),v_actor.id,case when p_action in ('paid','waived') then now() else null end,'pending',now())
  on conflict(student_id,billing_month) do update set parent_id=excluded.parent_id,status=excluded.status,
    amount_due=excluded.amount_due,amount_paid=excluded.amount_paid,payment_reference=excluded.payment_reference,
    notes=excluded.notes,collected_by=excluded.collected_by,collected_at=excluded.collected_at,
    remittance_status='pending',remitted_at=null,verified_by=null,verified_at=null,updated_at=now()
  returning * into v_result;
  insert into public.student_notification_preferences(student_id,school_id,enabled,updated_by,updated_at)
  values(v_student.id,v_student.school_id,p_action<>'refunded',v_actor.id,now())
  on conflict(student_id) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  return v_result;
end;
$$;

create or replace function public.verify_parent_access_payment(p_payment_id uuid)
returns public.parent_access_payments language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;v_payment public.parent_access_payments%rowtype;v_role text;
begin
  select * into v_actor from public.users where id=auth.uid();v_role:=public.get_user_role();
  select * into v_payment from public.parent_access_payments where id=p_payment_id;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if not ((v_role='super_admin' and public.is_platform_owner()) or
    (v_role='school_admin' and v_actor.school_id=v_payment.school_id)) then
    raise exception 'Only an authorized administrator with MFA can verify collections';
  end if;
  update public.parent_access_payments set remittance_status='verified',remitted_at=coalesce(remitted_at,now()),
    verified_by=v_actor.id,verified_at=now(),updated_at=now() where id=p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.get_school_parent_collection_summary(p_billing_month date default public.parent_billing_month())
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_actor public.users%rowtype;v_month date:=date_trunc('month',p_billing_month)::date;v_price numeric:=20;v_result jsonb;
begin
  select * into v_actor from public.users where id=auth.uid();
  if public.get_user_role()<>'school_admin' or v_actor.school_id is null then raise exception 'School administrator access with MFA is required'; end if;
  select monthly_price into v_price from public.parent_access_billing_settings where school_id=v_actor.school_id;v_price:=coalesce(v_price,20);
  select jsonb_build_object('billing_month',v_month,'monthly_price',v_price,
    'eligible',(select count(*) from public.students where school_id=v_actor.school_id),
    'paid',(select count(*) from public.parent_access_payments where school_id=v_actor.school_id and billing_month=v_month and status='paid'),
    'waived',(select count(*) from public.parent_access_payments where school_id=v_actor.school_id and billing_month=v_month and status='waived'),
    'collected',coalesce((select sum(amount_paid) from public.parent_access_payments where school_id=v_actor.school_id and billing_month=v_month and status='paid'),0),
    'verified',coalesce((select sum(amount_paid) from public.parent_access_payments where school_id=v_actor.school_id and billing_month=v_month and status='paid' and remittance_status='verified'),0),
    'pending_verification',(select count(*) from public.parent_access_payments where school_id=v_actor.school_id and billing_month=v_month and status='paid' and remittance_status<>'verified')) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_school_parent_collection_rows(
  p_billing_month date default public.parent_billing_month(),p_search text default '',p_limit integer default 50,p_offset integer default 0
)
returns table(student_id uuid,student_name text,lrn text,section_name text,guardian_name text,payment_id uuid,
  payment_status text,amount_paid numeric,collected_at timestamptz,collector_name text,remittance_status text,
  access_enabled boolean,total_count bigint)
language plpgsql security definer stable set search_path=public as $$
declare v_actor public.users%rowtype;v_month date:=date_trunc('month',p_billing_month)::date;v_query text:='%'||lower(trim(coalesce(p_search,'')))||'%';
begin
  select * into v_actor from public.users where id=auth.uid();
  if public.get_user_role()<>'school_admin' or v_actor.school_id is null then raise exception 'School administrator access with MFA is required'; end if;
  return query select st.id,concat_ws(' ',st.first_name,nullif(st.middle_name,''),st.last_name),st.lrn,
    trim(concat_ws(' · ',sec.grade_level,sec.name)),coalesce(parent.guardian_name,''),payment.id,
    coalesce(payment.status,'unpaid'),coalesce(payment.amount_paid,0),payment.collected_at,coalesce(collector.full_name,''),
    coalesce(payment.remittance_status,'pending'),public.parent_access_is_enabled(st.id),count(*) over()
  from public.students st left join public.sections sec on sec.id=st.section_id
  left join lateral(select p.guardian_name from public.parents p where p.student_id=st.id order by p.created_at limit 1) parent on true
  left join public.parent_access_payments payment on payment.student_id=st.id and payment.billing_month=v_month
  left join public.users collector on collector.id=payment.collected_by
  where st.school_id=v_actor.school_id and (trim(coalesce(p_search,''))='' or lower(concat_ws(' ',st.first_name,st.middle_name,st.last_name)) like v_query
    or lower(st.lrn) like v_query or lower(coalesce(parent.guardian_name,'')) like v_query or lower(concat_ws(' ',sec.grade_level,sec.name)) like v_query)
  order by st.last_name,st.first_name limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end;
$$;

create or replace function public.review_data_deletion_request(p_request_id uuid,p_status text,p_notes text)
returns public.data_deletion_requests language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;v_request public.data_deletion_requests%rowtype;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access with MFA is required'; end if;
  select * into v_actor from public.users where id=auth.uid();
  if p_status not in ('approved','rejected','cancelled') then raise exception 'Invalid review decision'; end if;
  update public.data_deletion_requests set status=p_status,reviewed_by=v_actor.id,reviewed_at=now(),
    review_notes=nullif(trim(p_notes),''),scheduled_for=case when p_status='approved' then now()+interval '7 days' else null end,updated_at=now()
  where id=p_request_id and status='pending' returning * into v_request;
  if v_request.id is null then raise exception 'Pending deletion request not found'; end if;
  insert into public.admin_audit_log(actor_id,actor_name,actor_email,action,target_type,target_id,target_label,details)
  values(v_actor.id,v_actor.full_name,v_actor.email,'data_deletion.review','deletion_request',v_request.id::text,v_request.requester_email,
    jsonb_build_object('decision',p_status,'scheduled_for',v_request.scheduled_for,'notes',p_notes));
  return v_request;
end;
$$;

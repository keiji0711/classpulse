-- Let advisers distinguish verified Google Play access from unpaid students,
-- without exposing subscription transaction identifiers to the mobile client.

create or replace function public.get_adviser_google_play_access()
returns table(student_id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or public.get_user_role() <> 'instructor' then
    raise exception 'Instructor access is required';
  end if;

  return query
  select distinct student.id
  from public.students student
  join public.parents parent
    on parent.student_id = student.id
    and parent.school_id = student.school_id
  join public.parent_access_subscriptions subscription
    on subscription.family_id = parent.family_id
    and subscription.school_id = parent.school_id
  where student.school_id = v_actor.school_id
    and subscription.provider = 'google_play'
    and subscription.entitlement_id = 'parent_access'
    and subscription.status = 'active'
    and (subscription.expires_at is null or subscription.expires_at > now())
    and (
      exists (
        select 1 from public.sections section
        where section.id = student.section_id and section.adviser_id = v_actor.id
      )
      or exists (
        select 1
        from public.student_enrollments enrollment
        join public.sections section on section.id = enrollment.section_id
        where enrollment.student_id = student.id and section.adviser_id = v_actor.id
      )
    );
end;
$$;

revoke all on function public.get_adviser_google_play_access() from public;
grant execute on function public.get_adviser_google_play_access() to authenticated;

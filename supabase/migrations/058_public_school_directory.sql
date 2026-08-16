-- Expose only the two fields required by the unauthenticated parent login
-- picker. A row policy cannot provide column-level privacy.

drop policy if exists "anon_read_schools" on public.schools;

create or replace function public.list_login_schools()
returns table(id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select school.id, school.name
  from public.schools school
  where school.operational_status not in ('inactive','suspended','archived')
  order by school.name;
$$;

revoke all on function public.list_login_schools() from public;
grant execute on function public.list_login_schools() to anon, authenticated;


-- Safe scheduled maintenance. Destructive retention runs only for policies an
-- owner has explicitly enabled; archive policies are never deleted here.

create table if not exists public.maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check(status in ('running','completed','failed')),
  details jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.maintenance_runs enable row level security;
create policy "platform owners read maintenance runs" on public.maintenance_runs for select
  using(public.is_platform_owner());

create or replace function public.execute_enabled_retention()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_policy public.data_retention_policies%rowtype;
  v_count integer;
  v_result jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  for v_policy in select * from public.data_retention_policies where enabled and action='delete'
  loop
    v_count := 0;
    case v_policy.data_type
      when 'notification_logs' then
        delete from public.notification_logs where created_at < now()-make_interval(days=>v_policy.retention_days);
      when 'security_login_events' then
        delete from public.security_login_events where created_at < now()-make_interval(days=>v_policy.retention_days);
      when 'application_error_events' then
        delete from public.application_error_events where created_at < now()-make_interval(days=>v_policy.retention_days);
      else
        continue;
    end case;
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object(v_policy.data_type,v_count);
  end loop;
  return v_result;
end;
$$;
revoke all on function public.execute_enabled_retention() from public,anon,authenticated;
grant execute on function public.execute_enabled_retention() to service_role;

revoke all on public.maintenance_runs from anon,authenticated;
grant select on public.maintenance_runs to authenticated;
grant all on public.maintenance_runs to service_role;


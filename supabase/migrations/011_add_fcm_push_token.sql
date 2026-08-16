alter table public.parents
  add column if not exists fcm_push_token text;

create index if not exists idx_parents_fcm_push_token
  on public.parents (fcm_push_token)
  where fcm_push_token is not null;

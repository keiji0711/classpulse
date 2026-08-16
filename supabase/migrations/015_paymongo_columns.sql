-- Add PayMongo tracking columns to parent_subscriptions
alter table public.parent_subscriptions
  add column if not exists paymongo_source_id text,
  add column if not exists paymongo_payment_id text;

create index if not exists idx_parent_subs_source_id
  on public.parent_subscriptions(paymongo_source_id)
  where paymongo_source_id is not null;

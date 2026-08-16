-- Add email column to parents table so parents can receive receipts
alter table public.parents
  add column if not exists email text;

create index if not exists idx_parents_email
  on public.parents (email)
  where email is not null;

-- Add PIN hash column to parents table for secure authentication
alter table public.parents add column if not exists pin_hash text;

comment on column public.parents.pin_hash is 'Bcrypt hash of the parent 4-digit PIN';

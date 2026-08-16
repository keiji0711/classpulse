-- Enable Realtime for grades table
alter table public.grades replica identity full;

-- Add to realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and tablename = 'grades'
  ) then
    alter publication supabase_realtime add table public.grades;
  end if;
end $$;
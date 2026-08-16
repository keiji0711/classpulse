-- Allow anonymous users to read school names (for login dropdown)
drop policy if exists "anon_read_schools" on public.schools;
create policy "anon_read_schools" on public.schools
  for select using (true);

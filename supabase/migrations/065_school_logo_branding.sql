-- School branding assets are public, but only the authenticated administrator
-- for a school may create or remove objects inside that school's folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-logos',
  'school-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "school_admin_upload_own_logo" on storage.objects;
create policy "school_admin_upload_own_logo"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'school-logos'
  and public.get_user_role() = 'school_admin'
  and (storage.foldername(name))[1] = public.get_user_school_id()::text
);

-- Storage returns object metadata after uploads. Keep that SELECT access
-- limited to the administrator's own school folder.
drop policy if exists "school_admin_read_own_logo_metadata" on storage.objects;
create policy "school_admin_read_own_logo_metadata"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'school-logos'
  and public.get_user_role() = 'school_admin'
  and (storage.foldername(name))[1] = public.get_user_school_id()::text
);

drop policy if exists "school_admin_update_own_logo" on storage.objects;
create policy "school_admin_update_own_logo"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'school-logos'
  and public.get_user_role() = 'school_admin'
  and (storage.foldername(name))[1] = public.get_user_school_id()::text
)
with check (
  bucket_id = 'school-logos'
  and public.get_user_role() = 'school_admin'
  and (storage.foldername(name))[1] = public.get_user_school_id()::text
);

drop policy if exists "school_admin_delete_own_logo" on storage.objects;
create policy "school_admin_delete_own_logo"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'school-logos'
  and public.get_user_role() = 'school_admin'
  and (storage.foldername(name))[1] = public.get_user_school_id()::text
);

-- Keep the broader schools row protected: this RPC changes only logo_url and
-- validates that the object path points into the caller's own Storage folder.
-- Storing the path rather than a caller-provided URL prevents remote tracking
-- URLs from being injected into the parent app.
create or replace function public.update_own_school_logo(p_logo_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school_id uuid;
  v_logo_path text := nullif(btrim(p_logo_path), '');
begin
  if auth.uid() is null or public.get_user_role() <> 'school_admin' then
    raise exception 'Only school administrators can update school branding';
  end if;

  v_school_id := public.get_user_school_id();
  if v_school_id is null then
    raise exception 'No school is assigned to this account';
  end if;

  if v_logo_path is not null and (
    length(v_logo_path) > 512
    or v_logo_path !~ (
      '^' || v_school_id::text || '/logo-[0-9]+\.(png|jpg|webp)$'
    )
  ) then
    raise exception 'Invalid school logo path';
  end if;

  update public.schools
  set logo_url = v_logo_path
  where id = v_school_id;

  if not found then
    raise exception 'School not found';
  end if;

  return v_logo_path;
end;
$$;

revoke all on function public.update_own_school_logo(text) from public;
grant execute on function public.update_own_school_logo(text) to authenticated;

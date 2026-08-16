-- ═══════════════════════════════════════════════════════════════════════
-- Platform Staff / IAM
-- Super admins are platform-level users. We add a permissions list and an
-- owner flag so the founder can invite staff with scoped access.
--   • is_platform_owner = full access + can manage staff
--   • permissions[]      = which super-admin modules a (non-owner) staff sees
-- Existing super admins are promoted to owners so no one is ever locked out.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.users
  add column if not exists permissions text[] not null default '{}';

alter table public.users
  add column if not exists is_platform_owner boolean not null default false;

-- Promote all current super admins to owners (preserves their full access).
update public.users set is_platform_owner = true where role = 'super_admin';

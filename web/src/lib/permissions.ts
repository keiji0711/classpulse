import type { AppUser } from '../types';

// Super-admin modules that can be granted to staff. Dashboard + Settings are
// always available to any platform user, so they're not listed here.
export const PERMISSIONS = [
  { key: 'schools', label: 'Schools' },
  { key: 'operations', label: 'Platform Operations' },
  { key: 'school_admins', label: 'School Admins' },
  { key: 'support', label: 'Support Inbox' },
  { key: 'staff', label: 'Staff / IAM' },
  { key: 'audit', label: 'Audit Log' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key) as PermissionKey[];

// Convenience presets shown when creating a staff member.
export const ROLE_PRESETS: { key: string; label: string; description: string; permissions: PermissionKey[] }[] = [
  { key: 'admin', label: 'Administrator', description: 'Full access to every module', permissions: [...ALL_PERMISSIONS] },
  { key: 'support', label: 'Support Agent', description: 'Support inbox only', permissions: ['support'] },
  { key: 'analyst', label: 'Analyst', description: 'Schools, operations & admins (read-heavy)', permissions: ['schools', 'operations', 'school_admins'] },
];

/**
 * A super_admin is a platform "owner" (full access + can manage staff) when the
 * owner flag is set. Before migration 030 the IAM columns are undefined — we
 * treat that as owner so existing admins are never locked out.
 */
export function isPlatformOwner(user: AppUser | null): boolean {
  if (!user || user.role !== 'super_admin') return false;
  if (user.is_platform_owner === undefined && user.permissions === undefined) return true;
  return user.is_platform_owner === true;
}

/** Whether a platform user may access a given super-admin module. */
export function canAccess(user: AppUser | null, perm: PermissionKey): boolean {
  if (!user || user.role !== 'super_admin') return false;
  if (isPlatformOwner(user)) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

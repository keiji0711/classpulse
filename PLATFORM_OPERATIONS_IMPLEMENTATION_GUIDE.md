# ClassPulse Platform Operations Release

## Purpose

This release converts the Super Admin area from a billing-oriented SaaS dashboard into a non-billing platform operations console.

## What was implemented

- Non-billing Super Admin dashboard
- School operational lifecycle: new, setup, ready, active, inactive, suspended, archived
- Audited school status changes requiring a reason
- Removal of direct school deletion from the UI
- School Control Center with usage and recent-activity information
- Derived onboarding checklist for every school
- Cross-school capacity view for students, teachers, admins, sections, and schedules
- System Health view with notification delivery and health events
- Platform announcements with audience and severity
- Announcement banner in school and instructor workspaces
- Platform feature flags for safe global releases
- Platform usage CSV export without student-level personal data
- Archive-first data-retention guidance
- Support ticket priority controls
- Platform operations permission for delegated Super Admin staff
- Audit triggers for announcements and feature flags
- School workspace guard for inactive, suspended, and archived tenants

## Database deployment

Apply this migration after `043_attendance_scaling.sql`:

```text
supabase/migrations/044_platform_operations.sql
```

The migration is backward-compatible. Existing schools are assigned `active` status. It does not delete billing tables or historical billing data; those legacy objects remain dormant so removal can be handled separately after a dependency audit.

## Required release order

1. Apply migration `044_platform_operations.sql` in the correct Supabase project.
2. Confirm the SQL editor reports success.
3. Refresh the Supabase schema cache if the new RPCs do not appear immediately.
4. Deploy the web build.
5. Sign out and sign back in as the platform owner.
6. Open **Platform Operations** from the Super Admin sidebar.

Do not deploy the web build before applying migration `044`; the new dashboard calls `get_platform_operations_snapshot()`.

## Database verification

Confirm these columns exist on `schools`:

- `operational_status`
- `status_reason`
- `status_changed_at`
- `status_changed_by`
- `archived_at`

Confirm these tables exist:

- `platform_announcements`
- `platform_feature_flags`
- `platform_health_events`

Confirm these RPCs exist:

- `get_platform_operations_snapshot`
- `set_school_operational_status`

Confirm support threads include:

- `priority`
- `category`
- `assigned_to`
- `internal_notes`
- `due_at`

## Smoke test

Use a designated test school for lifecycle checks.

1. Open School Control and select the test school.
2. Change it to `suspended` and enter a reason.
3. Confirm the audit log contains `school.status_change`.
4. Sign in as that school's administrator and confirm the unavailable-workspace screen appears.
5. Reactivate the school as platform owner.
6. Confirm the school administrator can enter again.
7. Publish an informational announcement.
8. Confirm it appears in a school or instructor workspace.
9. Create and toggle a test feature flag.
10. Confirm flag activity appears in the audit log.
11. Change a support ticket priority.
12. Download the platform usage CSV.

## Important security note

The workspace guard blocks suspended tenants in the official ClassPulse web application. Existing table RLS still provides school isolation, but it was not globally rewritten in this release to include operational status on every policy. If suspension must revoke all direct API access as well as application access, add a centralized database authorization guard or ban the school's Auth users through a secured server-side workflow. Treat this as the next security-hardening item before offering external API access.

## Verification completed

- TypeScript build: passed
- Vite production build: passed
- Automated test files: 2 passed
- Automated tests: 8/8 passed
- Migration required: `044_platform_operations.sql`
- Migration `044`: applied and production schema verified on 2026-08-05
- Production deployment: complete
- Canonical URL: `https://classpulse.pages.dev`
- Verified deployment snapshot: `https://d97380f4.classpulse.pages.dev`

## Files changed

- `supabase/migrations/044_platform_operations.sql`
- `web/src/pages/super-admin/PlatformOperationsPage.tsx`
- `web/src/pages/super-admin/Dashboard.tsx`
- `web/src/pages/super-admin/SchoolsPage.tsx`
- `web/src/pages/super-admin/SupportInboxPage.tsx`
- `web/src/components/DashboardLayout.tsx`
- `web/src/components/ProtectedRoute.tsx`
- `web/src/contexts/AuthContext.tsx`
- `web/src/lib/permissions.ts`
- `web/src/types/index.ts`
- `web/src/App.tsx`

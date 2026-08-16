# ClassPulse Architecture Hardening Report

Date: August 7, 2026  
Status: Production deployment completed; controlled user-flow acceptance testing recommended

## Executive assessment

ClassPulse has a sound SaaS foundation: a React web application, an Expo mobile application, Supabase Auth/Postgres/Edge Functions, school-scoped data, academic-year isolation, atomic attendance recording, and Cloudflare Pages delivery.

This hardening pass addressed the highest-risk gaps discovered in the architecture review: anonymous access to private records, service-role endpoint authorization, parent identity boundaries, platform permission enforcement, administrator MFA, account lifecycle integrity, teacher academic-record boundaries, distributed login throttling, notification retries, retention execution, and browser-heavy student analytics.

The hardened database, reviewed Edge Functions, scheduler, and matching web build are live in production. Migrations `051` through `063` are synchronized between local and remote history.

## Target architecture

```text
Parent mobile app ── ClassPulse parent JWT ──> Parent Edge Functions
                                                   │
Teacher/admin web ─ Supabase Auth + MFA ─────> RLS / staff Edge Functions
                                                   │
                                      Supabase Postgres
                                      ├─ tenant and year boundaries
                                      ├─ audit/security events
                                      ├─ notification logs and retry jobs
                                      └─ server-side risk analytics
                                                   │
Scheduled worker ─ shared cron secret ───────> retry + retention maintenance
```

## Implemented controls

### Tenant and parent privacy

- Removed unrestricted anonymous reads from attendance, messages, grades, parent subscriptions, academic years, and enrollments.
- Replaced anonymous `schools` table reads with `list_login_schools()`, which exposes only school ID and name.
- Parent endpoints now validate the signed parent session and the exact parent/student/school relationship before using the service role.
- Sibling switching uses explicit audited `family_id` relationships instead of matching guardian names.
- Parent sessions use a separate `APP_JWT_SECRET`, fixed issuer/audience claims, and a seven-day lifetime.
- First activation requires the LRN plus the last four digits of the guardian phone number before PIN setup.
- Parent login throttling is atomic and database-backed for both account and IP keys.

### Staff, platform, and MFA authorization

- Platform-owner operations require an owner account and AAL2 MFA.
- Delegated platform staff receive only named read permissions; they no longer inherit owner authority from the `super_admin` role string.
- MFA is mandatory for platform and school administrators, including future accounts.
- The MFA bootstrap flow can securely record the first verified factor while the operational role remains blocked.
- Administrator MFA cannot be made optional or disabled through the application.
- Service-role messaging, push, email, staff-management, support, and retry endpoints verify the caller and requested resource scope.
- Arbitrary email and legacy billing-email endpoints require the platform owner with MFA.

### Academic data integrity

- Grade and exam writes now prove that the teacher is assigned to the subject, section, learner roster, school, and academic year.
- Cross-school student/subject/year combinations are rejected by database triggers.
- Grade clearing is explicitly scoped to the selected academic year on web and mobile.
- Closed academic years remain protected by the existing read-only year guards.
- Student risk analytics now execute in PostgreSQL and return a bounded result instead of downloading full-school attendance and grade tables into the browser.

### Account and history lifecycle

- Staff removal is now reversible deactivation, not hard deletion.
- Deactivated users are banned from Auth, rejected by application auth contexts, and excluded from active staff lists.
- Foreign keys for schedules, attendance, grades, and exams use `RESTRICT` for staff history rather than cascade deletion.
- User profile changes use a scoped RPC so clients cannot change roles, permissions, or tenant ownership through a generic table update.

### Reliability and operations

- Notification failures create retry jobs; workers claim jobs atomically with `FOR UPDATE SKIP LOCKED`.
- The scheduled reliability worker retries attendance notifications with backoff, cancels stale device tokens, performs enabled retention, cleans throttle records, and records maintenance runs.
- `NotRegistered`/stale FCM tokens are removed and treated as a device re-registration condition, not endlessly retried.
- The Super Admin reliability workspace includes MFA coverage, login events, devices, delivery logs, retry jobs, application errors, retention policies, deletion requests, and backup/restore evidence.
- Web clients report application errors, and administrator devices send periodic heartbeats and honor revocation.
- CI builds and tests web/mobile code and rebuilds the full Supabase migration chain in a Docker-backed runner.

## Database migrations

| Migration | Purpose |
|---|---|
| `051_architecture_security_foundation.sql` | Private anonymous data, parent families, platform role/MFA base, distributed throttling |
| `052_platform_authorization_enforcement.sql` | Owner/permission enforcement for operational and control-plane APIs |
| `053_server_analytics_and_reliability.sql` | Risk analytics indexes/RPC and atomic job claiming |
| `054_automated_maintenance.sql` | Explicitly enabled retention and maintenance history |
| `055_security_definer_guards.sql` | School-scoped guards for payment, collection, and deletion RPCs |
| `056_account_lifecycle_history_protection.sql` | Deactivation, history-preserving FKs, secured profile updates |
| `057_teacher_academic_record_boundaries.sql` | Schedule/roster/tenant guards for grades and exams |
| `058_public_school_directory.sql` | Narrow pre-login school directory |
| `059_mfa_enrollment_bootstrap.sql` | Mandatory MFA bootstrap without administrator lockout |
| `060_secure_legacy_rpc_entrypoints.sql` | Active-account/MFA wrappers for attendance and year-end RPCs |
| `061_fix_parent_family_uuid_selection.sql` | PostgreSQL UUID compatibility fix found by remote schema lint |
| `062_reliability_scheduler_extensions.sql` | Supabase-native cron and HTTP scheduling extensions |
| `063_database_test_extension.sql` | pgTAP support for repeatable schema security checks |

## Verification and production deployment

- Web unit/security tests: 3 files, 17 tests passed.
- Web production build: passed (`tsc -b` and Vite production bundle).
- Mobile TypeScript validation: passed (`tsc --noEmit`).
- Architecture-critical ESLint set: passed.
- CI workflows added for application checks and a clean database rebuild with pgTAP security regression tests.
- Remote migration history matches through migration `063`.
- The ClassPulse `public` schema passed remote lint before the pgTAP test extension was installed; the extension's own internal functions are excluded from application-schema lint.
- Consolidated production security assertions all returned `true`.
- The narrow public school directory returned seven rows while direct anonymous table access returned zero.
- The five-minute Supabase-native reliability cron is active and its first worker run completed successfully (`claimed: 0`, `failed: 0`).
- Stale concurrent Edge deployments were detected through live rejection tests, redeployed sequentially, and verified by production source hash.
- Cloudflare Pages deployment completed at `https://cfd26ece.classpulse.pages.dev`; `https://classpulse.pages.dev` serves the new `index-Cj16APSc.js` bundle and its SPA login route returns HTTP 200.

The Docker-backed clean database rebuild remains delegated to CI because Docker Desktop is not running on this workstation.

## Deployment performed

1. Linked and verified production project `qqjaprrpstbqjlxghoot`.
2. Applied migrations `051` through `063` in order and corrected the UUID issue identified by remote lint in migration `061`.
3. Confirmed existing `APP_JWT_SECRET`; generated `RELIABILITY_CRON_SECRET` and stored its matching copy in encrypted Supabase Vault.
4. Deployed the reviewed parent, staff, notification, support, security, and reliability functions.
5. Installed and verified a Supabase-native five-minute cron schedule, removing the need for GitHub scheduling in production.
6. Ran remote schema, policy, anonymous-access, function-source, cron, and live HTTP checks.
7. Built, tested, and deployed the matching web application to Cloudflare Pages.

## Remaining engineering debt

- The rich School Analytics dashboard still derives several charts from raw 7/30/90-day records. Student Risk Analytics is fixed, but School Analytics should receive a dedicated aggregate RPC before very large schools use the 90-day view.
- The repository has legacy full-project ESLint debt outside the architecture-critical CI set. Builds and type checks pass, but the baseline should be reduced incrementally.
- Backup verification cannot be honestly automated without a provider backup source and an isolated restore target. The product now records evidence, but an operational restore drill must still be configured and executed.
- Mobile binaries were not built or submitted; only TypeScript validation was performed.
- Generated database types should be committed after the linked Supabase schema is deployed and available to the CLI.
- Four legacy billing functions remain deployed but unchanged: `create-school-payment`, `paymongo-webhook`, `send-invoice-receipt`, and `send-subscription-confirmation`. Because billing was removed, they should be deleted after explicit destructive approval; no payment behavior was reactivated in this release.

## Release decision

The architecture is suitable for a controlled production rollout. Before broad onboarding, complete acceptance tests with real administrator, teacher, and parent accounts; record a real isolated backup restore; remove the legacy billing functions with approval; and address School Analytics aggregation before enabling its 90-day view at 20,000-student scale.

# ClassPulse Load Test and Attendance Scalability Report

**Test date:** August 5, 2026  
**Application:** ClassPulse school administration and instructor attendance system  
**Database:** Supabase PostgreSQL  
**Web hosting:** Cloudflare Pages  
**Production URL:** `https://classpulse.pages.dev`

## 1. Executive summary

ClassPulse was tested with a synthetic school containing 20,000 students, 400 sections and schedules, and up to 100 instructor accounts. The database successfully stored and verified 20,000 attendance records. After the first test exposed slow full-history and taken-schedule queries, migration `043_attendance_scaling.sql` and matching frontend changes were introduced.

The improved atomic attendance workflow successfully completed:

- 100 simultaneous classroom-save requests
- 5,000 attendance rows in one concurrent wave
- 100% successful saves
- 100% successful classroom reopen checks
- Transaction rollback protection for invalid or incomplete attendance
- A paced 100-instructor workflow covering 400 schedules and 20,000 attendance records

The core attendance-writing path is production-capable for normal classrooms of approximately 30–50 students. Two operational limits were identified:

1. A burst of 100 completely fresh password logins from the same IP can trigger Supabase Auth rate limiting.
2. Under extreme synthetic load, a small number of read or save requests experienced unusually long latency despite eventually succeeding.

Application-side session persistence, bounded attendance-read timeouts, safe retries, jitter, friendly error messages, and manual retry controls have now been added. The newest timeout and Auth UX changes pass the production build and all automated tests but have not yet been deployed.

## 2. Goals and scope

The tests were designed to answer the following questions:

- Can the database hold a school with at least 20,000 students?
- Can attendance be recorded for all students without missing or duplicate records?
- Can multiple instructors load rosters and save attendance concurrently?
- Does replacing attendance for a classroom behave atomically?
- Can the instructor reopen saved attendance and retrieve history?
- Can the application handle 100 concurrent classroom submissions?
- What happens when 100 instructor accounts perform fresh authentication?
- Is all synthetic data removable after testing?

Push-notification load testing was intentionally disabled so synthetic attendance would not send messages to real recipients.

## 3. Synthetic dataset

The load-test seeder was extended to create and reconcile:

- 1 tagged synthetic school
- 1 active academic year
- 20,000 students
- 20,000 student enrollments
- Synthetic parent records
- 400 sections
- 400 schedules
- Up to 100 distinct instructor Auth accounts
- Schedule ownership distributed among the instructors

The seeder now creates `student_enrollments`, ensuring the synthetic data follows the year-specific roster design used by the production application.

## 4. Safety controls

The load-test harness includes the following protections:

- The default target in `.env.example` is staging.
- Production execution is blocked unless an explicit acknowledgement is temporarily added.
- Push-notification testing defaults to `false`.
- Synthetic records use identifiable test tags.
- Student deletion is processed in batches of 250.
- Section deletion is processed in batches of 100.
- Cleanup iterates through all synthetic instructor Auth users.
- Post-cleanup verification checks that no tagged students or schools remain.
- The temporary production override was removed after testing.
- Service-role and environment secrets are not written to test reports.

## 5. Test sequence and results

### 5.1 Baseline batch attendance insertion

**Report:** `load-test/report-1785906369346.json`

Configuration:

| Parameter | Value |
|---|---:|
| Students | 20,000 |
| Batch size | 500 |
| Batches | 40 |
| Concurrency | 10 |
| Push notifications | Disabled |

Results:

| Measurement | Result |
|---|---:|
| Successful batches | 40/40 |
| Failed batches | 0 |
| Records written | 20,000 |
| Average batch latency | 858.0 ms |
| p95 batch latency | 1,296.9 ms |
| p99/max batch latency | 1,297.6 ms |
| Read-back verification | Passed |
| Total test wall time | 53.6 seconds |

**Finding:** Raw attendance storage capacity was good. All 20,000 rows were inserted and verified.

### 5.2 Authenticated instructor workflow before scaling changes

**Report:** `load-test/attendance-workflow-report-1785907137947.json`

This test used a real authenticated instructor workflow with 400 schedules, 20,000 roster rows, and concurrency 10.

Successful operations:

| Operation | Success | Average | p95 | Max |
|---|---:|---:|---:|---:|
| Schedule list | 1/1 | 1,195.8 ms | 1,195.8 ms | 1,195.8 ms |
| Roster loads | 400/400 | 259.5 ms | 532.9 ms | 2,339.7 ms |
| Existing-attendance reads | 400/400 | 185.6 ms | 426.9 ms | 1,300.1 ms |
| Attendance deletes | 400/400 | 180.2 ms | 263.8 ms | 1,088.1 ms |
| Classroom inserts | 400/400 | 366.7 ms | 744.7 ms | 1,878.6 ms |
| Classroom reopen checks | 400/400 | 194.8 ms | 302.2 ms | 892.5 ms |

Problems discovered:

- The old taken-schedule query failed after approximately 10.4 seconds.
- The old full attendance-history query hit a database statement timeout after approximately 9.1 seconds.
- One large chunked verification request experienced a transient fetch failure after reading 15,000 rows. A separate retry verified the full 20,000 records.
- Attendance replacement was performed as separate delete and insert requests, which created a partial-update risk if one request failed.

These findings drove migration `043` and the frontend changes described below.

### 5.3 First 100-instructor authentication attempt

**Report:** `load-test/attendance-100-teacher-report-1785909977898.json`

The first attempt submitted a large burst of fresh password logins.

| Measurement | Result |
|---|---:|
| Login attempts | 100 |
| Successful fresh logins | 64 |
| Rate-limited logins | 36 |
| Main error | `Request rate limit reached` |

The classroom waves did not run during this attempt. A sparse-array issue in the harness was also discovered and fixed by using dense teacher slots and paced retries.

**Finding:** This test did not demonstrate a database attendance-capacity failure. It demonstrated Supabase Auth admission throttling when many fresh password logins originate together.

### 5.4 Paced 100-instructor workflow

**Report:** `load-test/attendance-100-teacher-report-1785910769863.json`

After fixing the harness and pacing/retrying authentication, all 100 instructor accounts eventually authenticated and completed four classroom waves.

| Measurement | Result |
|---|---:|
| Instructors eventually authenticated | 100/100 |
| Schedules processed | 400 |
| Students/attendance rows | 20,000 |
| Roster loads | 400/400 successful |
| Atomic classroom saves | 400/400 successful |
| Classroom reopen checks | 400/400 successful |
| Taken-schedule summaries | 100/100 successful |
| Paginated history requests | 100/100 successful |

Typical performance was acceptable, but there were severe extreme-load outliers:

| Operation | p50 | p95 | p99 | Maximum |
|---|---:|---:|---:|---:|
| Login | 1.87 s | 2.40 s | 32.86 s | 32.86 s |
| Roster load | 2.63 s | 5.42 s | 11.45 s | 309.86 s |
| Atomic save | 0.62 s | 2.42 s | 3.66 s | 206.94 s |
| Reopen | 0.27 s | 1.38 s | 2.59 s | 65.87 s |
| Paginated history | 0.85 s | 2.06 s | 4.20 s | 4.20 s |

**Important interpretation:** This proves that 100 instructor identities can eventually complete the workflow when authentication is paced. It does not prove that 100 fresh password logins from one IP will all be admitted at the exact same instant.

### 5.5 Controlled 100-simultaneous-save capacity test

**Report:** `load-test/attendance-100-concurrent-report-1785911037744.json`

To isolate database attendance capacity from Auth throttling, one valid authenticated instructor session was used for 100 independently assigned schedules. The test then sent 100 atomic classroom saves simultaneously.

| Measurement | Result |
|---|---:|
| Simultaneous classroom requests | 100 |
| Students per classroom | 50 |
| Attendance records | 5,000 |
| Successful saves | 100/100 |
| Failed saves | 0 |
| Total concurrent wave | 3.82 seconds |
| Save average | 2.57 seconds |
| Save p95 | 3.60 seconds |
| Save p99/max | 3.82 seconds |
| Successful reopen checks | 100/100 |
| Taken-schedule query | Successful in 2.59 seconds |
| Invalid partial replacement | Rejected |
| Original records after rejection | Preserved |

One reopen request took 62.45 seconds while the other reopen requests were much faster. This isolated the rare-delay problem and led to client-side read deadlines and retry handling.

## 6. Database changes made

Migration `supabase/migrations/043_attendance_scaling.sql` was applied and verified. It introduced four secured RPCs and one supporting index.

### `replace_class_attendance`

- Accepts the entire classroom attendance list in one request.
- Confirms the caller is the instructor assigned to the schedule.
- Confirms attendance belongs to an active academic year and valid date.
- Requires exactly one valid record for every enrolled student.
- Rejects missing, duplicate, foreign, or invalid student/status records.
- Deletes and inserts inside one PostgreSQL transaction.
- Rolls back the entire operation if validation or insertion fails.
- Is executable only by authenticated users.

### `get_taken_attendance_schedule_ids`

- Replaces the former large client-side schedule-ID filter.
- Returns only schedule IDs belonging to the authenticated instructor.
- Filters by academic year and date on the server.

### `get_instructor_attendance_history`

- Moves attendance-history joins and filtering to PostgreSQL.
- Supports date range, status, search, page size, and offset.
- Limits page size to 100 records.
- Returns the page and total count as one result.

### `get_school_attendance_dashboard`

- Aggregates current attendance, trends, at-risk students, and parent-access totals on the server.
- Prevents the admin dashboard from downloading all attendance rows for browser-side aggregation.

### Supporting index

The migration added:

```sql
create index if not exists idx_attendance_records_schedule_date
  on public.attendance_records (schedule_id, date desc);
```

## 7. Frontend changes made

### Attendance recording

`web/src/pages/instructor/TakeAttendancePage.tsx` now:

- Saves a complete classroom through `replace_class_attendance`.
- Uses the server-side taken-schedule summary.
- Loads roster and existing attendance through bounded resilient reads.
- Shows a friendly error when a read is unusually slow.

### Attendance history

`web/src/pages/instructor/AttendanceHistoryPage.tsx` now:

- Uses server-side pagination, filtering, and search.
- Does not request an instructor's entire history at once.
- Applies a 12-second deadline per read attempt.
- Retries one transient read failure with exponential delay and random jitter.
- Displays a **Try again** button if both attempts fail.

### School dashboard

`web/src/pages/admin/Dashboard.tsx` now uses `get_school_attendance_dashboard` instead of downloading and aggregating all attendance records in the browser.

### Authentication behavior

`web/src/lib/supabase.ts` explicitly enables:

- Persisted browser sessions
- Automatic token refresh
- Auth-session detection after redirect

`web/src/contexts/AuthContext.tsx` now translates Auth HTTP 429 responses into clear guidance telling the teacher to wait briefly and keep the device signed in.

### Resilient reads

`web/src/lib/resilientRequest.ts` was added as a reusable wrapper for safe, idempotent reads:

- Default deadline: 12 seconds
- Default retry count: 1
- Exponential delay plus random jitter
- Retry recognition for network failures, timeouts, HTTP 408/429/5xx, and relevant PostgreSQL/PostgREST timeout codes
- No use for arbitrary non-idempotent writes

## 8. Load-test tooling changes

The following scripts are available:

| Command | Purpose |
|---|---|
| `npm run seed` | Create/reconcile the synthetic dataset |
| `npm test` | Run the batch attendance test |
| `npm run test:attendance-workflow` | Test the authenticated instructor workflow |
| `npm run test:100-teachers` | Test 100 instructor accounts and 400 schedules |
| `npm run test:100-saves` | Send 100 simultaneous atomic classroom saves |
| `npm run cleanup` | Remove all tagged synthetic records and Auth users |

Supporting scripts added or expanded:

- `load-test/seed-synthetic-data.mjs`
- `load-test/run-load-test.mjs`
- `load-test/run-attendance-workflow-test.mjs`
- `load-test/run-100-teacher-attendance-test.mjs`
- `load-test/run-100-concurrent-attendance-saves.mjs`
- `load-test/verify-synthetic-data.mjs`
- `load-test/cleanup-synthetic-data.mjs`

## 9. Cleanup result

After the final production test, the cleanup process removed:

- 100 synthetic instructor Auth accounts
- 20,000 synthetic students
- 20,000 synthetic enrollments and related data
- 400 synthetic sections and schedules
- The tagged synthetic school

Post-cleanup verification found zero tagged synthetic students and zero tagged synthetic schools. The production-test override was then removed from `.env`.

## 10. Current readiness assessment

| Area | Assessment | Notes |
|---|---|---|
| 20,000-student storage | Good | Insert and verification passed |
| Normal classroom saves | Good | Atomic and validated |
| 100 simultaneous classroom saves | Good | 100/100 succeeded in 3.82 seconds |
| Data consistency | Very good | Invalid partial replacement rejected and rolled back |
| Instructor history | Good | Server-side paginated query passed |
| Admin attendance dashboard | Improved | Aggregation moved to secured database RPC |
| Returning-teacher authentication | Good | Sessions persist and refresh automatically |
| 100 simultaneous fresh logins from one IP | Needs platform planning | Supabase Auth can throttle the burst |
| Rare extreme-load latency | Mitigated in the UI | 12-second read deadline, one retry, jitter, and manual retry |

Overall readiness is approximately **8/10**. The attendance core is suitable for production use. The remaining concern is not ordinary classroom size; it is an intentionally extreme combination of many fresh Auth requests and maximum concurrency.

## 11. Remaining actions

### Before deploying the newest safeguards

- Deploy the latest web build to Cloudflare Pages.
- Verify the canonical production URL serves the new bundle.
- Perform a short smoke test using one instructor account:
  - Existing session restoration
  - Fresh login
  - Roster load
  - Attendance save
  - Reopen saved attendance
  - History pagination and retry button

### Supabase Auth capacity

- Review **Authentication → Rate Limits** in the Supabase dashboard.
- Confirm the current sign-in and token limits for the project.
- Keep teachers signed in on their normal devices.
- Avoid school-wide forced sign-outs immediately before attendance periods.
- If guaranteed same-IP fresh-login bursts are required, contact Supabase Support about the hosted Auth limit and expected school NAT behavior.
- Do not automatically retry every 429 from every device; synchronized retries can create another traffic spike.

### Monitoring

- Monitor Auth HTTP 429 counts.
- Monitor PostgREST/database statement timeouts.
- Track attendance-save and roster-load p50, p95, p99, and failure rate.
- Alert if attendance-save p95 exceeds 5 seconds for sustained periods.
- Re-run the controlled test on staging after material schema, Auth, or attendance changes.

## 12. Verification status

After the latest application-side timeout and Auth changes:

- TypeScript production build: **Passed**
- Vite production bundle: **Passed**
- Automated test files: **2 passed**
- Automated tests: **8/8 passed**
- New database migration required for the latest client safeguards: **No**
- Migration `043` status: **Applied previously and verified**
- Latest client safeguards deployed: **Not yet**

## 13. Evidence files

- `load-test/report-1785906369346.json`
- `load-test/attendance-workflow-report-1785907137947.json`
- `load-test/attendance-100-teacher-report-1785909977898.json`
- `load-test/attendance-100-teacher-report-1785910769863.json`
- `load-test/attendance-100-concurrent-report-1785911037744.json`
- `supabase/migrations/043_attendance_scaling.sql`
- `SCHOOL_YEAR_END_IMPLEMENTATION_GUIDE.md`

These reports preserve the raw metrics. This document supplies the interpretation and distinguishes authentication admission limits from database attendance capacity.

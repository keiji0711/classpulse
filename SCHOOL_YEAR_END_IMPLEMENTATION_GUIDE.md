# School-Year End Implementation Guide

This document is the implementation order for making academic-year rollover safe. Work through the phases in sequence. Do not start a later phase until the acceptance checks for the current phase pass.

## Implementation status

| Area | Status |
|---|---|
| Release A web changes | Deployed; unit tests and production build pass |
| Release A database safety | Migration `039` applied to production and REST schema verified |
| Release B lifecycle schema | Migration `040` applied to production and rollover tables verified |
| Release B finalization and activation | Migrations `041` and `042` applied; secured RPCs verified |
| Release B year-end workspace | Deployed to Cloudflare Pages; public route verified |
| Production academic-year integrity | Verified on 2026-08-05: 3 schools, 4 year records, no active/current conflicts |
| Authenticated rollover smoke test | Pending a designated test school and school-admin session |
| Release C year-specific section offerings | Not started |
| Attendance scaling | Migration `043` and matching web build deployed; 100 simultaneous atomic classroom saves passed |

Production web URL: `https://classpulse.pages.dev`

Verified deployment snapshot: `https://8bbca97e.classpulse.pages.dev`

The schema and public deployment checks are complete. The final rollover smoke test must use a designated test school because finalization and activation intentionally change academic-year and enrollment records.

### Database deployment order

Do not run migration `039` by itself. It depends on tables introduced by earlier migrations, especially `academic_years` and `student_enrollments` from migration `018` and `exam_scores` from migration `027`.

1. Check the target database's applied migration history.
2. Apply every missing migration in numeric order through `038`.
3. Apply `039`, `040`, `041`, and `042` in that order.
4. Test the complete workflow on staging before production.

## Target outcome

At the end of a school year, every enrolled student receives one recorded outcome:

- Promoted
- Retained
- Graduated
- Transferred out
- Withdrawn
- Dropped
- Pending review

Historical enrollment, grades, attendance, exam scores, schedules, and section assignments must remain unchanged and readable after the next year starts.

## Non-negotiable rules

1. Never delete an academic year containing school records.
2. Never overwrite an old enrollment when creating a new-year enrollment.
3. Grade and section displayed for a selected year must come from `student_enrollments`.
4. A historical or closed year is read-only unless it is formally reopened.
5. Year closure and rollover must run in a database transaction, not as several browser requests.
6. A student remains one master record across all years.
7. Graduated, transferred, withdrawn, and dropped students are preserved, not deleted.

---

## Phase 0 — Baseline and safety tests

**Goal:** Establish tests that expose the current historical-data problems before changing the schema.

### Work

- Create fixtures for two academic years.
- Include promoted, retained, graduated, transferred, and pending students.
- Add regression coverage for:
  - Viewing a student's old and new section.
  - Loading teacher attendance rosters by year.
  - Loading teacher grade and exam rosters by year.
  - Viewing old-year grades after promotion.
  - Preventing duplicate enrollment for one student in one year.
- Record current database constraints and RLS behavior.

### Acceptance checks

- [x] Tests demonstrate that changing `students.section_id` can produce an incorrect historical section.
- [ ] Tests cover school isolation: one school cannot read or change another school's year data.
- [x] A repeatable two-year test dataset exists.

---

## Phase 1 — Fix year-specific reads

**Goal:** Make every year-aware page use the enrollment for the selected academic year.

### Work

Update these flows first:

- Instructor attendance roster
- Instructor grade roster
- Instructor exam-score roster
- Admin grades overview
- Admin exam-score overview
- Student analytics
- School analytics
- Dashboard at-risk student labels

For a selected year, query:

```text
student_enrollments
  -> student
  -> section
```

Do not determine a historical section from `students.section_id`.

### Acceptance checks

- [x] A promoted student shows the old section in the old year.
- [x] The same student shows the new section in the new year.
- [x] Attendance, grades, exams, and analytics use the same year-specific section.
- [x] Students not enrolled in the selected year do not appear in that year's operational rosters.

---

## Phase 2 — Separate “viewed year” from “current year”

**Goal:** Remove ambiguity between browsing history and operating the school today.

### Work

- Rename the UI concept internally to `selectedYear` or `viewedYear`.
- Keep database `is_current` as the operational year until lifecycle statuses are introduced.
- Clearly label historical years as read-only in the header.
- Block creating or editing attendance, grades, exam scores, schedules, and enrollments while viewing a non-current year.
- Allow reports and exports from historical years.
- Check and display errors when changing the current year.

### Acceptance checks

- [x] Selecting an old year does not make it operational.
- [x] Historical reports remain available.
- [x] Write controls are disabled for historical years.
- [x] Mobile, teacher, and admin portals agree on the operational year.

---

## Phase 3 — Remove destructive and insecure operations

**Goal:** Protect academic records before building the new rollover process.

### Work

- Remove academic-year deletion from the school-admin UI.
- Add archive behavior for empty or closed years.
- Change year foreign keys so official records cannot disappear when a year is removed.
- Remove anonymous read access to `student_enrollments` unless a narrowly scoped verified parent flow requires it.
- Secure `set_current_academic_year`:
  - Require an authenticated school administrator.
  - Confirm the administrator belongs to `p_school_id`.
  - Confirm the target year belongs to that school.
  - Restrict function execution privileges.
- Add school-consistency constraints or triggers for enrollment student, section, year, and school IDs.

### Acceptance checks

- [ ] A school administrator cannot delete a year with official data.
- [ ] An anonymous user cannot list enrollment records.
- [ ] A user cannot change another school's current year.
- [ ] Cross-school enrollment references are rejected.

---

## Phase 4 — Add lifecycle and student outcomes

**Goal:** Represent what happened to every student and every academic year.

### Schema changes

Add to `academic_years`:

```text
status: draft | active | closing | closed | archived
closed_at
closed_by
reopened_at
reopened_by
```

Add to `students`:

```text
lifecycle_status: active | graduated | transferred | withdrawn | dropped
graduation_date
```

Add to `student_enrollments`:

```text
enrollment_status: enrolled | completed | transferred | withdrawn | dropped
year_end_outcome: promoted | retained | graduated | transferred | withdrawn | dropped | pending
promoted_to_enrollment_id
outcome_notes
finalized_at
finalized_by
```

Add database checks so outcomes and statuses cannot contradict each other.

### Acceptance checks

- [ ] Each source-year enrollment can hold exactly one year-end outcome.
- [ ] A graduate can exist without a next-year enrollment.
- [ ] A retained student can have a next-year enrollment at the same grade.
- [ ] Historical students and parents are not deleted when a lifecycle status changes.

---

## Phase 5 — Build the year-end review workspace

**Goal:** Let the administrator resolve students before any rollover is applied.

### Workflow screens

1. Select source year and draft target year.
2. Run readiness checks.
3. Review students grouped by grade and section.
4. Apply suggested outcomes in bulk.
5. Resolve exceptions individually.
6. Assign target sections for promoted and retained students.
7. Preview totals and validation errors.

### Readiness checks

- Missing grades or exam results
- Students with no outcome
- Grade 12 students not classified as graduated or retained
- Promoted/retained students without a destination section
- Duplicate or existing target-year enrollments
- Open interventions that require a disposition
- Dates or records outside the source year's range

Grade results may suggest an outcome, but the school administrator makes the final decision.

### Acceptance checks

- [ ] Every source-year student appears exactly once in the review.
- [ ] Grade 12 defaults to graduation review, not automatic Grade 12 rollover.
- [ ] The preview separates promoted, retained, graduated, transferred, withdrawn, dropped, and pending totals.
- [ ] Finalization is blocked while required issues remain unresolved.

---

## Phase 6 — Transactional rollover and closure

**Goal:** Apply the approved plan atomically and produce an audit trail.

### Backend design

Create `school_year_rollover_batches` and batch-detail records. Implement a secured database function that:

1. Locks the source year and batch.
2. Verifies that the source is active/closing and the target is draft.
3. Revalidates all student outcomes.
4. Finalizes source enrollments.
5. Creates target enrollments only for promoted and retained students.
6. Links each source enrollment to its target enrollment.
7. Updates student lifecycle status for graduates and other leavers.
8. Records the acting administrator, timestamps, and summary.
9. Closes the old year.
10. Rolls back the entire operation if any step fails.

Use an idempotency key so retrying the same batch cannot create duplicate records.

### Important behavior

- Do not update `students.section_id` while preparing a future year.
- After this phase, remove `students.section_id`, or treat it only as a database-maintained cache of the active enrollment.
- Never use it as historical truth.

### Acceptance checks

- [ ] A simulated failure produces no partial rollover.
- [ ] Retrying a completed batch creates no duplicates.
- [ ] Only promoted and retained students receive target enrollments.
- [ ] The source year becomes closed and read-only.
- [ ] Every decision is traceable to an administrator and batch.

---

## Phase 7 — Activate the new year

**Goal:** Make activation a deliberate final step after setup and rollover.

### Work

- Validate that the target year has sections, advisers, subjects, schedules, and enrollments.
- Show an unassigned-student queue.
- Activate the target year through one secured database function.
- Make it the only active/current year for the school.
- Refresh admin, instructor, and mobile clients.
- Keep the closed source year available for reports.

### Acceptance checks

- [ ] Only one academic year is active per school.
- [ ] Teachers see only their new-year schedules and rosters.
- [ ] Parents see current-year information while retaining permitted historical access.
- [ ] Closed-year records remain unchanged.

---

## Phase 8 — Year-specific section offerings

**Goal:** Prevent new-year adviser and subject changes from altering historical section configuration.

### Work

Introduce `section_offerings`:

```text
section_offerings
- academic_year_id
- section_id or section_template_id
- adviser_id
- strand_id
- capacity
- status
```

Move year-specific section-subject assignments to the offering. Make schedules and enrollments reference the offering.

Also associate interventions with an academic year or enrollment where appropriate.

### Acceptance checks

- [ ] Changing next year's adviser does not change the old year's adviser.
- [ ] Changing next year's subjects does not rewrite historical section configuration.
- [ ] Schedules, enrollment, adviser announcements, and reports resolve the correct offering.

---

## Recommended delivery batches

### Release A — Historical-data safety

Phases 0–3. This release fixes incorrect year-based reads, disables unsafe historical writes, protects academic years, and tightens security.

### Release B — Proper year-end processing

Phases 4–7. This release adds statuses, outcomes, the review wizard, transactional rollover, closure, and activation.

### Release C — Complete historical configuration

Phase 8. This release makes section advisers and subject configuration fully year-specific.

## Execution rule

When implementation begins, always choose the first unchecked acceptance item from the earliest incomplete phase. Database migrations should be backward-compatible until all readers have been moved to the new model. Do not remove legacy columns until the application no longer relies on them and the two-year regression suite passes.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('architecture security invariants', () => {
  it('removes unrestricted anonymous access to private school records', () => {
    const migration = read('supabase/migrations/051_architecture_security_foundation.sql');
    for (const policy of ['anon_select_attendance','anon_select_messages','anon_select_grades','anon_read_own_parent_sub']) {
      expect(migration).toContain(`drop policy if exists "${policy}"`);
    }
  });

  it('binds every parent service-role endpoint to an explicit relationship', () => {
    for (const name of ['get-student-feed','get-student-grades','get-student-exam-scores','get-student-assessments','parent-access-status','save-parent-contact','set-parent-pin','update-push-token']) {
      expect(read(`supabase/functions/${name}/index.ts`)).toMatch(/authorizeParent(Student|Record)/);
    }
  });

  it('returns family-visible assessment notes without exposing health measurements', () => {
    const source = read('supabase/functions/get-student-assessments/index.ts');
    expect(source).toContain('assessment_date,notes,updated_at');
    expect(source).not.toMatch(/\.select\([^\n]*(height_cm|weight_kg|bmi_for_age_z|height_for_age_z|date_of_birth|assessed_by)/);
  });

  it('does not accept parent JWTs in staff notification functions', () => {
    for (const name of ['send-message','send-push-notification','send-push-notification-batch','send-grade-notification','send-test-push-notification']) {
      const source = read(`supabase/functions/${name}/index.ts`);
      expect(source).toContain('verifyAuth');
      expect(source).not.toContain('from "../_shared/jwt.ts"');
    }
  });

  it('requires a separate parent signing secret', () => {
    const jwt = read('supabase/functions/_shared/jwt.ts');
    expect(jwt).toContain('Deno.env.get("APP_JWT_SECRET")');
    expect(jwt).not.toContain('|| Deno.env.get("SUPABASE_JWT_SECRET")');
  });

  it('binds grade and exam writes to a scheduled teacher assignment', () => {
    const migration = read('supabase/migrations/057_teacher_academic_record_boundaries.sql');
    expect(migration).toContain('can_instructor_manage_academic_record');
    expect(migration).toContain('schedule.instructor_id = auth.uid()');
    expect(migration).toContain('Academic record crosses a school boundary');
  });

  it('limits privileged email functions to a platform owner using MFA', () => {
    for (const name of ['send-email']) {
      const source = read(`supabase/functions/${name}/index.ts`);
      expect(source).toContain('hasAdminMfa(req)');
      expect(source).toContain('authorizePlatformOwner');
    }
  });

  it('retires school subscription billing without disabling parent access revenue', () => {
    const migration = read('supabase/migrations/066_retire_school_subscription_billing.sql');
    expect(migration).toContain('update public.plans set is_active = false');
    expect(migration).toContain("'plan_code','school_access'");
    expect(migration).toContain("'has_access',true");
    expect(migration).not.toContain('parent_access_billing_settings');
    expect(read('supabase/functions/create-school-payment/index.ts')).toContain('status: 410');
  });

  it('uses a narrow public school directory instead of anonymous table reads', () => {
    const migration = read('supabase/migrations/058_public_school_directory.sql');
    expect(migration).toContain('drop policy if exists "anon_read_schools"');
    expect(migration).toContain('returns table(id uuid, name text)');
    const directory = read('mobile/src/lib/loginSchools.ts');
    expect(directory).toContain('/rest/v1/rpc/list_login_schools');
    expect(directory).toContain('Authorization: `Bearer ${SUPABASE_ANON_KEY}`');
    expect(read('mobile/src/screens/LoginScreen.tsx')).toContain('fetchLoginSchools()');
    expect(read('mobile/src/screens/ProfessionalLoginScreen.tsx')).toContain('fetchLoginSchools()');
  });

  it('supports mandatory MFA enrollment without allowing self-disable', () => {
    const migration = read('supabase/migrations/059_mfa_enrollment_bootstrap.sql');
    expect(migration).toContain("public.current_auth_aal() <> 'aal2'");
    expect(migration).toContain('MFA is mandatory for administrator accounts');
    expect(read('web/src/components/MfaSecurityPanel.tsx')).not.toContain('Disable MFA');
  });

  it('wraps legacy privileged RPCs with centralized active-role checks', () => {
    const migration = read('supabase/migrations/060_secure_legacy_rpc_entrypoints.sql');
    expect(migration).toContain('finalize_school_year_rollover_internal');
    expect(migration).toContain("public.get_user_role()<>'school_admin'");
    expect(migration).toContain("public.get_user_role()<>'instructor'");
  });

  it('keeps DepEd learner assessments assignment-bound and platform monitoring aggregate-only', () => {
    const migration = read('supabase/migrations/073_deped_learner_assessments.sql');
    expect(migration).toContain('can_instructor_assess_learner');
    expect(migration).toContain("section.adviser_id = auth.uid()");
    expect(migration).toContain("schedule.instructor_id = auth.uid()");
    expect(migration).toContain('p_verified_from_official_tool is distinct from true');
    expect(migration).toContain('get_platform_assessment_monitor');
    expect(migration).not.toMatch(/grant select on public\.learner_assessments to anon/);
  });

  it('gives school administrators aggregate-only assessment monitoring for their own school', () => {
    const migration = read('supabase/migrations/074_school_admin_assessment_monitor.sql');
    expect(migration).toContain("public.get_user_role() <> 'school_admin'");
    expect(migration).toContain('where a.school_id = v_school_id');
    expect(migration).toContain('group by a.academic_year_id, a.section_id');
    const returnedColumns = migration.match(/returns table\(([\s\S]*?)\)\nlanguage/)?.[1] ?? '';
    expect(returnedColumns).not.toMatch(/student_(id|name)|first_name|last_name|height_cm|weight_kg/);
  });

  it('queues privacy-safe learner assessment pushes with server-side deduplication', () => {
    const migration = read('supabase/migrations/075_learner_assessment_push_queue.sql');
    const worker = read('supabase/functions/_shared/assessmentNotification.ts');
    expect(migration).toContain("job_type = 'learner_assessment_push'");
    expect(migration).toContain('after insert on public.learner_assessments');
    expect(migration).toContain("timezone('Asia/Manila', now())");
    expect(worker).toContain('processLearnerAssessmentPush');
    expect(worker).toContain('A new school assessment record is available');
    expect(worker).not.toMatch(/height_cm|weight_kg|bmi_for_age_z|height_for_age_z|classification/);
    const dispatcher = read('supabase/functions/dispatch-assessment-notification/index.ts');
    expect(dispatcher).toContain('assessment.assessed_by !== auth.user.id');
    expect(dispatcher).toContain('Notification queued for retry');
  });
});

begin;
set local search_path = public, extensions;
select plan(22);

select is(
  (select count(*)::integer from pg_policies where schemaname='public' and policyname in (
    'anon_select_attendance','anon_select_messages','anon_select_grades',
    'anon_read_own_parent_sub','anon_read_academic_years','anon_read_enrollments'
  )),
  0,
  'private school records have no unrestricted anonymous policies'
);
select has_table('public','learner_assessments','DepEd BoSY and EoSY learner assessment evidence exists');
select has_function('public','can_instructor_assess_learner',array['uuid','uuid','uuid'],'learner assessment writes have a teacher assignment boundary');
select has_function('public','get_platform_assessment_monitor',array[]::text[],'platform has aggregate learner assessment monitoring');
select has_function('public','get_school_assessment_monitor',array[]::text[],'school administrators have aggregate learner assessment monitoring');
select has_function('public','queue_learner_assessment_push',array[]::text[],'new learner assessments enter the reliable push queue');
select has_trigger('public','learner_assessments','queue_learner_assessment_push_trigger','assessment notification queue runs only after a committed insert');
select isnt(has_table_privilege('anon','public.learner_assessments','select'),true,'anonymous users cannot read learner assessments');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='schools' and policyname='anon_read_schools'),0,'anonymous users cannot select the schools table');
select has_function('public','list_login_schools',array[]::text[],'a narrow public login directory exists');
select has_function('public','set_own_mfa_enrollment',array['boolean'],'administrator MFA enrollment bootstrap exists');
select isnt(has_function_privilege('authenticated','public.finalize_school_year_rollover_internal(uuid,uuid,jsonb,uuid)','execute'),true,'legacy rollover implementation is not directly callable');
select has_column('public','parents','family_id','guardians use explicit family relationships');
select has_column('public','schools','deped_school_id','schools carry an official identity for SF1 verification');
select has_function('public','consume_parent_auth_attempt',array['text','integer','integer','integer'],'distributed parent rate limiter exists');
select has_function('public','get_school_student_risk_analytics',array['uuid'],'server-side student analytics exists');
select isnt(has_function_privilege('anon','public.claim_reliability_jobs(integer)','execute'),true,'anonymous users cannot claim jobs');
select isnt(has_function_privilege('authenticated','public.execute_enabled_retention()','execute'),true,'ordinary users cannot execute retention');
select has_function('public','can_instructor_manage_academic_record',array['uuid','uuid','uuid','uuid'],'teacher academic writes have an assignment boundary');
select has_function('public','import_advisory_students',array['uuid','uuid','jsonb','text','text','text','text'],'assigned advisers have a school-and-class-bound SF1 import entrypoint');
select isnt(has_function_privilege('anon','public.import_advisory_students(uuid,uuid,jsonb,text,text,text,text)','execute'),true,'anonymous users cannot import SF1 rosters');
select is(
  (select count(*)::integer from pg_policies where schemaname='public' and tablename in ('grades','exam_scores') and policyname in ('instructor_manage_grades','instructor_manage_exam_scores')),
  0,
  'legacy created-by-only teacher policies are removed'
);

select * from finish();
rollback;

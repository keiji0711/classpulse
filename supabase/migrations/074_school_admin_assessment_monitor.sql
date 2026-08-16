-- School administrators monitor assessment completion for their own school.
-- This RPC intentionally returns section-level aggregates only; learner-level
-- scores, measurements, and health classifications remain teacher-restricted.

create or replace function public.get_school_assessment_monitor()
returns table(
  academic_year_id uuid,
  academic_year_name text,
  section_id uuid,
  section_name text,
  grade_level text,
  enrolled bigint,
  bosy_literacy bigint,
  bosy_numeracy bigint,
  bosy_nutrition bigint,
  eosy_literacy bigint,
  eosy_numeracy bigint,
  eosy_nutrition bigint,
  bosy_literacy_support bigint,
  bosy_numeracy_support bigint,
  bosy_nutrition_support bigint,
  eosy_literacy_support bigint,
  eosy_numeracy_support bigint,
  eosy_nutrition_support bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_school_id uuid := public.get_user_school_id();
begin
  if public.get_user_role() <> 'school_admin' or v_school_id is null then
    raise exception 'School administrator access is required';
  end if;

  return query
  with current_year as (
    select ay.id, ay.name
    from public.academic_years ay
    where ay.school_id = v_school_id and ay.is_current
    order by ay.start_date desc
    limit 1
  ), roster as (
    select e.academic_year_id, e.section_id, count(distinct e.student_id) as enrolled
    from public.student_enrollments e
    join current_year cy on cy.id = e.academic_year_id
    where e.school_id = v_school_id and e.enrollment_status = 'enrolled'
    group by e.academic_year_id, e.section_id
  ), counts as (
    select a.academic_year_id, a.section_id,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='literacy') as bosy_literacy,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='numeracy') as bosy_numeracy,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='nutrition') as bosy_nutrition,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='literacy') as eosy_literacy,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='numeracy') as eosy_numeracy,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='nutrition') as eosy_nutrition,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='literacy' and a.classification in ('low_emerging','high_emerging','developing','frustration','instructional')) as bosy_literacy_support,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='numeracy' and a.classification in ('emerging_not_proficient','emerging_low_proficient','developing_nearly_proficient')) as bosy_numeracy_support,
      count(distinct a.student_id) filter (where a.assessment_period='bosy' and a.domain='nutrition' and (a.classification in ('severely_wasted','wasted') or a.secondary_classification in ('severely_stunted','stunted'))) as bosy_nutrition_support,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='literacy' and a.classification in ('low_emerging','high_emerging','developing','frustration','instructional')) as eosy_literacy_support,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='numeracy' and a.classification in ('emerging_not_proficient','emerging_low_proficient','developing_nearly_proficient')) as eosy_numeracy_support,
      count(distinct a.student_id) filter (where a.assessment_period='eosy' and a.domain='nutrition' and (a.classification in ('severely_wasted','wasted') or a.secondary_classification in ('severely_stunted','stunted'))) as eosy_nutrition_support
    from public.learner_assessments a
    join current_year cy on cy.id = a.academic_year_id
    where a.school_id = v_school_id
    group by a.academic_year_id, a.section_id
  )
  select cy.id, cy.name, s.id, s.name, s.grade_level, r.enrolled,
    coalesce(c.bosy_literacy,0), coalesce(c.bosy_numeracy,0), coalesce(c.bosy_nutrition,0),
    coalesce(c.eosy_literacy,0), coalesce(c.eosy_numeracy,0), coalesce(c.eosy_nutrition,0),
    coalesce(c.bosy_literacy_support,0), coalesce(c.bosy_numeracy_support,0), coalesce(c.bosy_nutrition_support,0),
    coalesce(c.eosy_literacy_support,0), coalesce(c.eosy_numeracy_support,0), coalesce(c.eosy_nutrition_support,0)
  from roster r
  join current_year cy on cy.id = r.academic_year_id
  join public.sections s on s.id = r.section_id and s.school_id = v_school_id
  left join counts c on c.academic_year_id = r.academic_year_id and c.section_id = r.section_id
  order by s.grade_level, s.name;
end;
$$;

revoke all on function public.get_school_assessment_monitor() from public, anon;
grant execute on function public.get_school_assessment_monitor() to authenticated;

comment on function public.get_school_assessment_monitor() is
  'Returns section-level BoSY/EoSY assessment coverage and support counts for the signed-in school administrator only.';

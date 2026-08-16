-- DepEd-aligned BoSY/EoSY learner assessment records.
-- Literacy/numeracy proficiency is transcribed from the named official
-- scoresheet. Nutrition classifications are derived server-side from the
-- z-scores produced by the approved DepEd/LIS nutritional assessment tool.

create table if not exists public.learner_assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete restrict,
  assessment_period text not null check (assessment_period in ('bosy', 'eosy')),
  domain text not null check (domain in ('literacy', 'numeracy', 'nutrition')),
  instrument text not null check (instrument in ('CRLA', 'PHIL_IRI', 'RMA', 'DEPED_NUTRITION')),
  instrument_version text not null check (length(btrim(instrument_version)) between 3 and 120),
  language text not null default 'not_applicable'
    check (language in ('mother_tongue', 'filipino', 'english', 'not_applicable')),
  classification text not null,
  secondary_classification text,
  raw_score numeric,
  total_items integer,
  assessment_date date not null,
  sex text check (sex in ('male', 'female')),
  date_of_birth date,
  age_months integer check (age_months between 36 and 300),
  height_cm numeric(5,2) check (height_cm between 50 and 230),
  weight_kg numeric(6,2) check (weight_kg between 5 and 250),
  bmi numeric(5,2) check (bmi between 5 and 80),
  bmi_for_age_z numeric(5,2) check (bmi_for_age_z between -10 and 10),
  height_for_age_z numeric(5,2) check (height_for_age_z between -10 and 10),
  details jsonb not null default '{}'::jsonb,
  notes text not null default '' check (length(notes) <= 1000),
  assessed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_year_id, assessment_period, domain, language),
  check ((raw_score is null and total_items is null) or
         (raw_score is not null and total_items is not null and total_items > 0 and raw_score between 0 and total_items))
);

create index if not exists idx_learner_assessments_school_year_period
  on public.learner_assessments(school_id, academic_year_id, assessment_period, domain);
create index if not exists idx_learner_assessments_student_year
  on public.learner_assessments(student_id, academic_year_id, assessment_period);

alter table public.learner_assessments enable row level security;
revoke all on public.learner_assessments from anon;
revoke insert, update, delete on public.learner_assessments from authenticated;
grant select on public.learner_assessments to authenticated;

create or replace function public.can_instructor_assess_learner(
  p_student_id uuid,
  p_academic_year_id uuid,
  p_school_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.get_user_role() = 'instructor'
    and p_school_id = public.get_user_school_id()
    and exists (
      select 1
      from public.student_enrollments enrollment
      join public.sections section on section.id = enrollment.section_id
      where enrollment.student_id = p_student_id
        and enrollment.school_id = p_school_id
        and enrollment.academic_year_id = p_academic_year_id
        and enrollment.enrollment_status = 'enrolled'
        and (
          section.adviser_id = auth.uid()
          or exists (
            select 1 from public.schedules schedule
            where schedule.school_id = enrollment.school_id
              and schedule.academic_year_id = enrollment.academic_year_id
              and schedule.section_id = enrollment.section_id
              and schedule.instructor_id = auth.uid()
          )
        )
    );
$$;
revoke all on function public.can_instructor_assess_learner(uuid,uuid,uuid) from public, anon;
grant execute on function public.can_instructor_assess_learner(uuid,uuid,uuid) to authenticated;

drop policy if exists "assigned instructors read learner assessments" on public.learner_assessments;
create policy "assigned instructors read learner assessments"
on public.learner_assessments for select
using (public.can_instructor_assess_learner(student_id, academic_year_id, school_id));

create or replace function public.save_learner_assessment(
  p_student_id uuid,
  p_academic_year_id uuid,
  p_assessment_period text,
  p_domain text,
  p_instrument text,
  p_instrument_version text,
  p_language text,
  p_classification text,
  p_secondary_classification text,
  p_raw_score numeric,
  p_total_items integer,
  p_assessment_date date,
  p_sex text,
  p_date_of_birth date,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_bmi_for_age_z numeric,
  p_height_for_age_z numeric,
  p_details jsonb,
  p_notes text,
  p_verified_from_official_tool boolean
)
returns public.learner_assessments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.users%rowtype;
  v_year public.academic_years%rowtype;
  v_enrollment public.student_enrollments%rowtype;
  v_section public.sections%rowtype;
  v_grade text;
  v_grade_number integer;
  v_language text := coalesce(p_language, 'not_applicable');
  v_classification text := p_classification;
  v_secondary text := p_secondary_classification;
  v_age_months integer;
  v_bmi numeric(5,2);
  v_record public.learner_assessments%rowtype;
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.id is null or public.get_user_role() <> 'instructor' then
    raise exception 'Only an authenticated teacher can record learner assessments';
  end if;
  if p_verified_from_official_tool is distinct from true then
    raise exception 'Confirm that the result was copied from the official DepEd scoresheet or nutritional tool';
  end if;
  if p_assessment_period not in ('bosy','eosy') then raise exception 'Assessment period must be BoSY or EoSY'; end if;
  if p_domain not in ('literacy','numeracy','nutrition') then raise exception 'Unsupported assessment domain'; end if;
  if length(btrim(coalesce(p_instrument_version,''))) not between 3 and 120 then
    raise exception 'Enter the official scoresheet or tool version';
  end if;
  if p_assessment_date is null then raise exception 'Assessment date is required'; end if;

  select * into v_year from public.academic_years where id = p_academic_year_id;
  if v_year.id is null or v_year.school_id is distinct from v_actor.school_id
     or not v_year.is_current or v_year.status not in ('active','closing') then
    raise exception 'Assessments can only be recorded for the current active or closing academic year';
  end if;
  if p_assessment_date < v_year.start_date or p_assessment_date > v_year.end_date then
    raise exception 'Assessment date must fall within the selected academic year';
  end if;

  select * into v_enrollment
  from public.student_enrollments
  where student_id = p_student_id
    and academic_year_id = p_academic_year_id
    and school_id = v_actor.school_id
    and enrollment_status = 'enrolled';
  if v_enrollment.id is null then raise exception 'Learner is not actively enrolled in this academic year'; end if;
  if not public.can_instructor_assess_learner(p_student_id,p_academic_year_id,v_actor.school_id) then
    raise exception 'You are not assigned to assess this learner';
  end if;
  select * into v_section from public.sections where id = v_enrollment.section_id;
  v_grade := public.normalize_sf1_grade(v_section.grade_level);
  if v_grade ~ '^\d+$' then v_grade_number := v_grade::integer; end if;

  if p_domain = 'literacy' then
    if v_grade_number between 1 and 3 then
      if p_instrument <> 'CRLA' then raise exception 'Grades 1 to 3 literacy must use CRLA'; end if;
      if p_classification not in ('low_emerging','high_emerging','developing','transitioning','at_grade_level') then
        raise exception 'Invalid CRLA proficiency classification';
      end if;
    elsif v_grade_number between 4 and 10 then
      if p_instrument <> 'PHIL_IRI' then raise exception 'Grades 4 to 10 literacy must use Phil-IRI'; end if;
      if p_classification not in ('frustration','instructional','independent','at_grade_level') then
        raise exception 'Invalid Phil-IRI reading classification';
      end if;
    else
      raise exception 'This module supports the current CRLA/Phil-IRI instruments for Grades 1 to 10 only';
    end if;
    if v_language not in ('mother_tongue','filipino','english') then raise exception 'Select the assessed literacy language'; end if;
    v_secondary := null;
  elsif p_domain = 'numeracy' then
    if v_grade_number is null or v_grade_number not between 1 and 10 or p_instrument <> 'RMA' then
      raise exception 'This module supports RMA for Grades 1 to 10 only';
    end if;
    if p_classification not in ('emerging_not_proficient','emerging_low_proficient','developing_nearly_proficient','transitioning_proficient','at_grade_level_highly_proficient') then
      raise exception 'Invalid RMA proficiency classification';
    end if;
    if p_raw_score is null or p_total_items is null or p_total_items < 1 or p_raw_score < 0 or p_raw_score > p_total_items then
      raise exception 'Enter a valid RMA raw score and total items';
    end if;
    v_language := 'not_applicable';
    v_secondary := null;
  else
    if p_instrument <> 'DEPED_NUTRITION' then raise exception 'Use the DepEd nutritional assessment instrument'; end if;
    if p_sex not in ('male','female') or p_date_of_birth is null then
      raise exception 'Sex and date of birth are required for age-specific nutritional assessment';
    end if;
    if p_date_of_birth >= p_assessment_date then raise exception 'Date of birth must be before the assessment date'; end if;
    v_age_months := extract(year from age(p_assessment_date,p_date_of_birth))::integer * 12
      + extract(month from age(p_assessment_date,p_date_of_birth))::integer;
    if v_age_months not between 36 and 300 then raise exception 'Learner age must be between 36 and 300 months'; end if;
    if p_height_cm not between 50 and 230 or p_weight_kg not between 5 and 250 then
      raise exception 'Enter a valid measured height and weight';
    end if;
    if p_bmi_for_age_z not between -10 and 10 or p_height_for_age_z not between -10 and 10 then
      raise exception 'Enter valid z-scores from the approved DepEd/LIS nutritional tool';
    end if;
    v_bmi := round(p_weight_kg / power(p_height_cm / 100.0, 2), 2);
    v_classification := case
      when p_bmi_for_age_z < -3 then 'severely_wasted'
      when p_bmi_for_age_z < -2 then 'wasted'
      when p_bmi_for_age_z <= 2 then 'normal'
      when p_bmi_for_age_z <= 3 then 'overweight'
      else 'obese'
    end;
    v_secondary := case
      when p_height_for_age_z < -3 then 'severely_stunted'
      when p_height_for_age_z < -2 then 'stunted'
      when p_height_for_age_z <= 2 then 'normal'
      else 'tall'
    end;
    v_language := 'not_applicable';
    p_raw_score := null;
    p_total_items := null;
  end if;

  insert into public.learner_assessments(
    school_id,academic_year_id,student_id,section_id,assessment_period,domain,
    instrument,instrument_version,language,classification,secondary_classification,
    raw_score,total_items,assessment_date,sex,date_of_birth,age_months,height_cm,
    weight_kg,bmi,bmi_for_age_z,height_for_age_z,details,notes,assessed_by,updated_at
  ) values (
    v_actor.school_id,v_year.id,p_student_id,v_enrollment.section_id,p_assessment_period,p_domain,
    p_instrument,btrim(p_instrument_version),v_language,v_classification,v_secondary,
    p_raw_score,p_total_items,p_assessment_date,
    case when p_domain='nutrition' then p_sex else null end,
    case when p_domain='nutrition' then p_date_of_birth else null end,
    case when p_domain='nutrition' then v_age_months else null end,
    case when p_domain='nutrition' then p_height_cm else null end,
    case when p_domain='nutrition' then p_weight_kg else null end,
    case when p_domain='nutrition' then v_bmi else null end,
    case when p_domain='nutrition' then p_bmi_for_age_z else null end,
    case when p_domain='nutrition' then p_height_for_age_z else null end,
    coalesce(p_details,'{}'::jsonb),btrim(coalesce(p_notes,'')),v_actor.id,now()
  )
  on conflict(student_id,academic_year_id,assessment_period,domain,language)
  do update set
    section_id=excluded.section_id,instrument=excluded.instrument,
    instrument_version=excluded.instrument_version,classification=excluded.classification,
    secondary_classification=excluded.secondary_classification,raw_score=excluded.raw_score,
    total_items=excluded.total_items,assessment_date=excluded.assessment_date,sex=excluded.sex,
    date_of_birth=excluded.date_of_birth,age_months=excluded.age_months,height_cm=excluded.height_cm,
    weight_kg=excluded.weight_kg,bmi=excluded.bmi,bmi_for_age_z=excluded.bmi_for_age_z,
    height_for_age_z=excluded.height_for_age_z,details=excluded.details,notes=excluded.notes,
    assessed_by=excluded.assessed_by,updated_at=now()
  returning * into v_record;
  return v_record;
end;
$$;

revoke all on function public.save_learner_assessment(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,date,text,date,numeric,numeric,numeric,numeric,jsonb,text,boolean) from public, anon;
grant execute on function public.save_learner_assessment(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,date,text,date,numeric,numeric,numeric,numeric,jsonb,text,boolean) to authenticated;

create or replace function public.get_platform_assessment_monitor()
returns table(
  school_id uuid, school_name text, academic_year_id uuid, academic_year_name text,
  enrolled bigint,
  bosy_literacy bigint, bosy_numeracy bigint, bosy_nutrition bigint,
  eosy_literacy bigint, eosy_numeracy bigint, eosy_nutrition bigint,
  literacy_needs_support bigint, numeracy_needs_support bigint, nutrition_needs_support bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.has_platform_permission('operations')) then
    raise exception 'Platform monitoring permission with MFA is required';
  end if;
  return query
  with current_years as (
    select distinct on (ay.school_id) ay.id,ay.school_id,ay.name
    from public.academic_years ay
    where ay.is_current
    order by ay.school_id,ay.start_date desc
  ), enrollment_counts as (
    select e.school_id,e.academic_year_id,count(distinct e.student_id) enrolled
    from public.student_enrollments e where e.enrollment_status='enrolled'
    group by e.school_id,e.academic_year_id
  ), assessment_counts as (
    select a.school_id,a.academic_year_id,
      count(distinct a.student_id) filter(where a.assessment_period='bosy' and a.domain='literacy') bosy_literacy,
      count(distinct a.student_id) filter(where a.assessment_period='bosy' and a.domain='numeracy') bosy_numeracy,
      count(distinct a.student_id) filter(where a.assessment_period='bosy' and a.domain='nutrition') bosy_nutrition,
      count(distinct a.student_id) filter(where a.assessment_period='eosy' and a.domain='literacy') eosy_literacy,
      count(distinct a.student_id) filter(where a.assessment_period='eosy' and a.domain='numeracy') eosy_numeracy,
      count(distinct a.student_id) filter(where a.assessment_period='eosy' and a.domain='nutrition') eosy_nutrition,
      count(distinct a.student_id) filter(where a.domain='literacy' and a.classification in ('low_emerging','high_emerging','developing','frustration','instructional')) literacy_needs_support,
      count(distinct a.student_id) filter(where a.domain='numeracy' and a.classification in ('emerging_not_proficient','emerging_low_proficient','developing_nearly_proficient')) numeracy_needs_support,
      count(distinct a.student_id) filter(where a.domain='nutrition' and (a.classification in ('severely_wasted','wasted') or a.secondary_classification in ('severely_stunted','stunted'))) nutrition_needs_support
    from public.learner_assessments a
    join current_years cy on cy.id=a.academic_year_id
    group by a.school_id,a.academic_year_id
  )
  select s.id,s.name,cy.id,cy.name,
    coalesce(ec.enrolled,0),
    coalesce(ac.bosy_literacy,0),coalesce(ac.bosy_numeracy,0),coalesce(ac.bosy_nutrition,0),
    coalesce(ac.eosy_literacy,0),coalesce(ac.eosy_numeracy,0),coalesce(ac.eosy_nutrition,0),
    coalesce(ac.literacy_needs_support,0),coalesce(ac.numeracy_needs_support,0),coalesce(ac.nutrition_needs_support,0)
  from public.schools s
  left join current_years cy on cy.school_id=s.id
  left join enrollment_counts ec on ec.school_id=s.id and ec.academic_year_id=cy.id
  left join assessment_counts ac on ac.school_id=s.id and ac.academic_year_id=cy.id
  where s.operational_status is distinct from 'archived'
  order by s.name;
end;
$$;
revoke all on function public.get_platform_assessment_monitor() from public, anon;
grant execute on function public.get_platform_assessment_monitor() to authenticated;

comment on table public.learner_assessments is
  'BoSY/EoSY DepEd literacy, numeracy, and nutritional assessment evidence. Learner-level access is limited to assigned teachers.';
comment on function public.get_platform_assessment_monitor() is
  'Returns aggregate-only current-year assessment coverage and support signals for platform monitoring.';

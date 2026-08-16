-- Server-side student risk analytics and reliable job claiming.

create index if not exists idx_attendance_student_date_schedule
  on public.attendance_records(student_id, date, schedule_id);
create index if not exists idx_grades_school_year_student
  on public.grades(school_id, academic_year_id, student_id, subject_id, quarter);

create or replace function public.get_school_student_risk_analytics(p_academic_year_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_school_id uuid;
  v_result jsonb;
begin
  if public.get_user_role() <> 'school_admin' then
    raise exception 'School administrator access with MFA is required';
  end if;
  v_school_id := public.get_user_school_id();
  if not exists (
    select 1 from public.academic_years
    where id = p_academic_year_id and school_id = v_school_id
  ) then raise exception 'Academic year not found for this school'; end if;

  with roster as (
    select st.id,st.first_name,st.middle_name,st.last_name,st.lrn,
      sec.name section_name,sec.grade_level
    from public.student_enrollments e
    join public.students st on st.id=e.student_id
    join public.sections sec on sec.id=e.section_id
    where e.school_id=v_school_id and e.academic_year_id=p_academic_year_id
  ), daily as (
    select ar.student_id,ar.date,
      case max(case ar.status when 'present' then 3 when 'late' then 2 when 'excused' then 1 else 0 end)
        when 3 then 'present' when 2 then 'late' when 1 then 'excused' else 'absent' end status
    from public.attendance_records ar
    join public.schedules sch on sch.id=ar.schedule_id
    where sch.school_id=v_school_id and sch.academic_year_id=p_academic_year_id
    group by ar.student_id,ar.date
  ), ordered_daily as (
    select d.*,
      row_number() over(partition by student_id order by date) rn,
      count(*) over(partition by student_id) total_days,
      sum(case when status <> 'absent' then 1 else 0 end)
        over(partition by student_id order by date rows unbounded preceding) absence_group
    from daily d
  ), attendance_agg as (
    select student_id,count(*)::int total_records,
      count(*) filter(where status='absent')::int absences,
      count(*) filter(where status='late')::int lates,
      count(*) filter(where rn <= floor(total_days/2.0))::int older_days,
      count(*) filter(where rn <= floor(total_days/2.0) and status='absent')::int older_absences,
      count(*) filter(where rn > floor(total_days/2.0))::int recent_days,
      count(*) filter(where rn > floor(total_days/2.0) and status='absent')::int recent_absences
    from ordered_daily group by student_id
  ), absence_streaks as (
    select student_id,max(streak)::int max_consecutive_absences
    from (
      select student_id,absence_group,count(*)::int streak
      from ordered_daily where status='absent'
      group by student_id,absence_group
    ) s group by student_id
  ), subject_averages as (
    select g.student_id,g.subject_id,sub.name,avg(g.grade)::numeric subject_average
    from public.grades g join public.subjects sub on sub.id=g.subject_id
    where g.school_id=v_school_id and g.academic_year_id=p_academic_year_id and g.quarter <= 3
    group by g.student_id,g.subject_id,sub.name
  ), grade_agg as (
    select g.student_id,avg(g.grade)::numeric average_grade
    from public.grades g
    where g.school_id=v_school_id and g.academic_year_id=p_academic_year_id and g.quarter <= 3
    group by g.student_id
  ), failing as (
    select student_id,count(*)::int failing_count,
      jsonb_agg(name order by name) failing_subjects
    from subject_averages where subject_average < 75 group by student_id
  ), quarter_averages as (
    select student_id,quarter,avg(grade)::numeric quarter_average,
      row_number() over(partition by student_id order by quarter desc) quarter_rank
    from public.grades
    where school_id=v_school_id and academic_year_id=p_academic_year_id and quarter <= 3
    group by student_id,quarter
  ), grade_trends as (
    select student_id,
      max(quarter_average) filter(where quarter_rank=1) latest_average,
      max(quarter_average) filter(where quarter_rank=2) prior_average
    from quarter_averages group by student_id
  ), base as (
    select r.*,
      coalesce(a.total_records,0) total_records,coalesce(a.absences,0) absences,
      coalesce(a.lates,0) lates,coalesce(a.older_days,0) older_days,
      coalesce(a.older_absences,0) older_absences,coalesce(a.recent_days,0) recent_days,
      coalesce(a.recent_absences,0) recent_absences,
      coalesce(s.max_consecutive_absences,0) max_consecutive_absences,
      ga.average_grade,coalesce(f.failing_count,0) failing_count,
      coalesce(f.failing_subjects,'[]'::jsonb) failing_subjects,
      gt.latest_average,gt.prior_average,
      case when coalesce(a.total_records,0)>0 then (a.absences::numeric/a.total_records)*100 else 0 end absence_rate
    from roster r
    left join attendance_agg a on a.student_id=r.id
    left join absence_streaks s on s.student_id=r.id
    left join grade_agg ga on ga.student_id=r.id
    left join failing f on f.student_id=r.id
    left join grade_trends gt on gt.student_id=r.id
  ), points as (
    select b.*,
      case when total_records>=3 then least(30,round((absence_rate/20)*30)) else 0 end::int p_absence,
      case when total_records<3 then 0 when max_consecutive_absences>=5 then 20 when max_consecutive_absences>=3 then 15 when max_consecutive_absences>=2 then 8 else 0 end p_streak,
      case when total_records>=6 and older_days>0 and recent_days>0
        and recent_absences::numeric/recent_days > older_absences::numeric/older_days + .05
        then least(10,round(((recent_absences::numeric/recent_days)-(older_absences::numeric/older_days))*50)) else 0 end::int p_trend,
      case when total_records<3 then 0 when lates::numeric/total_records>=.25 then 10 when lates::numeric/total_records>=.15 then 7 when lates::numeric/total_records>=.10 then 4 else 0 end p_late,
      case when failing_count>=3 then 15 when failing_count=2 then 12 when failing_count=1 then 8 else 0 end p_failing,
      case when average_grade is null then 0 when average_grade<75 then 10 when average_grade<78 then 6 when average_grade<80 then 3 else 0 end p_average,
      case when latest_average is null or prior_average is null then 0
        when prior_average-latest_average>=5 then 5 when prior_average-latest_average>=3 then 3
        when prior_average-latest_average>=1 then 1 else 0 end p_decline
    from base b
  ), scored as (
    select p.*,least(100,p_absence+p_streak+p_trend+p_late+p_failing+p_average+p_decline)::int risk_score
    from points p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'first_name',first_name,'middle_name',middle_name,'last_name',last_name,'lrn',lrn,
    'section_name',section_name,'grade_level',grade_level,'total_records',total_records,
    'absences',absences,'lates',lates,'absence_rate',round(absence_rate,2),
    'average_grade',case when average_grade is null then null else round(average_grade,2) end,
    'failing_subjects',failing_subjects,'risk_score',risk_score,
    'status',case when risk_score>=40 then 'critical' when risk_score>=20 then 'at-risk' else 'good' end,
    'risk_breakdown',jsonb_build_object('absenceRate',p_absence,'consecutiveAbsences',p_streak,
      'absenceTrend',p_trend,'lateFrequency',p_late,'failingSubjects',p_failing,
      'lowAverage',p_average,'gradeDecline',p_decline),
    'max_consecutive_absences',max_consecutive_absences,'trend_worsening',p_trend>0
  ) order by risk_score desc,absence_rate desc,last_name,first_name),'[]'::jsonb)
  into v_result from scored;
  return v_result;
end;
$$;
revoke all on function public.get_school_student_risk_analytics(uuid) from public,anon;
grant execute on function public.get_school_student_risk_analytics(uuid) to authenticated;

-- Atomic claim API prevents two scheduled workers from processing one job.
create or replace function public.claim_reliability_jobs(p_limit integer default 20)
returns setof public.reliability_jobs
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  return query
  with candidates as (
    select id from public.reliability_jobs
    where status in ('failed','queued')
      and attempts < max_attempts
      and coalesce(next_attempt_at,created_at) <= now()
    order by coalesce(next_attempt_at,created_at)
    for update skip locked limit least(greatest(p_limit,1),100)
  )
  update public.reliability_jobs j
  set status='running',attempts=j.attempts+1,started_at=now(),updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end;
$$;
revoke all on function public.claim_reliability_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_reliability_jobs(integer) to service_role;

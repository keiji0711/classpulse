-- Queue privacy-safe family notifications only after a new official learner
-- assessment has committed. One job per learner/period/recording day groups
-- literacy, numeracy, nutrition, and multi-language entries recorded together.

create unique index if not exists idx_reliability_job_assessment_dedupe
  on public.reliability_jobs ((payload->>'dedupe_key'))
  where job_type = 'learner_assessment_push';

create or replace function public.queue_learner_assessment_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day text := to_char(timezone('Asia/Manila', now()), 'YYYY-MM-DD');
  v_dedupe_key text;
begin
  v_dedupe_key := concat(new.student_id, ':', new.academic_year_id, ':', new.assessment_period, ':', v_day);

  insert into public.reliability_jobs(school_id, job_type, status, payload, max_attempts, next_attempt_at)
  values (
    new.school_id,
    'learner_assessment_push',
    'queued',
    jsonb_build_object(
      'assessment_id', new.id,
      'student_id', new.student_id,
      'assessment_period', new.assessment_period,
      'assessment_domain', new.domain,
      'dedupe_key', v_dedupe_key
    ),
    5,
    now()
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_learner_assessment_push() from public, anon, authenticated;

drop trigger if exists queue_learner_assessment_push_trigger on public.learner_assessments;
create trigger queue_learner_assessment_push_trigger
after insert on public.learner_assessments
for each row execute function public.queue_learner_assessment_push();

comment on function public.queue_learner_assessment_push() is
  'Queues one generic family push per learner, BoSY/EoSY period, and Manila recording day after a new assessment commits.';

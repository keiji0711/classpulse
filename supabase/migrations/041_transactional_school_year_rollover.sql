-- Atomic school-year finalization and activation.

create or replace function public.finalize_school_year_rollover(
  p_source_year_id uuid,
  p_target_year_id uuid,
  p_decisions jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_school_id uuid;
  v_source_status text;
  v_target_status text;
  v_source_count integer;
  v_decision_count integer;
  v_unique_decision_count integer;
  v_batch_id uuid;
  v_source_enrollment_id uuid;
  v_target_enrollment_id uuid;
  v_source_end_date date;
  v_decision record;
  v_summary jsonb;
  v_existing record;
begin
  select role, school_id into v_user_role, v_school_id
  from public.users where id = v_user_id;

  if v_user_role <> 'school_admin' or v_school_id is null then
    raise exception 'Only an authenticated school administrator can finalize a school year';
  end if;

  select id, status, summary into v_existing
  from public.school_year_rollover_batches
  where school_id = v_school_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'status', v_existing.status,
      'summary', v_existing.summary,
      'idempotent_replay', true
    );
  end if;

  select status, end_date into v_source_status, v_source_end_date
  from public.academic_years
  where id = p_source_year_id and school_id = v_school_id
  for update;

  if not found then raise exception 'Source academic year not found'; end if;

  select status into v_target_status
  from public.academic_years
  where id = p_target_year_id and school_id = v_school_id
  for update;

  if not found then raise exception 'Target academic year not found'; end if;
  if p_source_year_id = p_target_year_id then raise exception 'Source and target years must differ'; end if;
  if v_source_status <> 'active' then raise exception 'Source academic year must be active'; end if;
  if v_target_status <> 'draft' then raise exception 'Target academic year must be draft'; end if;
  if jsonb_typeof(p_decisions) <> 'array' then raise exception 'Decisions must be a JSON array'; end if;

  select count(*) into v_source_count
  from public.student_enrollments
  where school_id = v_school_id and academic_year_id = p_source_year_id;

  v_decision_count := jsonb_array_length(p_decisions);

  select count(distinct decision.student_id) into v_unique_decision_count
  from jsonb_to_recordset(p_decisions)
    as decision(student_id uuid, outcome text, target_section_id uuid, notes text);

  if v_source_count = 0 then raise exception 'Source year has no enrolled students'; end if;
  if v_decision_count <> v_source_count or v_unique_decision_count <> v_source_count then
    raise exception 'Every source-year student must have exactly one decision';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_decisions)
      as decision(student_id uuid, outcome text, target_section_id uuid, notes text)
    where decision.outcome not in ('promoted', 'retained', 'graduated', 'transferred', 'withdrawn', 'dropped')
  ) then
    raise exception 'Pending or invalid outcomes cannot be finalized';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_decisions)
      as decision(student_id uuid, outcome text, target_section_id uuid, notes text)
    left join public.student_enrollments enrollment
      on enrollment.student_id = decision.student_id
     and enrollment.academic_year_id = p_source_year_id
     and enrollment.school_id = v_school_id
    where enrollment.id is null
  ) then
    raise exception 'A decision contains a student outside the source year';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_decisions)
      as decision(student_id uuid, outcome text, target_section_id uuid, notes text)
    left join public.sections section_row
      on section_row.id = decision.target_section_id
     and section_row.school_id = v_school_id
    where decision.outcome in ('promoted', 'retained')
      and section_row.id is null
  ) then
    raise exception 'Promoted and retained students require a target section in the same school';
  end if;

  if exists (
    select 1
    from public.student_enrollments enrollment
    join public.section_subjects section_subject
      on section_subject.section_id = enrollment.section_id
     and section_subject.school_id = v_school_id
    cross join generate_series(1, 3) quarter_number
    left join public.grades grade_row
      on grade_row.student_id = enrollment.student_id
     and grade_row.subject_id = section_subject.subject_id
     and grade_row.quarter = quarter_number
     and grade_row.academic_year_id = p_source_year_id
    where enrollment.school_id = v_school_id
      and enrollment.academic_year_id = p_source_year_id
      and grade_row.id is null
  ) then
    raise exception 'All assigned subjects require grades for quarters 1 through 3 before finalization';
  end if;

  select id, status, summary into v_existing
  from public.school_year_rollover_batches
  where source_year_id = p_source_year_id and target_year_id = p_target_year_id;

  if found then
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'status', v_existing.status,
      'summary', v_existing.summary,
      'idempotent_replay', true
    );
  end if;

  insert into public.school_year_rollover_batches (
    school_id, source_year_id, target_year_id, idempotency_key, status, created_by
  ) values (
    v_school_id, p_source_year_id, p_target_year_id, p_idempotency_key, 'processing', v_user_id
  ) returning id into v_batch_id;

  for v_decision in
    select *
    from jsonb_to_recordset(p_decisions)
      as decision(student_id uuid, outcome text, target_section_id uuid, notes text)
  loop
    select id into v_source_enrollment_id
    from public.student_enrollments
    where student_id = v_decision.student_id
      and academic_year_id = p_source_year_id
      and school_id = v_school_id
    for update;

    v_target_enrollment_id := null;

    if v_decision.outcome in ('promoted', 'retained') then
      insert into public.student_enrollments (
        student_id, section_id, academic_year_id, school_id, enrollment_status
      ) values (
        v_decision.student_id, v_decision.target_section_id, p_target_year_id, v_school_id, 'enrolled'
      )
      on conflict (student_id, academic_year_id)
      do update set section_id = excluded.section_id, enrollment_status = 'enrolled'
      returning id into v_target_enrollment_id;

      update public.students
      set lifecycle_status = 'active', graduation_date = null
      where id = v_decision.student_id and school_id = v_school_id;
    elsif v_decision.outcome = 'graduated' then
      update public.students
      set lifecycle_status = 'graduated', graduation_date = v_source_end_date
      where id = v_decision.student_id and school_id = v_school_id;
    else
      update public.students
      set lifecycle_status = v_decision.outcome, graduation_date = null
      where id = v_decision.student_id and school_id = v_school_id;
    end if;

    update public.student_enrollments
    set
      enrollment_status = case
        when v_decision.outcome in ('promoted', 'retained', 'graduated') then 'completed'
        else v_decision.outcome
      end,
      year_end_outcome = v_decision.outcome,
      outcome_notes = coalesce(v_decision.notes, ''),
      promoted_to_enrollment_id = v_target_enrollment_id,
      finalized_at = now(),
      finalized_by = v_user_id
    where id = v_source_enrollment_id;

    insert into public.school_year_rollover_details (
      batch_id, source_enrollment_id, student_id, outcome,
      target_section_id, target_enrollment_id, notes
    ) values (
      v_batch_id, v_source_enrollment_id, v_decision.student_id, v_decision.outcome,
      v_decision.target_section_id, v_target_enrollment_id, coalesce(v_decision.notes, '')
    );
  end loop;

  select coalesce(jsonb_object_agg(outcome, outcome_count), '{}'::jsonb)
  into v_summary
  from (
    select outcome, count(*)::integer as outcome_count
    from public.school_year_rollover_details
    where batch_id = v_batch_id
    group by outcome
  ) counts;
  v_summary := v_summary || jsonb_build_object('total', v_source_count);

  update public.school_year_rollover_batches
  set status = 'finalized', summary = v_summary, finalized_at = now()
  where id = v_batch_id;

  -- Keep this year operational but read-only until the deliberate activation step.
  update public.academic_years
  set status = 'closing'
  where id = p_source_year_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'status', 'finalized',
    'summary', v_summary,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.finalize_school_year_rollover(uuid, uuid, jsonb, uuid) from public;
revoke all on function public.finalize_school_year_rollover(uuid, uuid, jsonb, uuid) from anon;
grant execute on function public.finalize_school_year_rollover(uuid, uuid, jsonb, uuid) to authenticated;

create or replace function public.activate_school_year_rollover(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_school uuid;
  v_batch public.school_year_rollover_batches%rowtype;
  v_source_status text;
  v_target_status text;
begin
  select role, school_id into v_user_role, v_user_school
  from public.users where id = v_user_id;

  if v_user_role <> 'school_admin' or v_user_school is null then
    raise exception 'Only an authenticated school administrator can activate a school year';
  end if;

  select * into v_batch
  from public.school_year_rollover_batches
  where id = p_batch_id and school_id = v_user_school
  for update;

  if not found then raise exception 'Rollover batch not found'; end if;
  if v_batch.status = 'activated' then
    return jsonb_build_object('batch_id', v_batch.id, 'status', 'activated', 'idempotent_replay', true);
  end if;
  if v_batch.status <> 'finalized' then raise exception 'Rollover batch is not ready for activation'; end if;

  select status into v_source_status from public.academic_years
  where id = v_batch.source_year_id and school_id = v_user_school for update;
  select status into v_target_status from public.academic_years
  where id = v_batch.target_year_id and school_id = v_user_school for update;

  if v_source_status <> 'closing' then raise exception 'Source year must be closing'; end if;
  if v_target_status <> 'draft' then raise exception 'Target year must be draft'; end if;

  if not exists (
    select 1 from public.student_enrollments
    where school_id = v_user_school and academic_year_id = v_batch.target_year_id
  ) then
    raise exception 'Target year has no student enrollments';
  end if;

  if not exists (
    select 1 from public.schedules
    where school_id = v_user_school and academic_year_id = v_batch.target_year_id
  ) then
    raise exception 'Target year has no schedules';
  end if;

  update public.academic_years
  set status = 'closed', is_current = false, closed_at = now(), closed_by = v_user_id
  where id = v_batch.source_year_id;

  update public.academic_years
  set status = 'active', is_current = true
  where id = v_batch.target_year_id;

  -- Maintain the legacy current-section cache for old screens while all readers
  -- are migrated to student_enrollments.
  update public.students student
  set section_id = enrollment.section_id
  from public.student_enrollments enrollment
  where enrollment.student_id = student.id
    and enrollment.academic_year_id = v_batch.target_year_id
    and enrollment.school_id = v_user_school;

  update public.school_year_rollover_batches
  set status = 'activated', activated_at = now()
  where id = v_batch.id;

  return jsonb_build_object('batch_id', v_batch.id, 'status', 'activated', 'idempotent_replay', false);
end;
$$;

revoke all on function public.activate_school_year_rollover(uuid) from public;
revoke all on function public.activate_school_year_rollover(uuid) from anon;
grant execute on function public.activate_school_year_rollover(uuid) to authenticated;

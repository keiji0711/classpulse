import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const baseDir = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(resolve(baseDir, '.env'), 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const index = trimmed.indexOf('=');
  if (index > 0) env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
}
const manifest = JSON.parse(readFileSync(resolve(baseDir, 'test-manifest.json'), 'utf-8'));
if (env.ALLOW_PRODUCTION_LOAD_TEST !== 'I_UNDERSTAND_20000_ROWS') throw new Error('Explicit production confirmation is required');

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const instructor = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const date = new Date().toISOString().slice(0, 10);

function summarize(values, errors) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = value => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] || 0;
  return {
    operations: sorted.length,
    successful: sorted.length - errors.length,
    failed: errors.length,
    average_ms: Number((sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1)).toFixed(1)),
    p50_ms: Number(p(0.50).toFixed(1)),
    p95_ms: Number(p(0.95).toFixed(1)),
    p99_ms: Number(p(0.99).toFixed(1)),
    max_ms: Number((sorted.at(-1) || 0).toFixed(1)),
    errors: [...new Set(errors)].slice(0, 5),
  };
}

async function main() {
  let login;
  for (let attempt = 1; attempt <= 10; attempt++) {
    login = await instructor.auth.signInWithPassword({ email: 'loadtest_instructor@test.local', password: 'LOADTEST_Pass123!' });
    if (!login.error) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 2000));
  }
  if (login.error) throw new Error(`Pre-authentication failed: ${login.error.message}`);

  const schedules = manifest.schedules.slice(0, 100);
  const { error: ownershipError } = await admin.from('schedules').update({ instructor_id: manifest.instructorId }).in('id', schedules.map(schedule => schedule.id));
  if (ownershipError) throw ownershipError;

  const workloads = [];
  for (const [scheduleIndex, schedule] of schedules.entries()) {
    const roster = await admin.from('student_enrollments').select('student_id')
      .eq('academic_year_id', manifest.academicYearId).eq('section_id', schedule.section_id);
    if (roster.error) throw roster.error;
    workloads.push({
      schedule,
      records: roster.data.map((row, studentIndex) => ({
        student_id: row.student_id,
        status: ['present', 'present', 'present', 'absent', 'late', 'excused'][(scheduleIndex + studentIndex) % 6],
      })),
    });
  }

  const saveValues = [];
  const saveErrors = [];
  const waveStarted = performance.now();
  await Promise.all(workloads.map(async workload => {
    const started = performance.now();
    const result = await instructor.rpc('replace_class_attendance', {
      p_schedule_id: workload.schedule.id,
      p_date: date,
      p_records: workload.records,
    });
    saveValues.push(performance.now() - started);
    if (result.error) saveErrors.push(result.error.message);
  }));
  const waveDuration = performance.now() - waveStarted;

  const reopenValues = [];
  const reopenErrors = [];
  await Promise.all(workloads.map(async workload => {
    const started = performance.now();
    const result = await instructor.from('attendance_records').select('id', { count: 'exact', head: true })
      .eq('schedule_id', workload.schedule.id).eq('date', date);
    reopenValues.push(performance.now() - started);
    if (result.error) reopenErrors.push(result.error.message);
    else if (result.count !== workload.records.length) reopenErrors.push(`Expected ${workload.records.length}, found ${result.count || 0}`);
  }));

  const takenStarted = performance.now();
  const taken = await instructor.rpc('get_taken_attendance_schedule_ids', {
    p_academic_year_id: manifest.academicYearId,
    p_date: date,
  });
  const takenLatency = performance.now() - takenStarted;

  const baseline = workloads[0];
  const rejected = await instructor.rpc('replace_class_attendance', {
    p_schedule_id: baseline.schedule.id,
    p_date: date,
    p_records: baseline.records.slice(1),
  });
  const rollbackCheck = await instructor.from('attendance_records').select('id', { count: 'exact', head: true })
    .eq('schedule_id', baseline.schedule.id).eq('date', date);

  const report = {
    created_at: new Date().toISOString(),
    scenario: '100-simultaneous-preauthenticated-classroom-saves',
    simultaneous_requests: workloads.length,
    students_per_classroom: workloads[0]?.records.length || 0,
    total_attendance_rows: workloads.reduce((sum, workload) => sum + workload.records.length, 0),
    wave_duration_ms: Number(waveDuration.toFixed(1)),
    save: summarize(saveValues, saveErrors),
    reopen: summarize(reopenValues, reopenErrors),
    taken_schedule_count: taken.data?.length || 0,
    taken_schedule_latency_ms: Number(takenLatency.toFixed(1)),
    taken_schedule_error: taken.error?.message || null,
    rollback_protected: Boolean(rejected.error) && rollbackCheck.count === baseline.records.length,
  };
  const reportPath = resolve(baseDir, `attendance-100-concurrent-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
  if (saveErrors.length || reopenErrors.length || taken.error || !report.rollback_protected) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

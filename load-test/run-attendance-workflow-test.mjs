import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const baseDir = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const raw = readFileSync(resolve(baseDir, '.env'), 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const split = trimmed.indexOf('=');
    if (split < 0) continue;
    const key = trimmed.slice(0, split).trim();
    const value = trimmed.slice(split + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const concurrency = Number.parseInt(process.env.CONCURRENCY || '10', 10);
const confirmation = process.env.ALLOW_PRODUCTION_LOAD_TEST || '';
const knownProductionRef = 'qqjaprrpstbqjlxghoot';

if (!url || !serviceKey) throw new Error('Missing Supabase configuration');
if (new URL(url).hostname.split('.')[0] === knownProductionRef && confirmation !== 'I_UNDERSTAND_20000_ROWS') {
  throw new Error('Production attendance test requires the explicit load-test confirmation');
}

const manifest = JSON.parse(readFileSync(resolve(baseDir, 'test-manifest.json'), 'utf-8'));
const client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const testDate = new Date().toISOString().slice(0, 10);

class Metric {
  constructor(name) {
    this.name = name;
    this.ok = 0;
    this.failed = 0;
    this.latencies = [];
    this.errors = [];
  }
  add(startedAt, error = null) {
    this.latencies.push(performance.now() - startedAt);
    if (error) {
      this.failed++;
      this.errors.push(error.message || String(error));
    } else {
      this.ok++;
    }
  }
  summary() {
    const values = [...this.latencies].sort((a, b) => a - b);
    const percentile = value => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * value))] : 0;
    return {
      name: this.name,
      operations: values.length,
      success: this.ok,
      failed: this.failed,
      average_ms: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : 0,
      p50_ms: Number(percentile(0.50).toFixed(1)),
      p95_ms: Number(percentile(0.95).toFixed(1)),
      p99_ms: Number(percentile(0.99).toFixed(1)),
      max_ms: values.length ? Number(values.at(-1).toFixed(1)) : 0,
      errors: [...new Set(this.errors)].slice(0, 5),
    };
  }
}

async function parallelLimit(items, limit, action) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await action(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  const metrics = {
    scheduleLoad: new Metric('Schedule list load'),
    uiTakenCheck: new Metric('Current UI taken-schedule check'),
    rosterLoad: new Metric('Class roster load'),
    existingLoad: new Metric('Existing attendance load'),
    deleteSave: new Metric('Attendance replace delete'),
    insertSave: new Metric('Attendance class insert'),
    reopenLoad: new Metric('Saved class reopen'),
    uiHistory: new Metric('Current UI attendance-history query'),
    verifiedCount: new Metric('Chunked attendance verification'),
  };

  const auth = await client.auth.signInWithPassword({
    email: 'loadtest_instructor@test.local',
    password: 'LOADTEST_Pass123!',
  });
  if (auth.error) throw new Error(`Instructor login failed: ${auth.error.message}`);
  if (auth.data.user?.id !== manifest.instructorId) throw new Error('Authenticated instructor does not match the test manifest');

  let startedAt = performance.now();
  const scheduleResult = await client
    .from('schedules')
    .select('*, subject:subjects(*), section:sections(*)')
    .eq('instructor_id', manifest.instructorId)
    .eq('academic_year_id', manifest.academicYearId)
    .order('day_of_week')
    .order('time_start');
  metrics.scheduleLoad.add(startedAt, scheduleResult.error);
  if (scheduleResult.error) throw scheduleResult.error;
  const schedules = scheduleResult.data || [];
  if (schedules.length !== manifest.schedules.length) throw new Error(`Expected ${manifest.schedules.length} schedules, received ${schedules.length}`);

  const scheduleIds = schedules.map(schedule => schedule.id);
  startedAt = performance.now();
  const takenResult = await client
    .from('attendance_records')
    .select('schedule_id')
    .in('schedule_id', scheduleIds)
    .eq('date', testDate);
  metrics.uiTakenCheck.add(startedAt, takenResult.error);

  let processedStudents = 0;
  await parallelLimit(schedules, concurrency, async (schedule, scheduleIndex) => {
    let operationStart = performance.now();
    const rosterResult = await client
      .from('student_enrollments')
      .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
      .eq('school_id', manifest.schoolId)
      .eq('academic_year_id', manifest.academicYearId)
      .eq('section_id', schedule.section_id)
      .order('last_name', { foreignTable: 'student' });
    metrics.rosterLoad.add(operationStart, rosterResult.error);
    if (rosterResult.error) return;

    const students = (rosterResult.data || []).map(row => Array.isArray(row.student) ? row.student[0] : row.student).filter(Boolean);
    processedStudents += students.length;

    operationStart = performance.now();
    const existingResult = await client
      .from('attendance_records')
      .select('student_id, status')
      .eq('schedule_id', schedule.id)
      .eq('date', testDate);
    metrics.existingLoad.add(operationStart, existingResult.error);
    if (existingResult.error) return;

    operationStart = performance.now();
    const deleteResult = await client
      .from('attendance_records')
      .delete()
      .eq('schedule_id', schedule.id)
      .eq('date', testDate);
    metrics.deleteSave.add(operationStart, deleteResult.error);
    if (deleteResult.error) return;

    const records = students.map((student, studentIndex) => ({
      schedule_id: schedule.id,
      student_id: student.id,
      date: testDate,
      status: ['present', 'present', 'present', 'absent', 'late', 'excused'][(scheduleIndex + studentIndex) % 6],
      recorded_by: manifest.instructorId,
    }));
    operationStart = performance.now();
    const insertResult = await client.from('attendance_records').insert(records).select('id');
    metrics.insertSave.add(operationStart, insertResult.error);
    if (insertResult.error) return;

    operationStart = performance.now();
    const reopenResult = await client
      .from('attendance_records')
      .select('student_id, status')
      .eq('schedule_id', schedule.id)
      .eq('date', testDate);
    metrics.reopenLoad.add(operationStart, reopenResult.error);
  });

  startedAt = performance.now();
  const historyResult = await client
    .from('attendance_records')
    .select('*, student:students(first_name, last_name, lrn), schedule:schedules(*, subject:subjects(name, code), section:sections(name))')
    .in('schedule_id', scheduleIds)
    .gte('date', testDate)
    .lte('date', testDate)
    .order('date', { ascending: false })
    .order('recorded_at', { ascending: false });
  metrics.uiHistory.add(startedAt, historyResult.error);

  startedAt = performance.now();
  let verifiedCount = 0;
  let verifyError = null;
  for (let index = 0; index < scheduleIds.length; index += 50) {
    const result = await client
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('date', testDate)
      .in('schedule_id', scheduleIds.slice(index, index + 50));
    if (result.error) {
      verifyError = result.error;
      break;
    }
    verifiedCount += result.count || 0;
  }
  metrics.verifiedCount.add(startedAt, verifyError);

  const report = {
    created_at: new Date().toISOString(),
    scenario: 'authenticated-instructor-attendance-workflow',
    concurrency,
    schedules: schedules.length,
    expected_students: manifest.totalStudents,
    processed_roster_rows: processedStudents,
    verified_attendance_rows: verifiedCount,
    current_ui_taken_check_rows: takenResult.data?.length ?? null,
    current_ui_taken_check_error: takenResult.error?.message ?? null,
    current_ui_history_rows: historyResult.data?.length ?? null,
    current_ui_history_error: historyResult.error?.message ?? null,
    metrics: Object.values(metrics).map(metric => metric.summary()),
  };

  const reportPath = resolve(baseDir, `attendance-workflow-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);

  if (verifiedCount !== manifest.totalStudents) process.exitCode = 1;
  if (report.metrics.some(metric => ['Class roster load', 'Attendance class insert', 'Saved class reopen'].includes(metric.name) && metric.failed > 0)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

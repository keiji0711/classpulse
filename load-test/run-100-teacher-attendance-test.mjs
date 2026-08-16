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
const productionRef = 'qqjaprrpstbqjlxghoot';
if (new URL(env.SUPABASE_URL).hostname.split('.')[0] === productionRef && env.ALLOW_PRODUCTION_LOAD_TEST !== 'I_UNDERSTAND_20000_ROWS') {
  throw new Error('Production concurrency test requires explicit confirmation');
}

const instructorIds = manifest.instructorIds || [manifest.instructorId];
const testDate = new Date().toISOString().slice(0, 10);
const password = 'LOADTEST_Pass123!';
const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

class Metric {
  constructor(name) { this.name = name; this.values = []; this.errors = []; }
  add(start, error = null) {
    this.values.push(performance.now() - start);
    if (error) this.errors.push(error.message || String(error));
  }
  report() {
    const sorted = [...this.values].sort((a, b) => a - b);
    const p = value => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] : 0;
    return {
      name: this.name,
      operations: sorted.length,
      successful: sorted.length - this.errors.length,
      failed: this.errors.length,
      average_ms: sorted.length ? Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(1)) : 0,
      p50_ms: Number(p(0.50).toFixed(1)),
      p95_ms: Number(p(0.95).toFixed(1)),
      p99_ms: Number(p(0.99).toFixed(1)),
      max_ms: sorted.length ? Number(sorted.at(-1).toFixed(1)) : 0,
      errors: [...new Set(this.errors)].slice(0, 5),
    };
  }
}

async function parallelLimit(items, limit, action) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await action(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  if (instructorIds.length !== 100) throw new Error(`Expected 100 instructors, found ${instructorIds.length}`);

  const metrics = {
    login: new Metric('Instructor login'),
    roster: new Metric('Roster load'),
    atomicSave: new Metric('Atomic classroom save'),
    reopen: new Metric('Saved classroom reopen'),
    taken: new Metric('Taken-schedule summary'),
    history: new Metric('Paginated history'),
  };
  const teachers = Array.from({ length: instructorIds.length }, () => null);

  await parallelLimit(instructorIds, 3, async (instructorId, index) => {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = index === 0 ? 'loadtest_instructor@test.local' : `loadtest_instructor_${String(index).padStart(3, '0')}@test.local`;
    const startedAt = performance.now();
    let login;
    for (let attempt = 1; attempt <= 8; attempt++) {
      login = await client.auth.signInWithPassword({ email, password });
      if (!login.error || !login.error.message.toLowerCase().includes('rate limit')) break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, attempt * 1500));
    }
    metrics.login.add(startedAt, login.error);
    if (login.error) return;
    if (login.data.user?.id !== instructorId) throw new Error(`Instructor identity mismatch at index ${index}`);
    teachers[index] = {
      id: instructorId,
      client,
      schedules: manifest.schedules.filter(schedule => schedule.instructor_id === instructorId),
    };
  });

  if (teachers.filter(Boolean).length !== instructorIds.length) throw new Error('One or more instructors failed to authenticate');
  const maxWaves = Math.max(...teachers.map(teacher => teacher.schedules.length));
  const waveDurations = [];

  for (let wave = 0; wave < maxWaves; wave++) {
    const activeTeachers = teachers.filter(teacher => teacher.schedules[wave]);
    const waveStart = performance.now();
    await Promise.all(activeTeachers.map(async (teacher, teacherIndex) => {
      const schedule = teacher.schedules[wave];
      let startedAt = performance.now();
      const roster = await teacher.client
        .from('student_enrollments')
        .select('student_id')
        .eq('school_id', manifest.schoolId)
        .eq('academic_year_id', manifest.academicYearId)
        .eq('section_id', schedule.section_id);
      metrics.roster.add(startedAt, roster.error);
      if (roster.error) return;

      const records = (roster.data || []).map((student, studentIndex) => ({
        student_id: student.student_id,
        status: ['present', 'present', 'present', 'absent', 'late', 'excused'][(wave + teacherIndex + studentIndex) % 6],
      }));
      startedAt = performance.now();
      const save = await teacher.client.rpc('replace_class_attendance', {
        p_schedule_id: schedule.id,
        p_date: testDate,
        p_records: records,
      });
      metrics.atomicSave.add(startedAt, save.error);
      if (save.error) return;

      startedAt = performance.now();
      const reopen = await teacher.client
        .from('attendance_records')
        .select('student_id, status')
        .eq('schedule_id', schedule.id)
        .eq('date', testDate);
      const reopenError = reopen.error || (reopen.data?.length !== records.length ? new Error(`Expected ${records.length} records, found ${reopen.data?.length || 0}`) : null);
      metrics.reopen.add(startedAt, reopenError);
    }));
    waveDurations.push(Number((performance.now() - waveStart).toFixed(1)));
  }

  await Promise.all(teachers.map(async teacher => {
    let startedAt = performance.now();
    const taken = await teacher.client.rpc('get_taken_attendance_schedule_ids', {
      p_academic_year_id: manifest.academicYearId,
      p_date: testDate,
    });
    metrics.taken.add(startedAt, taken.error);

    startedAt = performance.now();
    const history = await teacher.client.rpc('get_instructor_attendance_history', {
      p_academic_year_id: manifest.academicYearId,
      p_date_from: testDate,
      p_date_to: testDate,
      p_status: null,
      p_search: null,
      p_limit: 25,
      p_offset: 0,
    });
    const historyError = history.error || ((history.data?.total || 0) !== teacher.schedules.length * 50
      ? new Error(`Expected ${teacher.schedules.length * 50} history rows, found ${history.data?.total || 0}`)
      : null);
    metrics.history.add(startedAt, historyError);
  }));

  const scheduleIds = manifest.schedules.map(schedule => schedule.id);
  let attendanceCount = 0;
  for (let index = 0; index < scheduleIds.length; index += 25) {
    const result = await adminClient.from('attendance_records').select('id', { count: 'exact', head: true })
      .eq('date', testDate).in('schedule_id', scheduleIds.slice(index, index + 25));
    if (result.error) throw result.error;
    attendanceCount += result.count || 0;
  }

  const firstTeacher = teachers[0];
  const firstSchedule = firstTeacher.schedules[0];
  const baseline = await firstTeacher.client.from('attendance_records').select('student_id, status')
    .eq('schedule_id', firstSchedule.id).eq('date', testDate);
  if (baseline.error) throw baseline.error;
  const invalidSave = await firstTeacher.client.rpc('replace_class_attendance', {
    p_schedule_id: firstSchedule.id,
    p_date: testDate,
    p_records: baseline.data.slice(1),
  });
  const afterRejectedSave = await firstTeacher.client.from('attendance_records').select('id', { count: 'exact', head: true })
    .eq('schedule_id', firstSchedule.id).eq('date', testDate);
  const rollbackProtected = Boolean(invalidSave.error) && afterRejectedSave.count === baseline.data.length;

  const report = {
    created_at: new Date().toISOString(),
    instructors: teachers.length,
    classroom_waves: maxWaves,
    schedules: manifest.schedules.length,
    students: manifest.totalStudents,
    attendance_rows: attendanceCount,
    wave_durations_ms: waveDurations,
    rollback_protected: rollbackProtected,
    metrics: Object.values(metrics).map(metric => metric.report()),
  };
  const reportPath = resolve(baseDir, `attendance-100-teacher-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);

  if (attendanceCount !== manifest.totalStudents || !rollbackProtected || report.metrics.some(metric => metric.failed > 0)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});

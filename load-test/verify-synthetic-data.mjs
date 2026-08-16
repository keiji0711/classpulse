import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const date = new Date().toISOString().slice(0, 10);

async function exactCount(table, filters) {
  let query = client.from(table).select('id', { count: 'exact', head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

async function attendanceCount() {
  const ids = manifest.schedules.map(schedule => schedule.id);
  let total = 0;
  for (let index = 0; index < ids.length; index += 25) {
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await client
        .from('attendance_records')
        .select('id', { count: 'exact', head: true })
        .eq('date', date)
        .in('schedule_id', ids.slice(index, index + 25));
      if (!result.error) break;
      if (attempt < 3) await new Promise(resolvePromise => setTimeout(resolvePromise, 500 * attempt));
    }
    if (result.error) throw result.error;
    total += result.count || 0;
  }
  return total;
}

const result = {
  students: await exactCount('students', { school_id: manifest.schoolId }),
  enrollments: await exactCount('student_enrollments', { school_id: manifest.schoolId, academic_year_id: manifest.academicYearId }),
  schedules: await exactCount('schedules', { school_id: manifest.schoolId, academic_year_id: manifest.academicYearId }),
  attendance: await attendanceCount(),
};

console.log(JSON.stringify(result, null, 2));
if (result.students !== manifest.totalStudents || result.enrollments !== manifest.totalStudents || result.attendance !== manifest.totalStudents) process.exitCode = 1;

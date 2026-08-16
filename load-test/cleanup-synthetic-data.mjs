// ═══════════════════════════════════════════════════════════════════
// cleanup-synthetic-data.mjs — Removes all LOADTEST-tagged rows
// from the database. Run after testing to keep DB clean.
// ═══════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, '.env'), 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env not found */ }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY_HERE') {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(__dirname, 'test-manifest.json'), 'utf-8'));
} catch {
  console.error('❌ test-manifest.json not found');
  process.exit(1);
}

const TAG = manifest.tag || 'LOADTEST';
const instructorIds = manifest.instructorIds || [manifest.instructorId];

async function deleteRowsInBatches(table, selectQuery, batchSize = 250) {
  let deleted = 0;
  while (true) {
    const { data, error: selectError } = await selectQuery().limit(batchSize);
    if (selectError) return selectError;
    if (!data?.length) break;
    const { error: deleteError } = await supabase.from(table).delete().in('id', data.map(row => row.id));
    if (deleteError) return deleteError;
    deleted += data.length;
    process.stdout.write(`  -> ${deleted} ${table} rows deleted\r`);
  }
  if (deleted) process.stdout.write('\n');
  return null;
}

async function cleanup() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ClassPulse Load Test — Cleanup');
  console.log('═══════════════════════════════════════════════\n');

  const t0 = Date.now();

  // 1. Delete attendance records (references schedules)
  console.log('🗑️  Deleting attendance records…');
  const scheduleIds = manifest.schedules.map(s => s.id);
  if (scheduleIds.length) {
    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .in('schedule_id', scheduleIds);
    console.log(error ? `  ⚠️ ${error.message}` : '  ✅ Done');
  }

  // 2. Delete messages referencing test students
  console.log('🗑️  Deleting messages…');
  const { data: testStudents } = await supabase
    .from('students')
    .select('id')
    .like('lrn', `${TAG}-%`)
    .eq('school_id', manifest.schoolId)
    .limit(10000);

  if (testStudents?.length) {
    const studentIds = testStudents.map(s => s.id);
    // Delete in batches of 500 to avoid URL length limits
    for (let i = 0; i < studentIds.length; i += 500) {
      const batch = studentIds.slice(i, i + 500);
      await supabase.from('messages').delete().in('student_id', batch);
    }
    console.log('  ✅ Done');
  }

  // 3. Delete parents (references students)
  console.log('🗑️  Deleting parents…');
  if (testStudents?.length) {
    const studentIds = testStudents.map(s => s.id);
    for (let i = 0; i < studentIds.length; i += 500) {
      const batch = studentIds.slice(i, i + 500);
      await supabase.from('parents').delete().in('student_id', batch);
    }
    console.log('  ✅ Done');
  }

  // 4. Delete students
  console.log('🗑️  Deleting students…');
  const stuErr = await deleteRowsInBatches('students', () => supabase
    .from('students')
    .select('id')
    .like('lrn', `${TAG}-%`)
    .eq('school_id', manifest.schoolId));
  console.log(stuErr ? `  ⚠️ ${stuErr.message}` : '  ✅ Done');

  // 5. Delete schedules
  console.log('🗑️  Deleting schedules…');
  if (scheduleIds.length) {
    const { error } = await supabase
      .from('schedules')
      .delete()
      .in('id', scheduleIds);
    console.log(error ? `  ⚠️ ${error.message}` : '  ✅ Done');
  }

  // 6. Delete sections
  console.log('🗑️  Deleting sections…');
  const secErr = await deleteRowsInBatches('sections', () => supabase
    .from('sections')
    .select('id')
    .like('name', `${TAG}_Sec%`)
    .eq('school_id', manifest.schoolId), 100);
  console.log(secErr ? `  ⚠️ ${secErr.message}` : '  ✅ Done');

  // 7. Delete subject
  console.log('🗑️  Deleting subject…');
  const { error: subErr } = await supabase
    .from('subjects')
    .delete()
    .eq('name', `${TAG}_Subject`)
    .eq('school_id', manifest.schoolId);
  console.log(subErr ? `  ⚠️ ${subErr.message}` : '  ✅ Done');

  // 8. Delete user (instructor)
  console.log('🗑️  Deleting instructor user…');
  const { error: userErr } = await supabase
    .from('users')
    .delete()
    .in('id', instructorIds);
  console.log(userErr ? `  ⚠️ ${userErr.message}` : '  ✅ Done');

  // 9. Delete auth user
  console.log('🗑️  Deleting auth user…');
  let authErr = null;
  for (const instructorId of instructorIds) {
    const result = await supabase.auth.admin.deleteUser(instructorId);
    if (result.error && result.error.message !== 'User not found') authErr = result.error;
  }
  console.log(authErr ? `  ⚠️ ${authErr.message}` : '  ✅ Done');

  // 10. Delete school
  console.log('🗑️  Deleting test school…');
  const { error: schErr } = await supabase
    .from('schools')
    .delete()
    .eq('id', manifest.schoolId);
  console.log(schErr ? `  ⚠️ ${schErr.message}` : '  ✅ Done');

  const [studentCheck, schoolCheck] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', manifest.schoolId).like('lrn', `${TAG}-%`),
    supabase.from('schools').select('id', { count: 'exact', head: true }).eq('id', manifest.schoolId),
  ]);
  if (studentCheck.error) throw new Error(`Student cleanup verification failed: ${studentCheck.error.message}`);
  if (schoolCheck.error) throw new Error(`School cleanup verification failed: ${schoolCheck.error.message}`);
  if ((studentCheck.count || 0) !== 0 || (schoolCheck.count || 0) !== 0) {
    throw new Error(`Cleanup incomplete: ${studentCheck.count || 0} tagged students and ${schoolCheck.count || 0} tagged schools remain`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Cleanup complete in ${elapsed}s\n`);
}

cleanup().catch(err => { console.error('💥 Cleanup failed:', err); process.exit(1); });

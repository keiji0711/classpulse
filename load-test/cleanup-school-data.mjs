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
  } catch {
    // Intentionally ignore missing local env file.
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY_HERE') {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in load-test/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TABLES_TO_CLEAR = [
  { name: 'notification_logs', label: 'Notification logs' },
  { name: 'messages', label: 'Messages' },
  { name: 'attendance_records', label: 'Attendance records' },
  { name: 'exam_scores', label: 'Exam scores' },
  { name: 'grades', label: 'Grades' },
  { name: 'intervention_actions', label: 'Intervention actions' },
  { name: 'attendance_interventions', label: 'Attendance interventions' },
  { name: 'student_enrollments', label: 'Student enrollments' },
  { name: 'parents', label: 'Parents' },
  { name: 'schedules', label: 'Schedules' },
  { name: 'section_subjects', label: 'Section subjects' },
  { name: 'students', label: 'Students' },
  { name: 'academic_years', label: 'Academic years' },
  { name: 'sections', label: 'Sections' },
  { name: 'subjects', label: 'Subjects' },
  { name: 'strands', label: 'Strands' },
];

async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .not('id', 'is', null);

  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteAllRows(table) {
  const { error } = await supabase
    .from(table)
    .delete()
    .not('id', 'is', null);

  if (error) throw new Error(`${table}: ${error.message}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ClassPulse Operational Data Cleanup');
  console.log('═══════════════════════════════════════════════');
  console.log('Preserved: users/auth accounts, schools, plans, subscriptions, invoices, email logs\n');

  const startedAt = Date.now();
  const results = [];

  for (const table of TABLES_TO_CLEAR) {
    const before = await countRows(table.name);
    if (before === 0) {
      results.push({ ...table, deleted: 0 });
      console.log(`- ${table.label}: already empty`);
      continue;
    }

    await deleteAllRows(table.name);
    const after = await countRows(table.name);
    const deleted = before - after;
    results.push({ ...table, deleted, remaining: after });
    console.log(`- ${table.label}: deleted ${deleted}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const totalDeleted = results.reduce((sum, row) => sum + row.deleted, 0);

  console.log(`\nCleanup complete in ${elapsed}s`);
  console.log(`Total rows deleted: ${totalDeleted}`);

  const notEmpty = results.filter((row) => (row.remaining ?? 0) > 0);
  if (notEmpty.length > 0) {
    console.log('\nTables still containing rows:');
    for (const row of notEmpty) {
      console.log(`- ${row.label}: ${row.remaining}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll targeted operational tables are now empty.');
}

main().catch((error) => {
  console.error('\nCleanup failed:', error.message ?? error);
  process.exit(1);
});
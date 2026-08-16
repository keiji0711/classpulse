// ═══════════════════════════════════════════════════════════════════
// seed-synthetic-data.mjs — Seeds 5000 synthetic students + parents
// into the DB for load testing. All synthetic rows are tagged with
// a recognisable prefix so cleanup is straightforward.
// ═══════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no dotenv dependency) ──────────────────
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
  } catch { /* .env not found, rely on real env vars */ }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOTAL_STUDENTS = parseInt(process.env.TOTAL_STUDENTS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const TEACHER_COUNT = parseInt(process.env.TEACHER_COUNT || '1', 10);
const TARGET_ENVIRONMENT = process.env.LOAD_TEST_TARGET || 'unset';
const PRODUCTION_CONFIRMATION = process.env.ALLOW_PRODUCTION_LOAD_TEST || '';
const KNOWN_PRODUCTION_PROJECT_REF = 'qqjaprrpstbqjlxghoot';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY_HERE') {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const targetProjectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
const targetsKnownProduction = targetProjectRef === KNOWN_PRODUCTION_PROJECT_REF;

if ((TARGET_ENVIRONMENT !== 'staging' || targetsKnownProduction) && PRODUCTION_CONFIRMATION !== 'I_UNDERSTAND_20000_ROWS') {
  console.error('Refusing to seed: set LOAD_TEST_TARGET=staging, or explicitly acknowledge a production run with ALLOW_PRODUCTION_LOAD_TEST=I_UNDERSTAND_20000_ROWS.');
  process.exit(1);
}

if (!Number.isInteger(TOTAL_STUDENTS) || TOTAL_STUDENTS < 1 || TOTAL_STUDENTS > 20000) {
  console.error('TOTAL_STUDENTS must be an integer from 1 through 20000.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Tag for cleanup ────────────────────────────────────────────
const TAG = 'LOADTEST';
const FAKE_FCM = 'fake-fcm-token-loadtest';

// ── Helpers ────────────────────────────────────────────────────
function lrn(i) { return `${TAG}-${String(i).padStart(6, '0')}`; }
function firstName(i) { return `TestStudent${i}`; }
function lastName(i) { return `Batch${Math.floor(i / 100)}`; }

// ── Ensure a test school exists ────────────────────────────────
async function ensureTestSchool() {
  const schoolName = `${TAG}_School`;

  // Check if it already exists
  const { data: existing } = await supabase
    .from('schools')
    .select('id')
    .eq('name', schoolName)
    .limit(1);

  if (existing?.length) {
    console.log(`✅ Test school already exists: ${existing[0].id}`);
    return existing[0].id;
  }

  const { data, error } = await supabase
    .from('schools')
    .insert({ name: schoolName, address: 'Load Test City' })
    .select('id')
    .single();

  if (error) throw new Error(`School insert failed: ${error.message}`);
  console.log(`✅ Created test school: ${data.id}`);
  return data.id;
}

// ── Ensure a test instructor (user) exists ─────────────────────
async function ensureTestInstructor(schoolId) {
  const email = `${TAG.toLowerCase()}_instructor@test.local`;

  // Check users table for existing
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .limit(1);

  if (existing?.length) {
    console.log(`✅ Test instructor already exists: ${existing[0].id}`);
    return existing[0].id;
  }

  // Create auth user via admin
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password: `${TAG}_Pass123!`,
    email_confirm: true,
    user_metadata: { role: 'instructor' },
  });

  if (authErr) throw new Error(`Auth user create failed: ${authErr.message}`);

  // Insert into users table
  const { error: insertErr } = await supabase.from('users').insert({
    id: authUser.user.id,
    email,
    role: 'instructor',
    school_id: schoolId,
    full_name: `${TAG} Instructor`,
  });

  if (insertErr) throw new Error(`Users insert failed: ${insertErr.message}`);
  console.log(`✅ Created test instructor: ${authUser.user.id}`);
  return authUser.user.id;
}

async function ensureTestInstructors(schoolId) {
  const instructorIds = [await ensureTestInstructor(schoolId)];
  for (let index = 1; index < TEACHER_COUNT; index++) {
    const email = `loadtest_instructor_${String(index).padStart(3, '0')}@test.local`;
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (existing?.length) {
      instructorIds.push(existing[0].id);
      continue;
    }
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: `${TAG}_Pass123!`,
      email_confirm: true,
      user_metadata: { role: 'instructor' },
    });
    if (authError) throw new Error(`Instructor ${index} auth creation failed: ${authError.message}`);
    const { error: userError } = await supabase.from('users').insert({
      id: authUser.user.id,
      email,
      role: 'instructor',
      school_id: schoolId,
      full_name: `${TAG} Instructor ${index}`,
    });
    if (userError) throw new Error(`Instructor ${index} profile creation failed: ${userError.message}`);
    instructorIds.push(authUser.user.id);
  }
  console.log(`Test instructors ready: ${instructorIds.length}`);
  return instructorIds;
}

// ── Ensure test subject exists ─────────────────────────────────
async function ensureTestSubject(schoolId) {
  const name = `${TAG}_Subject`;
  const { data: existing } = await supabase
    .from('subjects')
    .select('id')
    .eq('name', name)
    .eq('school_id', schoolId)
    .limit(1);

  if (existing?.length) return existing[0].id;

  const { data, error } = await supabase
    .from('subjects')
    .insert({ name, school_id: schoolId })
    .select('id')
    .single();

  if (error) throw new Error(`Subject insert failed: ${error.message}`);
  console.log(`✅ Created test subject: ${data.id}`);
  return data.id;
}

// ── Ensure sections (5000 students / ~50 per section = 100 sections) ──
async function ensureSections(schoolId, count) {
  const prefix = `${TAG}_Sec`;
  const { data: existing } = await supabase
    .from('sections')
    .select('id, name')
    .like('name', `${prefix}%`)
    .eq('school_id', schoolId);

  if (existing?.length >= count) {
    console.log(`✅ ${existing.length} test sections already exist`);
    return existing.map(s => s.id);
  }

  const toCreate = count - (existing?.length || 0);
  const startIdx = existing?.length || 0;
  const rows = [];
  for (let i = startIdx; i < startIdx + toCreate; i++) {
    rows.push({ name: `${prefix}${String(i).padStart(3, '0')}`, school_id: schoolId, grade_level: 'Grade 7' });
  }

  const { data, error } = await supabase.from('sections').insert(rows).select('id');
  if (error) throw new Error(`Sections insert failed: ${error.message}`);
  const allIds = [...(existing || []).map(s => s.id), ...data.map(s => s.id)];
  console.log(`✅ ${allIds.length} test sections ready`);
  return allIds;
}

// ── Ensure schedules (1 per section) ───────────────────────────
async function ensureSchedules(schoolId, sectionIds, subjectId, instructorIds) {
  // Get academic year
  const { data: ay } = await supabase
    .from('academic_years')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_current', true)
    .limit(1);

  let academicYearId = ay?.[0]?.id;

  if (!academicYearId) {
    const { data: newAy, error } = await supabase
      .from('academic_years')
      .insert({
        school_id: schoolId,
        name: `${new Date().getUTCFullYear()}-${new Date().getUTCFullYear() + 1}`,
        start_date: `${new Date().getUTCFullYear()}-01-01`,
        end_date: `${new Date().getUTCFullYear()}-12-31`,
        is_current: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Academic year insert failed: ${error.message}`);
    academicYearId = newAy.id;
    console.log(`✅ Created academic year: ${academicYearId}`);
  }

  const { data: existing } = await supabase
    .from('schedules')
    .select('id, section_id, instructor_id')
    .in('instructor_id', instructorIds)
    .eq('subject_id', subjectId);

  const existingSet = new Set((existing || []).map(s => s.section_id));
  const missing = sectionIds.filter(id => !existingSet.has(id));

  if (missing.length === 0) {
    console.log(`✅ ${(existing || []).length} test schedules already exist`);
    return { academicYearId, schedules: (existing || []).map(s => ({ id: s.id, section_id: s.section_id, instructor_id: s.instructor_id })) };
  }

  const rows = missing.map((secId, index) => ({
    section_id: secId,
    subject_id: subjectId,
    instructor_id: instructorIds[index % instructorIds.length],
    school_id: schoolId,
    academic_year_id: academicYearId,
    day_of_week: 'monday',
    time_start: '08:00',
    time_end: '09:00',
  }));

  const { data, error } = await supabase.from('schedules').insert(rows).select('id, section_id, instructor_id');
  if (error) throw new Error(`Schedules insert failed: ${error.message}`);

  const all = [...(existing || []).map(s => ({ id: s.id, section_id: s.section_id, instructor_id: s.instructor_id })), ...data];
  console.log(`✅ ${all.length} test schedules ready`);
  return { academicYearId, schedules: all };
}

// ── Seed students + parents ────────────────────────────────────
async function seedStudents(schoolId, sectionIds) {
  // Check already seeded
  const { count: existingCount } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .like('lrn', `${TAG}-%`)
    .eq('school_id', schoolId);

  if (existingCount >= TOTAL_STUDENTS) {
    console.log(`✅ ${existingCount} test students already exist — skipping`);
    return;
  }

  const start = existingCount || 0;
  const remaining = TOTAL_STUDENTS - start;
  console.log(`📝 Seeding ${remaining} students (${start} already exist)…`);

  let created = 0;
  for (let batch = 0; batch < Math.ceil(remaining / BATCH_SIZE); batch++) {
    const batchStart = start + batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL_STUDENTS);
    const studentRows = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const sectionId = sectionIds[i % sectionIds.length];
      studentRows.push({
        lrn: lrn(i),
        first_name: firstName(i),
        last_name: lastName(i),
        section_id: sectionId,
        school_id: schoolId,
      });
    }

    const { data: inserted, error } = await supabase
      .from('students')
      .insert(studentRows)
      .select('id');

    if (error) {
      console.error(`  ❌ Student batch ${batch} failed: ${error.message}`);
      continue;
    }

    // Create parents for each student
    const parentRows = inserted.map((s, idx) => ({
      student_id: s.id,
      school_id: schoolId,
      guardian_name: `Parent of ${firstName(batchStart + idx)}`,
      phone_number: `09170000${String(batchStart + idx).padStart(4, '0')}`,
      fcm_push_token: `${FAKE_FCM}-${batchStart + idx}`,
    }));

    const { error: parentErr } = await supabase.from('parents').insert(parentRows);
    if (parentErr) {
      console.error(`  ⚠️ Parent batch ${batch} partial fail: ${parentErr.message}`);
    }

    created += inserted.length;
    process.stdout.write(`  → ${created}/${remaining} students seeded\r`);
  }

  console.log(`\n✅ ${created} students + parents seeded`);
}

// ── Main ───────────────────────────────────────────────────────
async function ensureEnrollments(schoolId, academicYearId) {
  const pageSize = 1000;
  let from = 0;
  let enrolled = 0;

  while (true) {
    const { data: students, error: fetchError } = await supabase
      .from('students')
      .select('id, section_id')
      .eq('school_id', schoolId)
      .like('lrn', `${TAG}-%`)
      .order('id')
      .range(from, from + pageSize - 1);
    if (fetchError) throw new Error(`Student enrollment fetch failed: ${fetchError.message}`);
    if (!students?.length) break;

    const enrollmentRows = students.map(student => ({
      student_id: student.id,
      section_id: student.section_id,
      academic_year_id: academicYearId,
      school_id: schoolId,
      enrollment_status: 'enrolled',
    }));
    const { error } = await supabase.from('student_enrollments').upsert(enrollmentRows, {
      onConflict: 'student_id,academic_year_id',
    });
    if (error) throw new Error(`Student enrollment batch failed: ${error.message}`);
    enrolled += enrollmentRows.length;
    process.stdout.write(`  -> ${enrolled} enrollments reconciled\r`);
    if (students.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\nCurrent-year enrollments ready: ${enrolled}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  ClassPulse Load Test — Seeding ${TOTAL_STUDENTS} students`);
  console.log('═══════════════════════════════════════════════\n');

  const t0 = Date.now();
  const schoolId = await ensureTestSchool();
  const instructorIds = await ensureTestInstructors(schoolId);
  const instructorId = instructorIds[0];
  const subjectId = await ensureTestSubject(schoolId);

  const sectionCount = Math.ceil(TOTAL_STUDENTS / 50);
  const sectionIds = await ensureSections(schoolId, sectionCount);
  const { academicYearId, schedules } = await ensureSchedules(schoolId, sectionIds, subjectId, instructorIds);
  await seedStudents(schoolId, sectionIds);
  await ensureEnrollments(schoolId, academicYearId);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Seeding complete in ${elapsed}s`);
  console.log(`   School:     ${schoolId}`);
  console.log(`   Instructor: ${instructorId}`);
  console.log(`   Sections:   ${sectionIds.length}`);
  console.log(`   Schedules:  ${schedules.length}`);
  console.log(`   Students:   ${TOTAL_STUDENTS}`);

  // Save IDs for the test runner
  const manifest = {
    schoolId,
    instructorId,
    instructorIds,
    subjectId,
    academicYearId,
    sectionIds,
    schedules: schedules.map(s => ({ id: s.id, section_id: s.section_id, instructor_id: s.instructor_id })),
    totalStudents: TOTAL_STUDENTS,
    tag: TAG,
  };

  const { writeFileSync } = await import('fs');
  writeFileSync(resolve(__dirname, 'test-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('   Manifest:   test-manifest.json\n');
}

main().catch(err => { console.error('💥 Seed failed:', err); process.exit(1); });

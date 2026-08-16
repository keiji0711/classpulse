// ═══════════════════════════════════════════════════════════════════
// run-load-test.mjs — Inserts attendance records for 5000 students
// and optionally invokes the push-notification edge function for each.
// Collects per-operation latency, success/failure counts, and prints
// a full report at the end.
// ═══════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ──────────────────────────────────────────────────
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
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const TEST_PUSH = process.env.PUSH_NOTIFICATION_TEST !== 'false';
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
  console.error('Refusing to run load traffic: set LOAD_TEST_TARGET=staging, or explicitly acknowledge a production run with ALLOW_PRODUCTION_LOAD_TEST=I_UNDERSTAND_20000_ROWS.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Load manifest from seeding step ────────────────────────────
let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(__dirname, 'test-manifest.json'), 'utf-8'));
} catch {
  console.error('❌ test-manifest.json not found — run "npm run seed" first');
  process.exit(1);
}

// ── Metrics collector ──────────────────────────────────────────
class Metrics {
  constructor(name) {
    this.name = name;
    this.success = 0;
    this.failed = 0;
    this.latencies = [];
    this.errors = [];
  }

  record(durationMs, ok, error = null) {
    this.latencies.push(durationMs);
    if (ok) this.success++;
    else {
      this.failed++;
      if (error) this.errors.push(String(error).slice(0, 200));
    }
  }

  report() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const total = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    const p = (pct) => total > 0 ? sorted[Math.floor(total * pct / 100)] : 0;

    return {
      name: this.name,
      total,
      success: this.success,
      failed: this.failed,
      successRate: total > 0 ? ((this.success / total) * 100).toFixed(2) + '%' : 'N/A',
      avgMs: total > 0 ? (sum / total).toFixed(1) : 'N/A',
      minMs: sorted[0]?.toFixed(1) ?? 'N/A',
      maxMs: sorted[total - 1]?.toFixed(1) ?? 'N/A',
      p50Ms: p(50).toFixed(1),
      p90Ms: p(90).toFixed(1),
      p95Ms: p(95).toFixed(1),
      p99Ms: p(99).toFixed(1),
      totalTimeMs: sum.toFixed(0),
      topErrors: [...new Set(this.errors)].slice(0, 5),
    };
  }
}

// ── Concurrency limiter ────────────────────────────────────────
async function parallelLimit(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: Insert attendance records
// ═══════════════════════════════════════════════════════════════
async function phaseInsertAttendance() {
  console.log('\n📊 PHASE 1: Insert attendance records');
  console.log('─'.repeat(50));

  const metrics = new Metrics('Attendance Insert (batch)');
  const date = new Date().toISOString().split('T')[0]; // today

  // Get all test students (paginate — Supabase default limit is 1000)
  const students = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error: fetchErr } = await supabase
      .from('students')
      .select('id, section_id')
      .like('lrn', `${manifest.tag}-%`)
      .eq('school_id', manifest.schoolId)
      .range(from, from + PAGE - 1);

    if (fetchErr) {
      console.error('❌ Cannot fetch test students:', fetchErr.message);
      return { metrics, date: null, allRecords: [] };
    }
    if (!page?.length) break;
    students.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  if (!students.length) {
    console.error('❌ No test students found');
    return { metrics, date: null, allRecords: [] };
  }

  console.log(`  Found ${students.length} test students`);

  // Map section -> schedule
  const sectionToSchedule = {};
  for (const sch of manifest.schedules) {
    sectionToSchedule[sch.section_id] = sch.id;
  }

  // Build records
  const statuses = ['present', 'present', 'present', 'absent', 'late']; // 60% present, 20% absent, 20% late
  const allRecords = students.map((s, i) => ({
    schedule_id: sectionToSchedule[s.section_id],
    student_id: s.id,
    date,
    status: statuses[i % statuses.length],
    recorded_by: manifest.instructorId,
  })).filter(r => r.schedule_id); // skip if no matching schedule

  console.log(`  Prepared ${allRecords.length} records, inserting in batches of ${BATCH_SIZE}…\n`);

  // Delete any existing records for today (idempotent re-run)
  await supabase
    .from('attendance_records')
    .delete()
    .eq('date', date)
    .in('schedule_id', manifest.schedules.map(s => s.id));

  let inserted = 0;

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);
    const t0 = performance.now();

    const { data, error } = await supabase
      .from('attendance_records')
      .insert(batch)
      .select('id, student_id, schedule_id, status, date');

    const elapsed = performance.now() - t0;
    metrics.record(elapsed, !error, error?.message);

    if (error) {
      console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed (${elapsed.toFixed(0)}ms): ${error.message}`);
    } else {
      inserted += data.length;
      process.stdout.write(`  ✅ ${inserted}/${allRecords.length} inserted (batch: ${elapsed.toFixed(0)}ms)\r`);
    }
  }

  console.log(`\n  → ${inserted} records inserted total`);
  return { metrics, date, allRecords };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: Invoke send-push-notification-batch (one call per batch)
// ═══════════════════════════════════════════════════════════════
async function phasePushNotifications(date) {
  if (!TEST_PUSH) {
    console.log('\n⏭️  PHASE 2: Push notifications SKIPPED (PUSH_NOTIFICATION_TEST=false)');
    return { metrics: new Metrics('Push Notification (skipped)'), pushDetailMetrics: null };
  }

  console.log('\n📲 PHASE 2: Batch push notification edge function calls');
  console.log('─'.repeat(50));

  const metrics = new Metrics('Push Notification (batch)');
  const pushDetailMetrics = {
    delivered: 0,
    noToken: 0,
    pushFailed: 0,
    httpError: 0,
  };

  // Fetch today's records (paginate)
  const records = [];
  let rFrom = 0;
  const RPAGE = 1000;
  while (true) {
    const { data: rPage, error: rErr } = await supabase
      .from('attendance_records')
      .select('id, student_id, schedule_id, status, date')
      .eq('date', date)
      .in('schedule_id', manifest.schedules.map(s => s.id))
      .range(rFrom, rFrom + RPAGE - 1);

    if (rErr) {
      console.error('❌ Cannot fetch attendance records:', rErr.message);
      return { metrics, pushDetailMetrics };
    }
    if (!rPage?.length) break;
    records.push(...rPage);
    if (rPage.length < RPAGE) break;
    rFrom += RPAGE;
  }

  if (!records.length) {
    console.error('❌ No attendance records found for today');
    return { metrics, pushDetailMetrics };
  }

  console.log(`  Total records: ${records.length}`);
  console.log(`  Sending in batches of ${BATCH_SIZE} via batch edge function…\n`);

  let processed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const t0 = performance.now();

    try {
      const { data: resp, error: invokeErr } = await supabase.functions.invoke(
        'send-push-notification-batch',
        { body: { records: batch } }
      );

      const elapsed = performance.now() - t0;

      if (invokeErr) {
        metrics.record(elapsed, false, invokeErr.message);
        pushDetailMetrics.httpError += batch.length;
        console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} invoke error (${elapsed.toFixed(0)}ms): ${invokeErr.message}`);
      } else {
        metrics.record(elapsed, true);
        const s = resp?.summary;
        if (s) {
          pushDetailMetrics.delivered += s.delivered || 0;
          pushDetailMetrics.noToken += s.no_token || 0;
          pushDetailMetrics.pushFailed += s.failed || 0;
        }
        processed += batch.length;
        process.stdout.write(`  ✅ ${processed}/${records.length} processed (batch: ${elapsed.toFixed(0)}ms, avg_fcm: ${s?.avg_latency_ms ?? '?'}ms)\r`);
      }
    } catch (err) {
      const elapsed = performance.now() - t0;
      metrics.record(elapsed, false, err.message);
      pushDetailMetrics.httpError += batch.length;
      console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} exception (${elapsed.toFixed(0)}ms): ${err.message}`);
    }
  }

  console.log(`\n  Push detail breakdown:`);
  console.log(`    Delivered:   ${pushDetailMetrics.delivered}`);
  console.log(`    No token:    ${pushDetailMetrics.noToken}`);
  console.log(`    Push failed: ${pushDetailMetrics.pushFailed}`);
  console.log(`    HTTP error:  ${pushDetailMetrics.httpError}`);

  return { metrics, pushDetailMetrics };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: Read-back verification
// ═══════════════════════════════════════════════════════════════
async function phaseVerification(date) {
  console.log('\n🔍 PHASE 3: Data verification');
  console.log('─'.repeat(50));

  const metrics = new Metrics('Read-back Verification');

  const t0 = performance.now();
  let count = 0;
  let error = null;
  const scheduleIds = manifest.schedules.map(schedule => schedule.id);
  for (let index = 0; index < scheduleIds.length; index += 50) {
    const result = await supabase
      .from('attendance_records')
      .select('id', { count: 'exact', head: true })
      .eq('date', date)
      .in('schedule_id', scheduleIds.slice(index, index + 50));
    if (result.error) {
      error = result.error;
      break;
    }
    count += result.count || 0;
  }

  const elapsed = performance.now() - t0;
  metrics.record(elapsed, !error, error?.message);

  if (error) {
    console.error(`  ❌ Verification query failed: ${error.message}`);
  } else {
    console.log(`  Records in DB for today: ${count}`);
    console.log(`  Expected:                ${manifest.totalStudents}`);
    console.log(`  Match:                   ${count === manifest.totalStudents ? '✅ YES' : '❌ NO — data loss detected'}`);
    console.log(`  Query time:              ${elapsed.toFixed(1)}ms`);
  }

  return metrics;
}

// ═══════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════
function printReport(allMetrics, wallTimeMs) {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('  📋 LOAD TEST REPORT');
  console.log('═'.repeat(60));
  console.log(`  Total wall time: ${(wallTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Test date:       ${new Date().toISOString()}`);
  console.log(`  Students:        ${manifest.totalStudents}`);
  console.log(`  Batch size:      ${BATCH_SIZE}`);
  console.log(`  Concurrency:     ${CONCURRENCY}`);
  console.log('');

  for (const m of allMetrics) {
    const r = m.report();
    console.log(`  ┌─ ${r.name}`);
    console.log(`  │  Total ops:    ${r.total}`);
    console.log(`  │  Success:      ${r.success}  (${r.successRate})`);
    console.log(`  │  Failed:       ${r.failed}`);
    console.log(`  │  Avg latency:  ${r.avgMs}ms`);
    console.log(`  │  Min:          ${r.minMs}ms`);
    console.log(`  │  Max:          ${r.maxMs}ms`);
    console.log(`  │  P50:          ${r.p50Ms}ms`);
    console.log(`  │  P90:          ${r.p90Ms}ms`);
    console.log(`  │  P95:          ${r.p95Ms}ms`);
    console.log(`  │  P99:          ${r.p99Ms}ms`);
    if (r.topErrors.length) {
      console.log(`  │  Top errors:`);
      r.topErrors.forEach(e => console.log(`  │    • ${e}`));
    }
    console.log(`  └${'─'.repeat(50)}`);
    console.log('');
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ClassPulse Load Test — Running');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Target:      ${manifest.totalStudents} students`);
  console.log(`  Batch size:  ${BATCH_SIZE}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Push test:   ${TEST_PUSH ? 'YES' : 'NO'}`);

  const wallStart = Date.now();
  const allMetrics = [];

  // Phase 1
  const { metrics: insertMetrics, date } = await phaseInsertAttendance();
  allMetrics.push(insertMetrics);

  // Phase 2
  const { metrics: pushMetrics, pushDetailMetrics } = await phasePushNotifications(date);
  allMetrics.push(pushMetrics);

  // Phase 3
  const verifyMetrics = await phaseVerification(date);
  allMetrics.push(verifyMetrics);

  const wallTime = Date.now() - wallStart;
  printReport(allMetrics, wallTime);

  // Save JSON report
  const report = {
    timestamp: new Date().toISOString(),
    config: {
      totalStudents: manifest.totalStudents,
      batchSize: BATCH_SIZE,
      concurrency: CONCURRENCY,
      pushTest: TEST_PUSH,
    },
    wallTimeMs: wallTime,
    phases: allMetrics.map(m => m.report()),
    pushDetail: pushDetailMetrics || null,
  };

  const reportPath = resolve(__dirname, `report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 Full report saved: ${reportPath}\n`);
}

main().catch(err => { console.error('💥 Test failed:', err); process.exit(1); });

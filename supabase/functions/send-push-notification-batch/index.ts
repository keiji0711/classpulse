// ═══════════════════════════════════════════════════════════════
// send-push-notification-batch — Sends attendance push notifications
// for an entire class in ONE edge-function call.
//
// Optimizations over the per-record function:
//  1.  Single DB round-trip for ALL students + parents + school
//  2.  Parallel FCM sends with concurrency limiter
//  3.  Logs every attempt to notification_logs table
//  4.  Returns a full summary to the client
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { getParentAccessMap } from "../_shared/parentAccess.ts";
import { authorizeAttendanceBatch, staffAccessDenied } from "../_shared/staffAuthorization.ts";

// ── Concurrency limiter ────────────────────────────────────────
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const CONCURRENCY = 20; // parallel FCM sends

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const t0 = Date.now();

  try {
    const { records } = await req.json();

    // records: array of { id, student_id, schedule_id, status, date }
    if (!Array.isArray(records) || records.length === 0) {
      return new Response(
        JSON.stringify({ error: "records array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Batch-fetch all data we need (single round-trip each) ──

    const studentIds = [...new Set(records.map((r: any) => r.student_id))];
    const scheduleIds = [...new Set(records.map((r: any) => r.schedule_id))];

    // Fetch students + school in one query
    const { data: studentsRaw } = await supabaseAdmin
      .from("students")
      .select("id, first_name, last_name, school_id")
      .in("id", studentIds);

    const studentMap = new Map(
      (studentsRaw ?? []).map((s: any) => [s.id, s])
    );

    const staff = await authorizeAttendanceBatch(supabaseAdmin, authResult.user.id, records);
    if (!staff) return staffAccessDenied(corsHeaders);

    const parentAccess = await getParentAccessMap(supabaseAdmin, studentIds);
    const disabledStudentIds = new Set(
      studentIds.filter((studentId: string) => parentAccess.get(studentId) !== true),
    );

    // Get school info (all students share same school in a class)
    const schoolId = studentsRaw?.[0]?.school_id;
    let schoolName = "School";
    if (schoolId) {
      const { data: school } = await supabaseAdmin
        .from("schools")
        .select("name")
        .eq("id", schoolId)
        .single();
      schoolName = school?.name ?? "School";
    }

    // Fetch schedules + subjects
    const { data: schedulesRaw } = await supabaseAdmin
      .from("schedules")
      .select("id, time_start, time_end, subject:subjects(name)")
      .in("id", scheduleIds);

    const scheduleMap = new Map(
      (schedulesRaw ?? []).map((s: any) => [s.id, s])
    );

    // Fetch ALL parents for these students in one query
    const { data: parentsRaw } = await supabaseAdmin
      .from("parents")
      .select("student_id, fcm_push_token, guardian_name")
      .in("student_id", studentIds)
      .not("fcm_push_token", "is", null);

    // Map student_id → parent (pick first per student)
    const parentMap = new Map<string, any>();
    for (const p of parentsRaw ?? []) {
      if (!parentMap.has(p.student_id) && p.fcm_push_token?.trim()) {
        parentMap.set(p.student_id, p);
      }
    }

    // ── 2. Build notification tasks ───────────────────────────────

    type NotifResult = {
      student_id: string;
      attendance_record_id: string | null;
      status: "delivered" | "failed" | "no_token" | "skipped" | "stale_token";
      error_message: string | null;
      latency_ms: number;
      fcm_token_preview: string | null;
    };

    const tasks = records.map((rec: any) => async (): Promise<NotifResult> => {
      const start = Date.now();
      const student = studentMap.get(rec.student_id);
      const parent = parentMap.get(rec.student_id);
      const schedule = scheduleMap.get(rec.schedule_id);

      if (disabledStudentIds.has(rec.student_id)) {
        return {
          student_id: rec.student_id,
          attendance_record_id: rec.id ?? null,
          status: "skipped",
          error_message: "Parent notifications disabled by instructor",
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      if (!student) {
        return {
          student_id: rec.student_id,
          attendance_record_id: rec.id ?? null,
          status: "failed",
          error_message: "Student not found",
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      const token = parent?.fcm_push_token?.trim();

      if (!token) {
        return {
          student_id: rec.student_id,
          attendance_record_id: rec.id ?? null,
          status: "no_token",
          error_message: null,
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      // Build message
      const statusText =
        rec.status.charAt(0).toUpperCase() + rec.status.slice(1);
      const subjectName = (schedule as any)?.subject?.name ?? "a class";
      const timeSched = schedule
        ? `${fmtTime(schedule.time_start)} – ${fmtTime(schedule.time_end)}`
        : "";
      const title = `📋 ${schoolName}`;
      const body = `${student.first_name} ${student.last_name} was marked ${statusText} in ${subjectName}${timeSched ? ` (${timeSched})` : ""} on ${rec.date}.`;

      try {
        await sendFcmNotification({
          token,
          title,
          body,
          data: {
            notification_type: "attendance",
            student_id: student.id,
            schedule_id: rec.schedule_id,
            status: rec.status,
            date: rec.date,
          },
        });

        return {
          student_id: rec.student_id,
          attendance_record_id: rec.id ?? null,
          status: "delivered",
          error_message: null,
          latency_ms: Date.now() - start,
          fcm_token_preview: token.slice(-8),
        };
      } catch (err) {
        const staleToken = isStaleFcmTokenError(err);
        if (staleToken) {
          await supabaseAdmin.from("parents").update({ fcm_push_token: null }).eq("student_id", rec.student_id).eq("fcm_push_token", token);
        }
        return {
          student_id: rec.student_id,
          attendance_record_id: rec.id ?? null,
          status: staleToken ? "stale_token" : "failed",
          error_message: staleToken ? "Device token expired. The parent must reopen the app to register a new token." : err instanceof Error ? err.message.slice(0, 500) : String(err),
          latency_ms: Date.now() - start,
          fcm_token_preview: token.slice(-8),
        };
      }
    });

    // ── 3. Execute with concurrency limit ─────────────────────────

    const results = await parallelLimit(tasks, CONCURRENCY);

    // ── 4. Batch-insert notification logs ─────────────────────────

    const logRows = results.map((r) => ({
      school_id: schoolId ?? null,
      student_id: r.student_id,
      schedule_id: records.find((rec: any) => rec.student_id === r.student_id)?.schedule_id ?? null,
      attendance_record_id: r.attendance_record_id,
      type: "attendance_push",
      status: r.status,
      fcm_token_preview: r.fcm_token_preview,
      error_message: r.error_message,
      latency_ms: r.latency_ms,
    }));

    // Insert logs in batches of 500 to avoid payload limits
    for (let i = 0; i < logRows.length; i += 500) {
      const batch = logRows.slice(i, i + 500);
      const { error: logErr } = await supabaseAdmin
        .from("notification_logs")
        .insert(batch);
      if (logErr) {
        console.error("[batch-push] Log insert error:", logErr.message);
      }
    }

    // ── 5. Summary ────────────────────────────────────────────────

    const delivered = results.filter((r) => r.status === "delivered").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const noToken = results.filter((r) => r.status === "no_token").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const staleToken = results.filter((r) => r.status === "stale_token").length;
    const totalMs = Date.now() - t0;

    const summary = {
      total: records.length,
      delivered,
      failed,
      no_token: noToken,
      skipped,
      stale_token: staleToken,
      wall_time_ms: totalMs,
      avg_latency_ms: results.length
        ? Math.round(
            results.reduce((a, b) => a + b.latency_ms, 0) / results.length
          )
        : 0,
    };

    console.log("[batch-push] Summary:", JSON.stringify(summary));

    return new Response(JSON.stringify({ success: true, summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[batch-push] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

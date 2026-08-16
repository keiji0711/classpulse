// ═══════════════════════════════════════════════════════════════
// send-grade-notification — Sends grade/exam-score push notifications
// to parents of affected students.
//
// Matches the attendance batch pattern:
//  1.  Single DB round-trip per entity (students, parents, school)
//  2.  Parallel FCM sends with concurrency limiter (20)
//  3.  Logs every attempt to notification_logs table
//  4.  Returns full summary with latency metrics
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { sanitizeUUIDArray, sanitizeString } from "../_shared/validation.ts";
import { getParentAccessMap } from "../_shared/parentAccess.ts";
import { authorizeStaffStudents, staffAccessDenied } from "../_shared/staffAuthorization.ts";

// ── Concurrency limiter (same as attendance batch) ─────────────
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
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
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

const CONCURRENCY = 20;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const student_ids = sanitizeUUIDArray(body.student_ids);
    const subject_name = sanitizeString(body.subject_name);
    const subject_code = sanitizeString(body.subject_code);
    const notification_type = sanitizeString(body.notification_type) || "grade_update";

    if (student_ids.length === 0 || !subject_name) {
      return new Response(
        JSON.stringify({ error: "student_ids (array) and subject_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Batch-fetch all data in parallel ───────────────────────

    const [studentsRes, parentsRes] = await Promise.all([
      supabaseAdmin
        .from("students")
        .select("id, first_name, last_name, school_id")
        .in("id", student_ids),
      supabaseAdmin
        .from("parents")
        .select("student_id, guardian_name, fcm_push_token")
        .in("student_id", student_ids)
        .not("fcm_push_token", "is", null),
    ]);

    const students = studentsRes.data ?? [];
    const parents = parentsRes.data ?? [];

    const parentAccess = await getParentAccessMap(supabaseAdmin, student_ids);
    const disabledStudentIds = new Set(
      student_ids.filter((studentId) => parentAccess.get(studentId) !== true),
    );

    const staff = await authorizeStaffStudents(supabaseAdmin, authResult.user.id, student_ids);
    if (!staff) return staffAccessDenied(corsHeaders);

    const studentMap = new Map(students.map((s) => [s.id, s]));

    // Deduplicate parents: one token per student
    const parentMap = new Map<string, typeof parents[0]>();
    for (const p of parents) {
      if (!parentMap.has(p.student_id) && p.fcm_push_token?.trim()) {
        parentMap.set(p.student_id, p);
      }
    }

    // Get school info from first student
    const schoolId = students[0]?.school_id ?? null;
    let schoolName = "School";
    if (schoolId) {
      const { data: school } = await supabaseAdmin
        .from("schools")
        .select("name")
        .eq("id", schoolId)
        .single();
      schoolName = school?.name ?? "School";
    }

    // ── 2. Build parallel notification tasks ──────────────────────

    type NotifResult = {
      student_id: string;
      status: "delivered" | "failed" | "no_token" | "skipped" | "stale_token";
      error_message: string | null;
      latency_ms: number;
      fcm_token_preview: string | null;
    };

    const tasks = student_ids.map((sid) => async (): Promise<NotifResult> => {
      const start = Date.now();
      const student = studentMap.get(sid);
      const parent = parentMap.get(sid);

      if (disabledStudentIds.has(sid)) {
        return {
          student_id: sid,
          status: "skipped",
          error_message: "Parent notifications disabled by instructor",
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      if (!student) {
        return {
          student_id: sid,
          status: "failed",
          error_message: "Student not found",
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      const token = parent?.fcm_push_token?.trim();
      if (!token) {
        return {
          student_id: sid,
          status: "no_token",
          error_message: null,
          latency_ms: Date.now() - start,
          fcm_token_preview: null,
        };
      }

      const studentName = `${student.first_name} ${student.last_name}`;
      const subjectLabel = subject_code
        ? `${subject_name} (${subject_code})`
        : subject_name;

      const title = notification_type === "exam_score"
        ? `📊 Exam Score Updated`
        : `📊 Grades Updated`;
      const msgBody = notification_type === "exam_score"
        ? `${studentName}'s exam score for ${subjectLabel} has been recorded.`
        : `${studentName}'s grades for ${subjectLabel} have been updated.`;

      try {
        await sendFcmNotification({
          token,
          title,
          body: msgBody,
          data: {
            notification_type,
            student_id: sid,
            subject_name,
            subject_code: subject_code || "",
          },
        });

        return {
          student_id: sid,
          status: "delivered",
          error_message: null,
          latency_ms: Date.now() - start,
          fcm_token_preview: token.slice(-8),
        };
      } catch (err) {
        const staleToken = isStaleFcmTokenError(err);
        if (staleToken) {
          await supabaseAdmin.from("parents").update({ fcm_push_token: null }).eq("student_id", sid).eq("fcm_push_token", token);
        }
        return {
          student_id: sid,
          status: staleToken ? "stale_token" : "failed",
          error_message: staleToken ? "Device token expired. The parent must reopen the app to register a new token." : (err instanceof Error ? err.message : String(err)).slice(0, 500),
          latency_ms: Date.now() - start,
          fcm_token_preview: token.slice(-8),
        };
      }
    });

    // ── 3. Execute with concurrency limit ─────────────────────────

    const results = await parallelLimit(tasks, CONCURRENCY);

    // ── 4. Batch-insert notification logs (chunks of 500) ─────────

    const logRows = results.map((r) => ({
      school_id: schoolId,
      student_id: r.student_id,
      schedule_id: null,
      attendance_record_id: null,
      type: "grade_push",
      status: r.status,
      fcm_token_preview: r.fcm_token_preview,
      error_message: r.error_message,
      latency_ms: r.latency_ms,
    }));

    for (let i = 0; i < logRows.length; i += 500) {
      const batch = logRows.slice(i, i + 500);
      const { error: logErr } = await supabaseAdmin
        .from("notification_logs")
        .insert(batch);
      if (logErr) {
        console.error("[grade-notif] Log insert error:", logErr.message);
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
      total: student_ids.length,
      delivered,
      failed,
      no_token: noToken,
      skipped,
      stale_token: staleToken,
      wall_time_ms: totalMs,
      avg_latency_ms: results.length
        ? Math.round(results.reduce((a, b) => a + b.latency_ms, 0) / results.length)
        : 0,
    };

    console.log("[grade-notif] Summary:", JSON.stringify(summary));

    return new Response(
      JSON.stringify({ success: true, summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[grade-notif] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

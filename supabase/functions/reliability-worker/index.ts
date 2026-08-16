import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { processLearnerAssessmentPush } from "../_shared/assessmentNotification.ts";

function formatTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

async function processAttendanceJob(admin: any, job: any) {
  const attendanceId = job.payload?.attendance_record_id;
  const { data: record } = await admin
    .from("attendance_records")
    .select("id,student_id,schedule_id,status,date,student:students(first_name,last_name,school_id),schedule:schedules(time_start,time_end,section:sections(name),subject:subjects(name))")
    .eq("id", attendanceId)
    .maybeSingle();
  if (!record) throw new Error("Attendance record no longer exists");
  if (!(await isParentAccessEnabled(admin, record.student_id))) {
    throw new Error("Parent monthly access is inactive");
  }

  const { data: parent } = await admin
    .from("parents")
    .select("id,fcm_push_token")
    .eq("student_id", record.student_id)
    .not("fcm_push_token", "is", null)
    .limit(1)
    .maybeSingle();
  const token = parent?.fcm_push_token?.trim();
  if (!token) throw new Error("No registered parent device token");

  const student = Array.isArray(record.student) ? record.student[0] : record.student;
  const schedule = Array.isArray(record.schedule) ? record.schedule[0] : record.schedule;
  const subject = Array.isArray(schedule?.subject) ? schedule.subject[0] : schedule?.subject;
  const section = Array.isArray(schedule?.section) ? schedule.section[0] : schedule?.section;
  try {
    await sendFcmNotification({
      token,
      title: `${student?.first_name ?? "Student"} — Attendance update`,
      body: `${subject?.name ?? "Class"}: ${record.status} (${formatTime(schedule?.time_start ?? "00:00")}–${formatTime(schedule?.time_end ?? "00:00")})`,
      data: {
        notification_type: "attendance",
        student_id: record.student_id,
        schedule_id: record.schedule_id,
        attendance_record_id: record.id,
        section_name: section?.name ?? "",
      },
    });
  } catch (error) {
    if (isStaleFcmTokenError(error)) {
      await admin.from("parents").update({ fcm_push_token: null }).eq("id", parent.id).eq("fcm_push_token", token);
      const stale = new Error("Device token expired; parent must open the app to register a new token");
      (stale as any).staleToken = true;
      throw stale;
    }
    throw error;
  }

  await admin.from("notification_logs").insert({
    school_id: student?.school_id ?? job.school_id,
    student_id: record.student_id,
    schedule_id: record.schedule_id,
    attendance_record_id: record.id,
    type: "attendance_push",
    status: "delivered",
    latency_ms: 0,
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const expected = Deno.env.get("RELIABILITY_CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized scheduler" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: run } = await admin.from("maintenance_runs").insert({ job_name: "reliability-worker", status: "running" }).select("id").single();
  try {
    const { data: jobs, error: claimError } = await admin.rpc("claim_reliability_jobs", { p_limit: 20 });
    if (claimError) throw claimError;

    const results = await Promise.allSettled((jobs ?? []).map(async (job: any) => {
      try {
        if (job.job_type === "attendance_push_retry") {
          await processAttendanceJob(admin, job);
        } else if (job.job_type === "learner_assessment_push") {
          await processLearnerAssessmentPush(admin, job);
        } else {
          throw new Error(`Unsupported job type: ${job.job_type}`);
        }
        await admin.from("reliability_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stale = Boolean((error as any)?.staleToken);
        const exhausted = job.attempts >= job.max_attempts;
        await admin.from("reliability_jobs").update({
          status: stale || exhausted ? "cancelled" : "failed",
          last_error: message,
          next_attempt_at: stale || exhausted ? null : new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        throw error;
      }
    }));

    const [{ data: retention }, { data: cleanedRateLimits }] = await Promise.all([
      admin.rpc("execute_enabled_retention"),
      admin.rpc("cleanup_parent_auth_rate_limits"),
    ]);
    const failed = results.filter((result) => result.status === "rejected").length;
    const details = { claimed: results.length, completed: results.length - failed, failed, retention, cleaned_rate_limits: cleanedRateLimits };
    if (run?.id) await admin.from("maintenance_runs").update({ status: "completed", details, completed_at: new Date().toISOString() }).eq("id", run.id);
    return new Response(JSON.stringify(details), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run?.id) await admin.from("maintenance_runs").update({ status: "failed", details: { error: message }, completed_at: new Date().toISOString() }).eq("id", run.id);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

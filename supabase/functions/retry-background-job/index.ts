import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasAdminMfa, verifyAuth } from "../_shared/auth.ts";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { processLearnerAssessmentPush } from "../_shared/assessmentNotification.ts";

function fmtTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req);
  if (auth.error || !auth.user) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!hasAdminMfa(req)) return new Response(JSON.stringify({ error: "MFA verification is required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { job_id } = await req.json();
  const { data: profile } = await admin.from("users").select("role, school_id, is_platform_owner").eq("id", auth.user.id).single();
  const { data: job } = await admin.from("reliability_jobs").select("*").eq("id", job_id).single();

  if (!profile || !job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!(profile.role === "super_admin" && profile.is_platform_owner) && !(profile.role === "school_admin" && profile.school_id === job.school_id)) {
    return new Response(JSON.stringify({ error: "Not authorized to retry this job" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!['attendance_push_retry', 'learner_assessment_push'].includes(job.job_type)) return new Response(JSON.stringify({ error: "Unsupported retry job" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (job.attempts >= job.max_attempts) return new Response(JSON.stringify({ error: "Maximum retry attempts reached" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const attempt = job.attempts + 1;
  if (job.job_type === 'learner_assessment_push') {
    await admin.from("reliability_jobs").update({ status: "running", attempts: attempt, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    try {
      await processLearnerAssessmentPush(admin, job);
      await admin.from("reliability_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      const stale = Boolean((error as any)?.staleToken);
      await admin.from("reliability_jobs").update({ status: stale ? "cancelled" : "failed", last_error: message, next_attempt_at: stale ? null : new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ error: message }), { status: stale ? 410 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  let attemptedToken = "";
  let attemptedStudentId = "";
  await admin.from("reliability_jobs").update({ status: "running", attempts: attempt, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);

  try {
    const attendanceId = job.payload?.attendance_record_id;
    const { data: record } = await admin.from("attendance_records").select("id, student_id, schedule_id, status, date").eq("id", attendanceId).single();
    if (!record) throw new Error("Attendance record no longer exists");
    if (!(await isParentAccessEnabled(admin, record.student_id))) throw new Error("Parent monthly access is inactive");

    const [{ data: student }, { data: schedule }, { data: parent }] = await Promise.all([
      admin.from("students").select("id, first_name, last_name, school_id").eq("id", record.student_id).single(),
      admin.from("schedules").select("id, time_start, time_end, subject:subjects(name)").eq("id", record.schedule_id).single(),
      admin.from("parents").select("fcm_push_token").eq("student_id", record.student_id).not("fcm_push_token", "is", null).limit(1).maybeSingle(),
    ]);
    if (!student) throw new Error("Student not found");
    if (!parent?.fcm_push_token?.trim()) throw new Error("No parent push token registered");
    attemptedToken = parent.fcm_push_token.trim();
    attemptedStudentId = record.student_id;
    const { data: school } = await admin.from("schools").select("name").eq("id", student.school_id).single();
    const subject = (schedule as any)?.subject?.name ?? "a class";
    const time = schedule ? ` (${fmtTime(schedule.time_start)} – ${fmtTime(schedule.time_end)})` : "";
    const status = record.status.charAt(0).toUpperCase() + record.status.slice(1);

    await sendFcmNotification({
      token: parent.fcm_push_token.trim(),
      title: `📋 ${school?.name ?? "School"}`,
      body: `${student.first_name} ${student.last_name} was marked ${status} in ${subject}${time} on ${record.date}.`,
      data: { notification_type: "attendance", student_id: student.id, schedule_id: record.schedule_id, status: record.status, date: record.date },
    });

    await Promise.all([
      admin.from("reliability_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id),
      admin.from("notification_logs").update({ status: "delivered", error_message: null }).eq("id", job.payload?.notification_log_id),
    ]);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    if (attemptedToken && isStaleFcmTokenError(error)) {
      await Promise.all([
        admin.from("parents").update({ fcm_push_token: null }).eq("student_id", attemptedStudentId).eq("fcm_push_token", attemptedToken),
        admin.from("reliability_jobs").update({ status: "cancelled", last_error: "Device token expired. Waiting for the parent app to register a new token.", updated_at: new Date().toISOString() }).eq("id", job.id),
        admin.from("notification_logs").update({ status: "stale_token", error_message: "Device token expired. The parent must reopen the app to register a new token." }).eq("id", job.payload?.notification_log_id),
      ]);
      return new Response(JSON.stringify({ error: "Device token expired; retry cancelled until the app registers a new token." }), { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    await admin.from("reliability_jobs").update({ status: "failed", last_error: message, next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

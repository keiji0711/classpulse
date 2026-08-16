import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { authorizeAttendanceRecord, staffAccessDenied } from "../_shared/staffAuthorization.ts";

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

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

  try {
    const { record } = await req.json();
    const startedAt = Date.now();

    if (!record) {
      return new Response(JSON.stringify({ error: "No record provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const staff = await authorizeAttendanceRecord(supabaseAdmin, authResult.user.id, record);
    if (!staff) return staffAccessDenied(corsHeaders);

    // Get student info
    const { data: student } = await supabaseAdmin
      .from("students")
      .select("id, first_name, last_name, school_id")
      .eq("id", record.student_id)
      .single();

    if (!student) {
      return new Response(JSON.stringify({ error: "Student not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!(await isParentAccessEnabled(supabaseAdmin, record.student_id))) {
      await supabaseAdmin.from("notification_logs").insert({ school_id: student.school_id, student_id: student.id, schedule_id: record.schedule_id, attendance_record_id: record.id ?? null, type: "attendance_push", status: "skipped", error_message: "Parent monthly access is inactive", latency_ms: Date.now() - startedAt });
      return new Response(
        JSON.stringify({ success: true, delivered_via_push: false, notifications_disabled: true, message: "Parent access is inactive for the current billing month." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get school info
    const { data: school } = await supabaseAdmin
      .from("schools")
      .select("name")
      .eq("id", student.school_id)
      .single();

    // Get schedule + subject info
    const { data: schedule } = await supabaseAdmin
      .from("schedules")
      .select("*, subject:subjects(name)")
      .eq("id", record.schedule_id)
      .single();

    // Get parent's push token
    const { data: parents } = await supabaseAdmin
      .from("parents")
      .select("fcm_push_token, guardian_name")
      .eq("student_id", record.student_id)
      .not("fcm_push_token", "is", null)
      .limit(1);

    const parent = parents?.[0] ?? null;
    const destinationToken = parent?.fcm_push_token?.trim();

    if (!destinationToken) {
      await supabaseAdmin.from("notification_logs").insert({ school_id: student.school_id, student_id: student.id, schedule_id: record.schedule_id, attendance_record_id: record.id ?? null, type: "attendance_push", status: "no_token", latency_ms: Date.now() - startedAt });
      return new Response(
        JSON.stringify({ message: "No push token registered for parent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build notification message
    const statusText = record.status.charAt(0).toUpperCase() + record.status.slice(1);
    const subjectName = (schedule as any)?.subject?.name ?? "a class";
    const schoolName = school?.name ?? "School";
    const timeSched = schedule ? `${fmtTime(schedule.time_start)} – ${fmtTime(schedule.time_end)}` : "";
    const title = `📋 ${schoolName}`;
    const notifBody = `${student.first_name} ${student.last_name} was marked ${statusText} in ${subjectName}${timeSched ? ` (${timeSched})` : ""} on ${record.date}.`;

    const pushData = {
      notification_type: "attendance",
      student_id: student.id,
      schedule_id: record.schedule_id,
      status: record.status,
      date: record.date,
    };

    let pushResult: unknown;
    try {
      pushResult = await sendFcmNotification({
        token: destinationToken,
        title,
        body: notifBody,
        data: pushData,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const staleToken = isStaleFcmTokenError(error);
      console.error("Push error:", errorMessage);
      if (staleToken) await supabaseAdmin.from("parents").update({ fcm_push_token: null }).eq("student_id", student.id).eq("fcm_push_token", destinationToken);
      await supabaseAdmin.from("notification_logs").insert({ school_id: student.school_id, student_id: student.id, schedule_id: record.schedule_id, attendance_record_id: record.id ?? null, type: "attendance_push", status: staleToken ? "stale_token" : "failed", fcm_token_preview: destinationToken.slice(-8), error_message: staleToken ? "Device token expired. The parent must reopen the app to register a new token." : errorMessage.slice(0, 500), latency_ms: Date.now() - startedAt });
      return new Response(
        JSON.stringify({
          success: true,
          delivered_via_push: false,
          message: "Attendance saved, but push delivery failed.",
          details: errorMessage,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin.from("notification_logs").insert({ school_id: student.school_id, student_id: student.id, schedule_id: record.schedule_id, attendance_record_id: record.id ?? null, type: "attendance_push", status: "delivered", fcm_token_preview: destinationToken.slice(-8), latency_ms: Date.now() - startedAt });

    return new Response(
      JSON.stringify({ success: true, delivered_via_push: true, push_result: pushResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-push-notification error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

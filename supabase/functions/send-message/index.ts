import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { isValidUUID, sanitizeString } from "../_shared/validation.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { authorizeAttendanceRecord, staffAccessDenied } from "../_shared/staffAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
      status: 200,
    });
  }

  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const student_id = body.student_id;
    const schedule_id = body.schedule_id;
    const instructor_id = body.instructor_id;
    const message = sanitizeString(body.message);

    if (!isValidUUID(student_id) || !isValidUUID(schedule_id) || !message) {
      return new Response(
        JSON.stringify({ error: "Valid student_id, schedule_id (UUID), and message are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const staff = await authorizeAttendanceRecord(
      supabaseAdmin,
      authResult.user.id,
      { student_id, schedule_id },
    );
    if (!staff) return staffAccessDenied(corsHeaders);

    const { error: messageInsertError } = await supabaseAdmin
      .from("messages")
      .insert({
        student_id,
        schedule_id,
        instructor_id: staff.role === "instructor" ? staff.id : (instructor_id ?? null),
        content: message,
      });

    if (messageInsertError) {
      console.error("Error storing message:", messageInsertError);
      return new Response(
        JSON.stringify({ error: "Failed to save message" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!(await isParentAccessEnabled(supabaseAdmin, student_id))) {
      return new Response(
        JSON.stringify({
          success: true,
          delivered_via_push: false,
          notifications_disabled: true,
          message: "Message saved. Parent access is inactive for the current billing month.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(`[send-message] Querying parent for student_id: ${student_id}`);
    const { data: parents, error: parentError } = await supabaseAdmin
      .from("parents")
      .select("fcm_push_token, guardian_name")
      .eq("student_id", student_id)
      .not("fcm_push_token", "is", null)
      .limit(1);

    const parent = parents?.[0] ?? null;

    const { data: student } = await supabaseAdmin
      .from("students")
      .select("first_name, last_name")
      .eq("id", student_id)
      .single();

    // Fetch schedule details for navigation
    const { data: schedule } = await supabaseAdmin
      .from("schedules")
      .select("subject:subjects(id, name, code), instructor:users(full_name)")
      .eq("id", schedule_id)
      .single();

    const studentName = student
      ? `${student.first_name} ${student.last_name}`
      : "Your child";

    console.log(`[send-message] Parent data:`, parent ? { has_token: !!parent.fcm_push_token, token_length: parent.fcm_push_token?.length, guardian_name: parent.guardian_name } : "NO_PARENT_FOUND");
    const destinationToken = parent?.fcm_push_token?.trim();

    if (!destinationToken) {
      console.log(`[send-message] No FCM token for student_id ${student_id} - message saved but no push sent`);
      return new Response(
        JSON.stringify({
          success: true,
          delivered_via_push: false,
          message: "Message saved. Parent will see it in the app (no FCM token registered).",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    try {
      console.log(`[send-message] Sending push to token starting with: ${destinationToken.substring(0, 30)}...`);
      
      // Extract nested schedule/subject/instructor data (Supabase may return as arrays)
      const scheduleData = (schedule as any)?.subject ? Array.isArray((schedule as any).subject) ? (schedule as any).subject[0] : (schedule as any).subject : null;
      const instructorData = (schedule as any)?.instructor ? Array.isArray((schedule as any).instructor) ? (schedule as any).instructor[0] : (schedule as any).instructor : null;
      
      const pushPayload = {
        token: destinationToken,
        title: `Message about ${studentName}`,
        body: message,
        data: {
          student_id,
          schedule_id,
          subject_id: scheduleData?.id || "",
          subject_name: scheduleData?.name || "",
          subject_code: scheduleData?.code || "",
          instructor_name: instructorData?.full_name || "",
          notification_type: "subject_message",
        },
      };

      await sendFcmNotification(pushPayload);
      console.log("[send-message] Push sent successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isStaleFcmTokenError(error)) {
        await supabaseAdmin.from("parents").update({ fcm_push_token: null }).eq("student_id", student_id).eq("fcm_push_token", destinationToken);
      }
      console.error("[send-message] FCM push error:", errorMessage);
      return new Response(
        JSON.stringify({
          success: true,
          delivered_via_push: false,
          message: "Message saved in the app, but push delivery failed.",
          details: errorMessage,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[send-message] FCM delivery confirmed to ${parent.guardian_name || "parent"}`);
    return new Response(
      JSON.stringify({
        success: true,
        delivered_via_push: true,
        message: `Message sent to ${parent.guardian_name || "parent"}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

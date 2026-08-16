import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendFcmNotification } from "../_shared/fcm.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { authorizeStaffStudents, staffAccessDenied } from "../_shared/staffAuthorization.ts";

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
    const { student_id } = await req.json();

    if (!student_id || !isValidUUID(student_id)) {
      return new Response(
        JSON.stringify({ error: "Valid student_id (UUID) is required" }),
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

    const staff = await authorizeStaffStudents(supabaseAdmin, authResult.user.id, [student_id]);
    if (!staff) return staffAccessDenied(corsHeaders);

    const { data: student, error: studentError } = await supabaseAdmin
      .from("students")
      .select("id, first_name, last_name")
      .eq("id", student_id)
      .single();

    if (studentError || !student) {
      return new Response(
        JSON.stringify({ error: "Student not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: parents } = await supabaseAdmin
      .from("parents")
      .select("guardian_name, fcm_push_token")
      .eq("student_id", student_id)
      .not("fcm_push_token", "is", null)
      .limit(1);

    const parent = parents?.[0] ?? null;
    const destinationToken = parent?.fcm_push_token?.trim();

    if (!destinationToken) {
      return new Response(
        JSON.stringify({ error: "No FCM token registered yet for this account" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    try {
      const pushPayload = {
        token: destinationToken,
        title: "ClassPulse Test Notification",
        body: `Push is working for ${student.first_name} ${student.last_name}.`,
        data: {
          notification_type: "test_push",
          student_id: student.id,
        },
      };

      let pushResult: unknown;
      pushResult = await sendFcmNotification(pushPayload);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Test push sent to ${parent?.guardian_name || "parent"}`,
          push_result: pushResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return new Response(
        JSON.stringify({
          error: errorMessage,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { accessDenied, authorizeParentStudent } from "../_shared/parentAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
      status: 200,
    });
  }

  // Verify JWT authentication
  const authHeader = req.headers.get("authorization") ?? "";
  const jwtToken = authHeader.replace(/^Bearer\s+/i, "");
  const jwtPayload = await verifyJwt(jwtToken);
  if (!jwtPayload) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { student_id, fcm_push_token, push_token, expo_push_token } = await req.json();
    const tokenCandidate = fcm_push_token ?? push_token ?? expo_push_token;
    const resolvedToken = typeof tokenCandidate === "string" ? tokenCandidate.trim() : "";

    if (!student_id || !isValidUUID(student_id) || !resolvedToken) {
      return new Response(
        JSON.stringify({ error: "Valid student_id (UUID) and fcm_push_token are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Registering push token for student: ${student_id}`);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const relationship = await authorizeParentStudent(supabaseAdmin, jwtPayload, student_id);
    if (!relationship) return accessDenied(corsHeaders);

    const { error } = await supabaseAdmin
      .from("parents")
      .update({ fcm_push_token: resolvedToken })
      .eq("id", relationship.parentId)
      .eq("student_id", student_id)
      .eq("school_id", relationship.schoolId);

    if (error) {
      console.error("Error updating parent push token:", error);
      return new Response(
        JSON.stringify({ error: "Failed to update parent record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully registered push token for student: ${student_id}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error in update-push-token:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

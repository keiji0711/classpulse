import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { accessDenied, authorizeParentStudent } from "../_shared/parentAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const payload = await verifyJwt(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { student_id } = await req.json();
  if (!isValidUUID(student_id)) {
    return new Response(JSON.stringify({ error: "Access denied" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const relationship = await authorizeParentStudent(supabaseAdmin, payload, student_id);
  if (!relationship) return accessDenied(corsHeaders);
  const access_enabled = await isParentAccessEnabled(supabaseAdmin, student_id);

  const { data: parent } = await supabaseAdmin
    .from("parents")
    .select("id, guardian_name, email, phone_number")
    .eq("id", relationship.parentId)
    .eq("school_id", relationship.schoolId)
    .maybeSingle();

  const { data: school } = await supabaseAdmin
    .from("schools")
    .select("id, name, logo_url")
    .eq("id", relationship.schoolId)
    .maybeSingle();

  return new Response(JSON.stringify({
    access_enabled,
    billing_app_user_id: `family:${relationship.familyId}`,
    parent: parent ?? null,
    school: school ?? null,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

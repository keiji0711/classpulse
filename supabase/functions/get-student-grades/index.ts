import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { accessDenied, authorizeParentStudent } from "../_shared/parentAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    const { student_id, school_id } = await req.json();

    if (!student_id || !isValidUUID(student_id)) {
      return new Response(
        JSON.stringify({ error: "Valid student_id (UUID) is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (school_id && !isValidUUID(school_id)) {
      return new Response(
        JSON.stringify({ error: "Invalid school_id format" }),
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

    const relationship = await authorizeParentStudent(
      supabaseAdmin,
      jwtPayload,
      student_id,
      school_id,
    );
    if (!relationship) return accessDenied(corsHeaders);

    if (!(await isParentAccessEnabled(supabaseAdmin, student_id))) {
      return new Response(JSON.stringify({ error: "Parent access is disabled" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the current academic year for the student's school
    let academicYearId: string | null = null;
    if (relationship.schoolId) {
      const { data: yearRow } = await supabaseAdmin
        .from("academic_years")
        .select("id")
        .eq("school_id", relationship.schoolId)
        .eq("is_current", true)
        .single();
      academicYearId = yearRow?.id ?? null;
    }

    let query = supabaseAdmin
      .from("grades")
      .select("*, subject:subjects(name, code)")
      .eq("student_id", student_id)
      .lte("quarter", 3);

    if (academicYearId) {
      query = query.eq("academic_year_id", academicYearId);
    }

    const { data, error } = await query
      .order("subject_id")
      .order("quarter");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ grades: data ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

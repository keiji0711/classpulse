import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { accessDenied, authorizeParentStudent } from "../_shared/parentAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwtToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const jwtPayload = await verifyJwt(jwtToken);
  if (!jwtPayload) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: jsonHeaders });
  }

  try {
    const { student_id, school_id } = await req.json();
    if (!student_id || !isValidUUID(student_id)) {
      return new Response(JSON.stringify({ error: "Valid student_id (UUID) is required" }), { status: 400, headers: jsonHeaders });
    }
    if (school_id && !isValidUUID(school_id)) {
      return new Response(JSON.stringify({ error: "Invalid school_id format" }), { status: 400, headers: jsonHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const relationship = await authorizeParentStudent(supabaseAdmin, jwtPayload, student_id, school_id);
    if (!relationship) return accessDenied(corsHeaders);
    if (!(await isParentAccessEnabled(supabaseAdmin, student_id))) {
      return new Response(JSON.stringify({ error: "Parent access is disabled" }), { status: 403, headers: jsonHeaders });
    }

    const { data: year } = await supabaseAdmin
      .from("academic_years")
      .select("id, name")
      .eq("school_id", relationship.schoolId)
      .eq("is_current", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!year) {
      return new Response(JSON.stringify({ academic_year: null, assessments: [] }), { status: 200, headers: jsonHeaders });
    }

    // Deliberately exclude nutritional measurements, z-scores, date of birth,
    // sex, internal details, and assessor identity from the family response.
    const { data, error } = await supabaseAdmin
      .from("learner_assessments")
      .select("id,assessment_period,domain,instrument,instrument_version,language,classification,secondary_classification,raw_score,total_items,assessment_date,notes,updated_at")
      .eq("school_id", relationship.schoolId)
      .eq("student_id", student_id)
      .eq("academic_year_id", year.id)
      .order("assessment_date", { ascending: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ academic_year: year, assessments: data ?? [] }), { status: 200, headers: jsonHeaders });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: jsonHeaders });
  }
});

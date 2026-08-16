import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID, sanitizeString, clampNumber } from "../_shared/validation.ts";
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
    const { student_id, limit, offset, status, school_id } = await req.json();
    const effectiveLimit = clampNumber(limit, 1, 200, 50);
    const effectiveOffset = clampNumber(offset, 0, 100000, 0);

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

    const sanitizedStatus = status ? sanitizeString(status) : null;

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

    // Resolve the student's current advisory section so the parent app can
    // always display a permanent adviser conversation, even before the first
    // announcement is sent.
    let adviserChannel: {
      section_id: string;
      section_name: string;
      grade_level: string;
      adviser_id: string | null;
      adviser_name: string;
    } | null = null;

    let advisorySection: any = null;
    if (academicYearId) {
      const { data: enrollment } = await supabaseAdmin
        .from("student_enrollments")
        .select("section:sections(id, name, grade_level, adviser:users(id, full_name))")
        .eq("student_id", student_id)
        .eq("academic_year_id", academicYearId)
        .limit(1)
        .maybeSingle();
      advisorySection = Array.isArray(enrollment?.section)
        ? enrollment.section[0] ?? null
        : enrollment?.section ?? null;
    }

    if (!advisorySection) {
      const { data: studentSection } = await supabaseAdmin
        .from("students")
        .select("section:sections(id, name, grade_level, adviser:users(id, full_name))")
        .eq("id", student_id)
        .maybeSingle();
      advisorySection = Array.isArray(studentSection?.section)
        ? studentSection.section[0] ?? null
        : studentSection?.section ?? null;
    }

    if (advisorySection) {
      const adviser = Array.isArray(advisorySection.adviser)
        ? advisorySection.adviser[0] ?? null
        : advisorySection.adviser ?? null;
      adviserChannel = {
        section_id: advisorySection.id,
        section_name: advisorySection.name ?? "",
        grade_level: advisorySection.grade_level ?? "",
        adviser_id: adviser?.id ?? null,
        adviser_name: adviser?.full_name ?? "School Adviser",
      };
    }

    const attendanceSelect = academicYearId
      ? "*, schedule:schedules!inner(*, subject:subjects(*), section:sections(*), instructor:users(full_name))"
      : "*, schedule:schedules(*, subject:subjects(*), section:sections(*), instructor:users(full_name))";

    let attendanceQuery = supabaseAdmin
      .from("attendance_records")
      .select(attendanceSelect)
      .eq("student_id", student_id)
      .order("date", { ascending: false })
      .order("recorded_at", { ascending: false });

    if (academicYearId) {
      attendanceQuery = attendanceQuery.eq("schedule.academic_year_id", academicYearId);
    }

    if (sanitizedStatus && sanitizedStatus !== "all") {
      attendanceQuery = attendanceQuery.eq("status", sanitizedStatus);
    }

    attendanceQuery = attendanceQuery.range(effectiveOffset, effectiveOffset + effectiveLimit - 1);

    const messagesSelect =
      "*, schedule:schedules(*, subject:subjects(*), section:sections(*)), section:sections(*), instructor:users(full_name)";

    let messagesQuery = supabaseAdmin
      .from("messages")
      .select(messagesSelect)
      .eq("student_id", student_id)
      .order("created_at", { ascending: false })
      .range(effectiveOffset, effectiveOffset + effectiveLimit - 1);

    if (academicYearId) {
      messagesQuery = messagesQuery.or(
        `academic_year_id.eq.${academicYearId},academic_year_id.is.null`,
      );
    }

    const [attendanceResult, messagesResult] = await Promise.all([
      attendanceQuery,
      messagesQuery,
    ]);

    const { data: records, error: attendanceError } = attendanceResult;
    const { data: messages, error: messagesError } = messagesResult;

    if (attendanceError || messagesError) {
      return new Response(JSON.stringify({
        error: attendanceError?.message ?? messagesError?.message ?? "Failed to load feed",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      records: records ?? [],
      messages: messages ?? [],
      adviser_channel: adviserChannel,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

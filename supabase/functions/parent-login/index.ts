import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sanitizeString, isValidUUID } from "../_shared/validation.ts";
import { signJwt } from "../_shared/jwt.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";
import { clearParentLoginAttempts, consumeParentLoginAttempt } from "../_shared/rateLimit.ts";

const INVALID_CREDENTIALS = "Invalid school, LRN, or PIN";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const school_id = body.school_id;
    const school_name = sanitizeString(body.school_name);
    const lrn = sanitizeString(body.lrn);
    const pin = body.pin;

    if ((!school_id && !school_name) || !lrn) {
      return new Response(
        JSON.stringify({ error: "school_id (or school_name) and lrn are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const accountKey = `account:${school_id || school_name}:${lrn}`;
    const clientAddress = req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
    const ipKey = `ip:${clientAddress}`;
    const [accountLimit, ipLimit] = await Promise.all([
      consumeParentLoginAttempt(supabaseAdmin, accountKey),
      consumeParentLoginAttempt(supabaseAdmin, ipKey),
    ]);
    if (!accountLimit.allowed || !ipLimit.allowed) {
      const retryAfter = Math.max(accountLimit.retryAfterSeconds, ipLimit.retryAfterSeconds, 1);
      return new Response(
        JSON.stringify({ error: "Too many login attempts. Please try again later." }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    // Find school by id (preferred) or fall back to name search
    let school: { id: string; name: string; logo_url: string | null; operational_status: string } | null = null;
    if (school_id) {
      const { data, error } = await supabaseAdmin
        .from("schools")
        .select("id, name, logo_url, operational_status")
        .eq("id", school_id)
        .single();
      if (!error && data) school = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("schools")
        .select("id, name, logo_url, operational_status")
        .ilike("name", school_name)
        .single();
      if (!error && data) school = data;
    }

    if (!school || ["inactive", "suspended", "archived"].includes(school.operational_status)) {
      return new Response(
        JSON.stringify({ error: INVALID_CREDENTIALS }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find student by LRN in that school
    const { data: student, error: studentError } = await supabaseAdmin
      .from("students")
      .select("id, first_name, last_name, lrn, section_id")
      .eq("school_id", school.id)
      .eq("lrn", lrn)
      .single();

    if (studentError || !student) {
      return new Response(
        JSON.stringify({ error: INVALID_CREDENTIALS }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find parent linked to this student
    const { data: parent } = await supabaseAdmin
      .from("parents")
      .select("id, guardian_name, email, phone_number, pin_hash, family_id")
      .eq("student_id", student.id)
      .eq("school_id", school.id)
      .maybeSingle();

    if (!parent) {
      return new Response(JSON.stringify({ error: INVALID_CREDENTIALS }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PIN verification
    const hasPin = parent.pin_hash != null;
    if (hasPin) {
      if (!pin) {
        // Parent has a PIN set but none was provided – tell the client
        return new Response(
          JSON.stringify({ error: "pin_required", needs_pin: true }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const pinValid = bcrypt.compareSync(String(pin), parent.pin_hash!);
      if (!pinValid) {
        return new Response(
          JSON.stringify({ error: INVALID_CREDENTIALS }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      if (!pin) {
        return new Response(
          JSON.stringify({ error: "pin_required", activation_required: true }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const phoneDigits = String(parent.phone_number ?? "").replace(/\D/g, "");
      const activationCode = phoneDigits.slice(-4);
      if (activationCode.length !== 4 || String(pin) !== activationCode) {
        return new Response(JSON.stringify({ error: INVALID_CREDENTIALS }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Sign a real JWT that the Supabase gateway will accept
    const sevenDays = 7 * 24 * 60 * 60;
    let token: string;
    try {
      token = await signJwt(
        {
          sub: parent.id,
          parent_id: parent.id,
          student_id: student.id,
          school_id: school.id,
          session_version: 1,
        },
        sevenDays
      );
    } catch (jwtErr) {
      console.error("[parent-login] JWT signing failed:", jwtErr);
      return new Response(
        JSON.stringify({ error: "Authentication service error", detail: String(jwtErr) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const expiresAt = new Date(Date.now() + sevenDays * 1000).toISOString();
    const accessEnabled = await isParentAccessEnabled(supabaseAdmin, student.id);

    // Find sibling students: other children linked to the same guardian in this school
    let siblings: Array<{ id: string; first_name: string; last_name: string; lrn: string }> = [];
    if (parent.family_id) {
      const { data: siblingParents } = await supabaseAdmin
        .from("parents")
        .select("student_id, students:student_id(id, first_name, last_name, lrn)")
        .eq("school_id", school.id)
        .eq("family_id", parent.family_id)
        .neq("student_id", student.id);

      if (siblingParents) {
        siblings = siblingParents
          .map((sp: any) => {
            const s = Array.isArray(sp.students) ? sp.students[0] : sp.students;
            return s ? { id: s.id, first_name: s.first_name, last_name: s.last_name, lrn: s.lrn } : null;
          })
          .filter(Boolean) as typeof siblings;
      }
    }

    await Promise.all([
      clearParentLoginAttempts(supabaseAdmin, accountKey),
      clearParentLoginAttempts(supabaseAdmin, ipKey),
    ]);

    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt,
        has_pin: hasPin,
        student: {
          id: student.id,
          first_name: student.first_name,
          last_name: student.last_name,
          lrn: student.lrn,
        },
        school: {
          id: school.id,
          name: school.name,
          logo_url: school.logo_url,
        },
        parent: { id: parent.id, guardian_name: parent.guardian_name, email: parent.email ?? null, phone_number: parent.phone_number ?? '' },
        siblings,
        access_enabled: accessEnabled,
        billing_app_user_id: `family:${parent.family_id}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[parent-login] Error:", message);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

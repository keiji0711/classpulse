import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID, isValidPhone } from "../_shared/validation.ts";
import { accessDenied, authorizeParentRecord } from "../_shared/parentAuthorization.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
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
    const { parent_id, email, phone_number } = await req.json();

    if (!parent_id || !isValidUUID(parent_id)) {
      return new Response(
        JSON.stringify({ error: "Valid parent_id (UUID) is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Basic email validation if provided
    if (email && typeof email === "string" && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const relationship = await authorizeParentRecord(supabaseAdmin, jwtPayload, parent_id);
    if (!relationship) return accessDenied(corsHeaders);

    // Build update object with only provided fields
    const updates: Record<string, string> = {};
    if (typeof email === "string") {
      updates.email = email.trim();
    }
    if (typeof phone_number === "string" && phone_number.trim()) {
      if (!isValidPhone(phone_number)) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number format" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      updates.phone_number = phone_number.trim();
    }

    if (Object.keys(updates).length === 0) {
      return new Response(
        JSON.stringify({ error: "No fields to update" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("parents")
      .update(updates)
      .eq("id", parent_id)
      .eq("school_id", relationship.schoolId)
      .select("id, guardian_name, email, phone_number")
      .single();

    if (error) {
      console.error("Error updating parent contact:", error);
      return new Response(
        JSON.stringify({ error: "Failed to update contact info" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, parent: data }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("save-parent-contact error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { accessDenied, authorizeParentRecord } from "../_shared/parentAuthorization.ts";
import { clearParentLoginAttempts, consumeParentLoginAttempt } from "../_shared/rateLimit.ts";

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
    const { parent_id, pin, current_pin } = await req.json();

    if (!parent_id || !isValidUUID(parent_id) || !pin) {
      return new Response(
        JSON.stringify({ error: "Valid parent_id (UUID) and pin are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate PIN format: exactly 4 digits
    if (!/^\d{4}$/.test(String(pin))) {
      return new Response(
        JSON.stringify({ error: "PIN must be exactly 4 digits" }),
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

    const pinLimitKey = `pin-change:${parent_id}`;
    const pinLimit = await consumeParentLoginAttempt(supabaseAdmin, pinLimitKey);
    if (!pinLimit.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Please try again later." }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(Math.max(pinLimit.retryAfterSeconds, 1)),
          },
        },
      );
    }

    const relationship = await authorizeParentRecord(supabaseAdmin, jwtPayload, parent_id);
    if (!relationship) return accessDenied(corsHeaders);

    // Fetch current parent record
    const { data: parent, error: parentError } = await supabaseAdmin
      .from("parents")
      .select("id, pin_hash")
      .eq("id", parent_id)
      .eq("school_id", relationship.schoolId)
      .single();

    if (parentError || !parent) {
      return new Response(
        JSON.stringify({ error: "Parent not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If parent already has a PIN, require current_pin to change it
    if (parent.pin_hash) {
      if (!current_pin) {
        return new Response(
          JSON.stringify({ error: "Current PIN is required to change your PIN" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      const valid = bcrypt.compareSync(String(current_pin), parent.pin_hash);
      if (!valid) {
        return new Response(
          JSON.stringify({ error: "Current PIN is incorrect" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Hash and save the new PIN (sync — async uses Workers unavailable in Deno Deploy)
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(String(pin), salt);

    const { error: updateError } = await supabaseAdmin
      .from("parents")
      .update({ pin_hash: hash })
      .eq("id", parent_id)
      .eq("school_id", relationship.schoolId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to save PIN" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await clearParentLoginAttempts(supabaseAdmin, pinLimitKey);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

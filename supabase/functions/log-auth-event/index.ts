import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sha256 } from "../_shared/rateLimit.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 320) : "";
    const success = body.success === true;
    const failureReason = typeof body.failure_reason === "string" ? body.failure_reason.slice(0, 500) : null;
    if (!email) return new Response(JSON.stringify({ error: "Email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
    const rateKey = await sha256(`auth-telemetry:${forwarded}`);
    const { data: limitRows, error: limitError } = await admin.rpc("consume_parent_auth_attempt", {
      p_key_hash: rateKey,
      p_max_attempts: 30,
      p_window_seconds: 300,
      p_block_seconds: 900,
    });
    const limit = Array.isArray(limitRows) ? limitRows[0] : limitRows;
    if (limitError || limit?.allowed !== true) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(limit?.retry_after_seconds ?? 60) },
      });
    }

    // A successful event is accepted only when the verified Supabase session
    // belongs to the submitted email. Failed attempts remain explicitly marked
    // as client telemetry; authoritative Auth logs live in Supabase Auth.
    if (success) {
      const authHeader = req.headers.get("authorization") ?? "";
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user?.email || user.email.toLowerCase() !== email) {
        return new Response(JSON.stringify({ error: "Verified session does not match event" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: profile } = await admin.from("users").select("id, school_id").eq("email", email).maybeSingle();

    await admin.from("security_login_events").insert({
      user_id: profile?.id ?? null,
      school_id: profile?.school_id ?? null,
      email,
      success,
      failure_reason: success ? null : failureReason,
      ip_address: forwarded === "unknown" ? null : forwarded,
      user_agent: req.headers.get("user-agent")?.slice(0, 1000) ?? null,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch {
    // Authentication must never fail merely because telemetry is unavailable.
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

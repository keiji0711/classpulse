import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accessDenied, authorizeParentRecord } from "../_shared/parentAuthorization.ts";
import { verifyJwt as verifyParentJwt } from "../_shared/jwt.ts";

// ─── Inlined CORS ─────────────────────────────────────────────────────
const ALLOWED_ORIGINS: string[] = [
  "https://classpulse101.netlify.app",
  "https://classpulse.pages.dev",
  "http://localhost:5173",
  "http://localhost:3000",
  "capacitor://localhost",
  "http://localhost",
];
function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, paymongo-signature",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

// ─── Handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwtToken = authHeader.replace(/^Bearer\s+/i, "");
  const jwt = await verifyParentJwt(jwtToken);
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parentId = (jwt.parent_id as string | null) ?? null;
  if (!parentId) {
    return new Response(JSON.stringify({ error: "Parent context required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const relationship = await authorizeParentRecord(admin, jwt, parentId);
  if (!relationship) return accessDenied(corsHeaders);

  const { data: thread } = await admin
    .from("support_threads")
    .select("*")
    .eq("parent_id", parentId)
    .eq("school_id", relationship.schoolId)
    .maybeSingle();

  if (!thread) {
    return new Response(
      JSON.stringify({ thread: null, messages: [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: messages } = await admin
    .from("support_messages")
    .select("id, sender_role, sender_name, content, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });

  if (thread.unread_for_user) {
    await admin
      .from("support_threads")
      .update({ unread_for_user: false })
      .eq("id", thread.id);
  }

  return new Response(
    JSON.stringify({ thread, messages: messages ?? [] }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

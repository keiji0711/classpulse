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

  let body: { content?: string; sender_name?: string; sender_email?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const content = (body.content ?? "").trim();
  if (!content) {
    return new Response(JSON.stringify({ error: "Message content required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (content.length > 2000) {
    return new Response(JSON.stringify({ error: "Message too long (max 2000)" }), {
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
  const schoolId = relationship.schoolId;

  const { data: parentRow } = await admin
    .from("parents")
    .select("guardian_name, email")
    .eq("id", parentId)
    .eq("school_id", schoolId)
    .maybeSingle();

  const senderName =
    (typeof body.sender_name === "string" && body.sender_name.trim()) ||
    parentRow?.guardian_name ||
    "Parent";
  const senderEmail =
    (typeof body.sender_email === "string" && body.sender_email.trim()) ||
    parentRow?.email ||
    null;

  let { data: thread } = await admin
    .from("support_threads")
    .select("*")
    .eq("parent_id", parentId)
    .maybeSingle();

  const preview = content.slice(0, 140);
  const now = new Date().toISOString();

  if (!thread) {
    const { data: created, error: createErr } = await admin
      .from("support_threads")
      .insert({
        parent_id: parentId,
        school_id: schoolId,
        sender_role: "parent",
        sender_name: senderName,
        sender_email: senderEmail,
        unread_for_admin: true,
        unread_for_user: false,
        last_message_at: now,
        last_message_preview: preview,
      })
      .select("*")
      .single();
    if (createErr) {
      console.error("[support-send-message] thread create error:", createErr);
      return new Response(JSON.stringify({ error: "Failed to create thread" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    thread = created;
  } else {
    await admin
      .from("support_threads")
      .update({
        last_message_at: now,
        last_message_preview: preview,
        unread_for_admin: true,
        status: "open",
      })
      .eq("id", thread.id);
  }

  const { data: message, error: msgErr } = await admin
    .from("support_messages")
    .insert({
      thread_id: thread!.id,
      sender_role: "parent",
      sender_name: senderName,
      content,
    })
    .select("id, sender_role, sender_name, content, created_at")
    .single();

  if (msgErr) {
    console.error("[support-send-message] message insert error:", msgErr);
    return new Response(JSON.stringify({ error: "Failed to send message" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ thread, message }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

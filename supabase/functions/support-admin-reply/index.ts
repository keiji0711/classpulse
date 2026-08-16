import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminMfa } from "../_shared/auth.ts";

// Self-contained (no ../_shared imports) so it bundles standalone, matching
// support-send-message. Super-admin replies to a support thread: inserts the
// message + updates the thread (service role), then pushes an FCM notification
// to the parent. Instructors don't register push tokens, so their threads skip
// the push (the message is still delivered in-app).

// ─── CORS ─────────────────────────────────────────────────────────────
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
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

// ─── FCM (HTTP v1, service account) ───────────────────────────────────
const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cachedAccessToken = "";
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount: { project_id: string; client_email: string; private_key: string } | null = null;

function getServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;
  const b64 = Deno.env.get("FCM_SERVICE_ACCOUNT_B64") || "";
  if (!b64) throw new Error("Missing FCM_SERVICE_ACCOUNT_B64 secret");
  const parsed = JSON.parse(atob(b64));
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM service account JSON missing required fields");
  }
  cachedServiceAccount = {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key,
  };
  return cachedServiceAccount;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const base64 = typeof input === "string" ? btoa(input) : btoa(String.fromCharCode(...input));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8ArrayBuffer(pem: string): ArrayBuffer {
  const normalizedPem = pem.replace(/\\n/g, "\n").trim();
  const keyBase64 = normalizedPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const raw = atob(keyBase64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function createSignedJwt(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8ArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(): Promise<string> {
  const nowMs = Date.now();
  if (cachedAccessToken && nowMs < cachedAccessTokenExpiryMs - 60_000) return cachedAccessToken;
  const sa = getServiceAccount();
  const assertion = await createSignedJwt(sa.client_email, sa.private_key);
  const tokenResponse = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const tokenResult = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenResult?.access_token) {
    const details = tokenResult?.error_description || tokenResult?.error || "unknown error";
    throw new Error(`Failed to get FCM access token: ${details}`);
  }
  cachedAccessToken = tokenResult.access_token;
  cachedAccessTokenExpiryMs = nowMs + Number(tokenResult.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

async function sendFcmNotification(payload: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  const sa = getServiceAccount();
  if (!payload.token?.trim()) throw new Error("Missing destination FCM token");
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: payload.token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: {
            priority: "high",
            notification: { channel_id: "classpulse-sound-v2", sound: "default" },
          },
        },
      }),
    }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const details = result?.error?.message || result?.error?.status || JSON.stringify(result || {});
    throw new Error(`FCM send failed: ${details}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const json = (payload: unknown, status: number) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Authenticate the caller via their Supabase Auth session (web dashboard).
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Missing authorization header" }, 401);

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error: authError,
  } = await anon.auth.getUser();
  if (authError || !user) return json({ error: "Invalid or expired token" }, 401);
  if (!hasAdminMfa(req)) return json({ error: "MFA verification is required" }, 403);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Only super admins may reply.
  const { data: caller } = await admin
    .from("users")
    .select("full_name, role, is_platform_owner, permissions")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller || caller.role !== "super_admin" || (!caller.is_platform_owner && !caller.permissions?.includes("support"))) {
    return json({ error: "Support permission is required" }, 403);
  }

  let body: { thread_id?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const threadId = (body.thread_id ?? "").trim();
  const content = (body.content ?? "").trim();
  if (!threadId || !content) return json({ error: "thread_id and content are required" }, 400);
  if (content.length > 2000) return json({ error: "Message too long (max 2000)" }, 400);

  const { data: thread } = await admin
    .from("support_threads")
    .select("id, parent_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return json({ error: "Thread not found" }, 404);

  const senderName = caller.full_name || "ClassPulse Team";
  const now = new Date().toISOString();

  const { data: message, error: msgErr } = await admin
    .from("support_messages")
    .insert({
      thread_id: threadId,
      sender_role: "super_admin",
      sender_name: senderName,
      content,
    })
    .select("id, sender_role, sender_name, content, created_at")
    .single();
  if (msgErr) {
    console.error("[support-admin-reply] message insert error:", msgErr);
    return json({ error: "Failed to send reply" }, 500);
  }

  await admin
    .from("support_threads")
    .update({
      last_message_at: now,
      last_message_preview: content.slice(0, 140),
      unread_for_admin: false,
      unread_for_user: true,
    })
    .eq("id", threadId);

  // Push to the parent (only parents register FCM tokens).
  let delivered_via_push = false;
  if (thread.parent_id) {
    const { data: parent } = await admin
      .from("parents")
      .select("fcm_push_token")
      .eq("id", thread.parent_id)
      .maybeSingle();
    const token = parent?.fcm_push_token?.trim();
    if (token) {
      try {
        await sendFcmNotification({
          token,
          title: "ClassPulse Support",
          body: content,
          data: { thread_id: threadId, notification_type: "support_reply" },
        });
        delivered_via_push = true;
      } catch (err) {
        console.error("[support-admin-reply] push error:", err);
      }
    }
  }

  // Audit trail (best-effort; never blocks the reply).
  try {
    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_name: caller.full_name,
      actor_email: user.email,
      action: "support.reply",
      target_type: "support_thread",
      target_id: threadId,
      target_label: content.slice(0, 80),
      details: { delivered_via_push },
    });
  } catch (err) {
    console.error("[support-admin-reply] audit log failed:", err);
  }

  return json({ message, delivered_via_push }, 200);
});

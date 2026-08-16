import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasAdminMfa } from "../_shared/auth.ts";

// Self-contained (no ../_shared imports). Platform-owner-only management of
// super-admin staff accounts and their module permissions.

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

const VALID_PERMS = ["schools", "operations", "school_admins", "support", "staff", "audit"];

// deno-lint-ignore no-explicit-any
async function logAudit(admin: any, entry: {
  actor_id: string; actor_name?: string; actor_email?: string;
  action: string; target_type?: string; target_id?: string; target_label?: string;
  details?: Record<string, unknown>;
}) {
  try {
    await admin.from("admin_audit_log").insert(entry);
  } catch (err) {
    console.error("[manage-staff] audit log failed:", err);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders, status: 200 });

  const json = (payload: unknown, status: number) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "Missing authorization header" }, 401);

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Invalid or expired token" }, 401);
  if (!hasAdminMfa(req)) return json({ error: "MFA verification is required" }, 403);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Caller must be a platform owner.
  const { data: caller } = await admin
    .from("users")
    .select("role, is_platform_owner, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller || caller.role !== "super_admin" || caller.is_platform_owner !== true) {
    return json({ error: "Only platform owners can manage staff" }, 403);
  }
  const actor = { actor_id: user.id, actor_name: caller.full_name, actor_email: caller.email };

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const sanitizePerms = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((p): p is string => typeof p === "string" && VALID_PERMS.includes(p)) : [];

  // ── Create staff ──────────────────────────────────────────────────────
  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const permissions = sanitizePerms(body.permissions);

    if (!email || !password || !fullName) return json({ error: "Email, password and full name are required" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) return json({ error: "That email is already in use" }, 409);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "Failed to create account" }, 400);

    const { error: insertErr } = await admin.from("users").insert({
      id: created.user.id,
      email,
      role: "super_admin",
      school_id: null,
      full_name: fullName,
      phone_number: "",
      address: "",
      permissions,
      is_platform_owner: false,
    });
    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }
    await logAudit(admin, {
      ...actor, action: "staff.create", target_type: "staff",
      target_id: created.user.id, target_label: `${fullName} (${email})`,
      details: { permissions },
    });
    return json({ id: created.user.id }, 200);
  }

  // ── Update a staff member's permissions ───────────────────────────────
  if (action === "update") {
    const userId = String(body.user_id ?? "");
    const permissions = sanitizePerms(body.permissions);
    if (!userId) return json({ error: "user_id is required" }, 400);
    if (userId === user.id) return json({ error: "You cannot edit your own permissions" }, 400);

    const { data: target } = await admin.from("users").select("id, role, is_platform_owner, full_name, email").eq("id", userId).maybeSingle();
    if (!target || target.role !== "super_admin") return json({ error: "Staff member not found" }, 404);
    if (target.is_platform_owner === true) return json({ error: "Owners always have full access" }, 400);

    const { error: updErr } = await admin.from("users").update({ permissions }).eq("id", userId);
    if (updErr) return json({ error: updErr.message }, 400);
    await logAudit(admin, {
      ...actor, action: "staff.update", target_type: "staff",
      target_id: userId, target_label: `${target.full_name} (${target.email})`,
      details: { permissions },
    });
    return json({ ok: true }, 200);
  }

  // ── Remove a staff member ─────────────────────────────────────────────
  if (action === "remove") {
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "user_id is required" }, 400);
    if (userId === user.id) return json({ error: "You cannot remove yourself" }, 400);

    const { data: target } = await admin.from("users").select("id, role, is_platform_owner, full_name, email").eq("id", userId).maybeSingle();
    if (!target || target.role !== "super_admin") return json({ error: "Staff member not found" }, 404);
    if (target.is_platform_owner === true) return json({ error: "Cannot remove a platform owner" }, 400);

    const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banErr) return json({ error: banErr.message }, 400);
    const { error: deactivateErr } = await admin.from("users").update({
      account_status: "deactivated",
      deactivated_at: new Date().toISOString(),
      deactivated_by: user.id,
      permissions: [],
    }).eq("id", userId);
    if (deactivateErr) return json({ error: deactivateErr.message }, 400);
    await logAudit(admin, {
      ...actor, action: "staff.deactivate", target_type: "staff",
      target_id: userId, target_label: `${target.full_name} (${target.email})`,
    });
    return json({ ok: true }, 200);
  }

  return json({ error: "Unknown action" }, 400);
});

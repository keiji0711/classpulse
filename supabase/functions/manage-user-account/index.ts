import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasAdminMfa, verifyAuth } from "../_shared/auth.ts";
import { isValidUUID } from "../_shared/validation.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const auth = await verifyAuth(req);
  if (auth.error || !auth.user) return json({ error: auth.error }, auth.status);
  if (!hasAdminMfa(req)) return json({ error: "MFA verification is required" }, 403);

  const { user_id, action } = await req.json();
  if (!isValidUUID(user_id) || !["deactivate", "reactivate"].includes(action)) return json({ error: "Valid user_id and action are required" }, 400);
  if (user_id === auth.user.id) return json({ error: "You cannot change your own account status" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [{ data: actor }, { data: target }] = await Promise.all([
    admin.from("users").select("id,role,school_id,is_platform_owner,account_status,full_name,email").eq("id",auth.user.id).maybeSingle(),
    admin.from("users").select("id,role,school_id,is_platform_owner,account_status,full_name,email").eq("id",user_id).maybeSingle(),
  ]);
  if (!actor || !target) return json({ error: "Account not found" }, 404);
  const ownerAllowed = actor.role === "super_admin" && actor.is_platform_owner === true;
  const schoolAllowed = actor.role === "school_admin" && target.role === "instructor" && actor.school_id === target.school_id;
  if (!ownerAllowed && !schoolAllowed) return json({ error: "Not authorized for this account" }, 403);
  if (target.is_platform_owner) return json({ error: "A platform owner cannot be deactivated here" }, 400);

  const active = action === "reactivate";
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: active ? "none" : "876000h",
  });
  if (authUpdateError) return json({ error: authUpdateError.message }, 400);

  const { error: profileError } = await admin.from("users").update({
    account_status: active ? "active" : "deactivated",
    deactivated_at: active ? null : new Date().toISOString(),
    deactivated_by: active ? null : actor.id,
  }).eq("id",user_id);
  if (profileError) return json({ error: profileError.message }, 400);

  await admin.from("admin_audit_log").insert({
    actor_id: actor.id,actor_name: actor.full_name,actor_email: actor.email,
    action: `account.${action}`,target_type: "user",target_id:user_id,target_label:target.email,
    details:{role:target.role,school_id:target.school_id},
  });
  return json({ ok:true,account_status:active?"active":"deactivated" });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyJwt } from "../_shared/jwt.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { accessDenied, authorizeParentStudent } from "../_shared/parentAuthorization.ts";
import { isParentAccessEnabled } from "../_shared/parentAccess.ts";

const ENTITLEMENT_ID = "parent_access";
const EXPECTED_PRODUCT_ID = "classpulse_parent_access";

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function latestDate(...values: unknown[]): string | null {
  const parsed = values.map(parseDate).filter((value): value is string => value !== null);
  if (parsed.length === 0) return null;
  return parsed.reduce((latest, value) => (
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest
  ));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = await verifyJwt(token);
    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { student_id } = await req.json();
    if (!isValidUUID(student_id)) return accessDenied(corsHeaders);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const relationship = await authorizeParentStudent(supabaseAdmin, payload, student_id);
    if (!relationship) return accessDenied(corsHeaders);

    const revenueCatApiKey = Deno.env.get("REVENUECAT_ANDROID_PUBLIC_SDK_KEY");
    if (!revenueCatApiKey?.startsWith("goog_")) {
      return new Response(JSON.stringify({ error: "Google Play verification is not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appUserId = `family:${relationship.familyId}`;
    const revenueCatResponse = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${revenueCatApiKey}`,
        },
      },
    );

    if (!revenueCatResponse.ok) {
      console.error("[sync-revenuecat-access] RevenueCat status", revenueCatResponse.status);
      return new Response(JSON.stringify({ error: "Could not verify Google Play access" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customer = await revenueCatResponse.json();
    const entitlement = customer?.subscriber?.entitlements?.[ENTITLEMENT_ID] ?? null;
    const productId = typeof entitlement?.product_identifier === "string"
      ? entitlement.product_identifier
      : null;
    const entitlementMatchesProduct = productId === EXPECTED_PRODUCT_ID
      || productId?.startsWith(`${EXPECTED_PRODUCT_ID}:`) === true;
    const subscription = customer?.subscriber?.subscriptions?.[EXPECTED_PRODUCT_ID]
      ?? customer?.subscriber?.subscriptions?.[`${EXPECTED_PRODUCT_ID}:monthly`]
      ?? null;
    const expiresAt = latestDate(
      entitlement?.expires_date,
      entitlement?.grace_period_expires_date,
      subscription?.expires_date,
      subscription?.grace_period_expires_date,
    );
    const expirationIsActive = expiresAt === null || new Date(expiresAt).getTime() > Date.now();
    const revenueCatActive = Boolean(entitlement && entitlementMatchesProduct && expirationIsActive);

    const { error: upsertError } = await supabaseAdmin
      .from("parent_access_subscriptions")
      .upsert({
        school_id: relationship.schoolId,
        family_id: relationship.familyId,
        app_user_id: appUserId,
        provider: "google_play",
        entitlement_id: ENTITLEMENT_ID,
        product_id: productId,
        status: revenueCatActive ? "active" : "inactive",
        original_transaction_id: subscription?.original_transaction_id ?? null,
        latest_transaction_id: subscription?.store_transaction_id ?? null,
        purchased_at: parseDate(subscription?.purchase_date ?? entitlement?.purchase_date),
        expires_at: expiresAt,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "app_user_id,entitlement_id" });

    if (upsertError) {
      console.error("[sync-revenuecat-access] Upsert failed", upsertError.message);
      return new Response(JSON.stringify({ error: "Could not update ClassPulse access" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessEnabled = await isParentAccessEnabled(supabaseAdmin, student_id);
    return new Response(JSON.stringify({
      access_enabled: accessEnabled,
      google_play_active: revenueCatActive,
      billing_app_user_id: appUserId,
      expires_at: expiresAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[sync-revenuecat-access]", error);
    return new Response(JSON.stringify({ error: "Could not verify Google Play access" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

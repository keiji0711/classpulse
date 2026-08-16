import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

// ═══════════════════════════════════════════════════════════════
// Inlined: CORS headers
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// Inlined: Gmail mailer
// ═══════════════════════════════════════════════════════════════
interface MailPayload {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  schoolId?: string;
  invoiceId?: string;
}

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;

function toRecipientList(to: string | string[]): string[] {
  if (Array.isArray(to)) {
    return to.filter((email) => typeof email === "string" && email.trim().length > 0);
  }
  return to
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

async function sendMailViaGmail(payload: MailPayload): Promise<void> {
  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    throw new Error("Gmail credentials not configured in environment variables");
  }

  const recipients = toRecipientList(payload.to);
  if (recipients.length === 0) {
    throw new Error("No valid recipient email found");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: GMAIL_FROM,
    to: recipients,
    subject: payload.subject,
    text: payload.textBody,
    html: payload.htmlBody,
  });
}

async function logEmailEvent(
  supabaseAdmin: any,
  payload: MailPayload,
  status: "sent" | "failed",
  errorMessage?: string
): Promise<void> {
  const recipients = toRecipientList(payload.to);
  if (recipients.length === 0) return;

  const rows = recipients.map((recipient) => ({
    to_email: recipient,
    subject: payload.subject,
    status,
    error_message: errorMessage || null,
    school_id: payload.schoolId || null,
    invoice_id: payload.invoiceId || null,
    created_at: new Date().toISOString(),
  }));

  await supabaseAdmin.from("email_logs").insert(rows);
}

// Allowlist for post-payment redirect origins. Prevents open-redirect abuse
// via the `return_to` query param.
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname;
    if (host === "classpulse.pages.dev") return true;
    if (host.endsWith(".classpulse.pages.dev")) return true;
    if (host === "classpulse101.netlify.app") return true;
    if (host === "localhost" || host === "127.0.0.1") return true;
    const envUrl = Deno.env.get("WEB_APP_URL");
    if (envUrl) {
      try {
        if (new URL(envUrl).hostname === host) return true;
      } catch (_) { /* ignore */ }
    }
    return false;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  // Handle redirect (GET from user browser after payment) — UNAUTHENTICATED
  if (req.method === "GET") {
    // GET requests don't require authorization; they're public redirects
    try {
    const url = new URL(req.url);
    const event = url.searchParams.get("event");
    const type = url.searchParams.get("type");
    const isSuccess = event === "redirect_success";
    const isSchool = type === "school";

    // For school payments, redirect to the web app subscription page.
    // Prefer the origin the checkout started from (passed as `return_to`),
    // fall back to WEB_APP_URL env, then the Cloudflare Pages deployment.
    if (isSchool) {
      const fallbackOrigin = Deno.env.get("WEB_APP_URL") || "https://classpulse.pages.dev";
      const requested = url.searchParams.get("return_to");
      const webAppOrigin = isAllowedOrigin(requested) ? requested! : fallbackOrigin;
      const redirectUrl = isSuccess
        ? `${webAppOrigin}/admin/my-subscription?payment=success`
        : `${webAppOrigin}/admin/my-subscription?payment=failed`;
      return new Response(null, {
        status: 302,
        headers: { "Location": redirectUrl, "Cache-Control": "no-store" },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
    } catch (err) {
      console.error("GET redirect error:", err);
      return new Response("Redirect error", { status: 500 });
    }
  }

  // POST — PayMongo webhook
  try {
    const body = await req.text();
    const payload = JSON.parse(body);

    // Verify webhook signature — MANDATORY in production
    const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("PAYMONGO_WEBHOOK_SECRET not configured — rejecting webhook");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const sigHeader = req.headers.get("paymongo-signature") ?? "";
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => p.split("=", 2) as [string, string])
    );
    const timestamp = parts["t"] ?? "";
    const expectedSig = parts["li"] ?? parts["te"] ?? "";

    if (!timestamp || !expectedSig) {
      console.error("Missing webhook signature components");
      return new Response("Invalid signature", { status: 401 });
    }

    const signedPayload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload)
    );
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computed !== expectedSig) {
      console.error("Webhook signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }

    const event = payload?.data?.attributes?.type;
    const resourceData = payload?.data?.attributes?.data;

    console.log(`[PayMongo Webhook] Event: ${event}`);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // checkout_session.payment.paid — Checkout Session completed successfully
    if (event === "checkout_session.payment.paid") {
      const checkoutSessionId = resourceData?.id;
      const payments = resourceData?.attributes?.payments ?? [];
      const metadata = resourceData?.attributes?.metadata ?? {};
      const paymentId = payments.length > 0 ? payments[0].id : null;

      console.log(`[PayMongo] Checkout paid: ${checkoutSessionId}, payment: ${paymentId}, metadata:`, metadata);

      // This webhook now handles school subscriptions only.
      if (metadata.type === "school_subscription") {
        console.log("[PayMongo] Ignoring retired school subscription checkout event");
        return new Response("OK", { status: 200 });
      }

      console.log("[PayMongo] Ignoring non-school checkout event");
      return new Response("OK", { status: 200 });
    }

    // Other events — just acknowledge
    console.log(`[PayMongo] Unhandled event: ${event}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("paymongo-webhook error:", err);
    return new Response("Internal error", { status: 500 });
  }
});

// ---------------------------------------------------------------------------
// Handle school subscription payment
// ---------------------------------------------------------------------------
async function handleSchoolPayment(
  supabaseAdmin: any,
  checkoutSessionId: string | null,
  paymentId: string | null,
  metadata: any,
) {
  const subId = metadata.subscription_id;
  const schoolId = metadata.school_id;
  const planName = metadata.plan_name ?? "School Plan";
  const amount = metadata.amount ?? 0;

  // Find the school subscription
  let sub = null;
  if (checkoutSessionId) {
    const { data } = await supabaseAdmin
      .from("school_subscriptions")
      .select("*")
      .eq("paymongo_checkout_id", checkoutSessionId)
      .single();
    sub = data;
  }
  if (!sub && subId) {
    const { data } = await supabaseAdmin
      .from("school_subscriptions")
      .select("*")
      .eq("id", subId)
      .single();
    sub = data;
  }

  if (!sub) {
    console.error("[School] No subscription found for checkout paid event");
    return new Response("OK", { status: 200 });
  }

  // Activate for 1 month
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await supabaseAdmin
    .from("school_subscriptions")
    .update({
      status: "active",
      paid_at: now.toISOString(),
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      paymongo_payment_id: paymentId,
      payment_reference: paymentId ?? checkoutSessionId,
      notes: `Paid via QR Ph — ${planName}`,
      updated_at: now.toISOString(),
    })
    .eq("id", sub.id);

  console.log(`[School] Subscription ${sub.id} activated until ${periodEnd.toISOString()}`);

  // Send receipt email to the school admin
  try {
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("email, full_name")
      .eq("school_id", sub.school_id)
      .eq("role", "school_admin")
      .limit(1)
      .single();

    const { data: school } = await supabaseAdmin
      .from("schools")
      .select("name")
      .eq("id", sub.school_id)
      .single();

    if (admin?.email) {
      const formatDate = (d: Date) =>
        d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const formatCurrency = (a: number) =>
        `₱${Number(a).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
      const reference = paymentId ?? checkoutSessionId ?? "—";

      const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>School Subscription Receipt</title>
  <style>
    body { margin:0; padding:0; background:#f1f5f9; font-family:'Segoe UI',system-ui,sans-serif; color:#0f172a; }
    .shell { width:100%; padding:20px 10px; }
    .container { max-width:560px; margin:0 auto; background:#fff; border-radius:16px; overflow:hidden; border:1px solid #dbe4ee; box-shadow:0 12px 36px rgba(15,23,42,0.08); }
    .header { background:linear-gradient(135deg,#0f766e,#0d9488); padding:28px 24px; color:#fff; }
    .brand { font-size:12px; letter-spacing:1.2px; text-transform:uppercase; opacity:0.85; margin-bottom:8px; }
    .title { margin:0; font-size:26px; font-weight:700; }
    .subtitle { margin:8px 0 0; font-size:14px; opacity:0.9; }
    .body { padding:24px; }
    .badge { display:inline-block; background:#dcfce7; color:#166534; padding:8px 16px; border-radius:999px; font-weight:700; font-size:13px; text-transform:uppercase; margin-bottom:20px; }
    .row { display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #f1f5f9; }
    .row:last-child { border-bottom:none; }
    .label { color:#64748b; font-size:14px; }
    .value { font-weight:600; font-size:14px; text-align:right; }
    .total { background:#f8fafc; margin:16px -24px; padding:16px 24px; display:flex; justify-content:space-between; align-items:center; }
    .total-label { font-size:16px; font-weight:700; }
    .total-amount { font-size:24px; font-weight:800; color:#0f766e; }
    .footer { background:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 20px; text-align:center; font-size:12px; color:#94a3b8; }
  </style>
</head>
<body>
  <div class="shell"><div class="container">
    <div class="header">
      <div class="brand">ClassPulse</div>
      <h1 class="title">Subscription Receipt</h1>
      <p class="subtitle">Thank you, ${admin.full_name || "Admin"}!</p>
    </div>
    <div class="body">
      <span class="badge">✓ Payment Successful</span>
      <div>
        <div class="row"><span class="label">School</span><span class="value">${school?.name ?? "—"}</span></div>
        <div class="row"><span class="label">Plan</span><span class="value">${planName}</span></div>
        <div class="row"><span class="label">Payment Date</span><span class="value">${formatDate(now)}</span></div>
        <div class="row"><span class="label">Active Until</span><span class="value">${formatDate(periodEnd)}</span></div>
        <div class="row"><span class="label">Reference</span><span class="value" style="font-size:12px;word-break:break-all;">${reference}</span></div>
      </div>
      <div class="total">
        <span class="total-label">Amount Paid</span>
        <span class="total-amount">${formatCurrency(amount)}</span>
      </div>
    </div>
    <div class="footer"><p style="margin:0;">ClassPulse — School Subscription Receipt</p><p style="margin:6px 0 0;">© ${new Date().getFullYear()} ClassPulse</p></div>
  </div></div>
</body>
</html>`;

      const mailPayload: MailPayload = {
        to: admin.email,
        subject: `ClassPulse Subscription Receipt — ${formatCurrency(amount)}`,
        htmlBody,
        textBody: `ClassPulse Subscription Receipt\n\nSchool: ${school?.name}\nPlan: ${planName}\nAmount: ${formatCurrency(amount)}\nActive Until: ${formatDate(periodEnd)}\nReference: ${reference}`,
      };

      await sendMailViaGmail(mailPayload);
      await logEmailEvent(supabaseAdmin, mailPayload, "sent");
      console.log(`[School Receipt] Sent to ${admin.email}`);
    }
  } catch (err) {
    console.error("[School Receipt] Failed:", err);
  }

  return new Response("OK", { status: 200 });
}


import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getErrorMessage,
  logEmailEvent,
  resolveSchoolAdminRecipients,
  sendMailViaGmail,
  type MailPayload,
} from "../_shared/gmailMailer.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasAdminMfa, verifyAuth } from "../_shared/auth.ts";
import { authorizePlatformOwner } from "../_shared/staffAuthorization.ts";

interface SubscriptionData {
  id: string;
  school_id: string;
  plan_id?: string;
  status: string;
  started_at: string;
  current_period_end?: string;
  trial_ends_at?: string;
}

interface SchoolData {
  id: string;
  name: string;
}

interface PlanData {
  id: string;
  name: string;
  description: string;
  price_per_student?: number;
  minimum_monthly?: number;
}

function generateSubscriptionConfirmationHTML(
  school: SchoolData,
  plan: PlanData | null,
  subscription: SubscriptionData,
  appUrl: string
): string {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const statusMessage: Record<string, string> = {
    active: "Your subscription is active and all plan features are available.",
    trialing: "Your free trial is active. You can use all included features during this period.",
    past_due: "Your account has an outstanding payment. Please complete payment to avoid interruption.",
    paused: "Your subscription is paused. You can resume access anytime from billing settings.",
    canceled: "Your subscription has been canceled. You can reactivate any time from your dashboard.",
    expired: "Your subscription has expired. Renew to restore full access.",
  };

  const statusColor: Record<string, string> = {
    active: "#166534",
    trialing: "#0f766e",
    past_due: "#b45309",
    paused: "#475569",
    canceled: "#991b1b",
    expired: "#991b1b",
  };

  const statusBg: Record<string, string> = {
    active: "#dcfce7",
    trialing: "#ccfbf1",
    past_due: "#fef3c7",
    paused: "#e2e8f0",
    canceled: "#fee2e2",
    expired: "#fee2e2",
  };

  const planDetails = plan
    ? `
    <div class="meta-card">
      <p class="meta-label">Plan</p>
      <p class="meta-value">${plan.name}</p>
    </div>
    <div class="meta-card">
      <p class="meta-label">Plan Details</p>
      <p class="meta-value">${plan.description}</p>
    </div>
    ${
      plan.price_per_student
        ? `<div class="meta-card">
      <p class="meta-label">Pricing</p>
      <p class="meta-value">$${plan.price_per_student.toFixed(2)} per student/month</p>
    </div>`
        : ""
    }
    ${
      plan.minimum_monthly
        ? `<div class="meta-card">
      <p class="meta-label">Minimum Monthly</p>
      <p class="meta-value">$${plan.minimum_monthly.toFixed(2)}</p>
    </div>`
        : ""
    }
    `
    : "";

  const trialInfo =
    subscription.status === "trialing" && subscription.trial_ends_at
      ? `<p class="trial-note">
    <strong>Trial Ends:</strong> ${formatDate(subscription.trial_ends_at)}<br>
    Billing starts automatically after this date unless your plan is changed.
  </p>`
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Confirmation</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f1f5f9;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #0f172a;
    }
    .shell {
      width: 100%;
      padding: 20px 10px;
      box-sizing: border-box;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #dbe4ee;
      box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
    }
    .header {
      background: linear-gradient(135deg, #0f766e, #0369a1);
      color: #ffffff;
      padding: 24px;
    }
    .brand {
      font-size: 13px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      opacity: 0.9;
      margin-bottom: 10px;
    }
    .title {
      margin: 0;
      font-size: 30px;
      font-weight: 700;
    }
    .status-badge {
      display: inline-block;
      margin-top: 12px;
      padding: 7px 12px;
      border-radius: 999px;
      color: ${statusColor[subscription.status] || "#334155"};
      background: ${statusBg[subscription.status] || "#e2e8f0"};
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.4px;
    }
    .body {
      padding: 24px;
    }
    .intro {
      margin: 0 0 12px;
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 16px 0 10px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .meta-card {
      border: 1px solid #dbe4ee;
      background: #f8fafc;
      border-radius: 12px;
      padding: 10px 12px;
    }
    .meta-label {
      margin: 0;
      font-size: 12px;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.4px;
    }
    .meta-value {
      margin: 4px 0 0;
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }
    .info-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-left: 4px solid #0f766e;
      padding: 12px;
      margin: 14px 0;
      border-radius: 10px;
      font-size: 14px;
      color: #1e3a8a;
      line-height: 1.5;
    }
    .trial-note {
      background: #fef9c3;
      border: 1px solid #fde68a;
      border-left: 4px solid #d97706;
      padding: 12px;
      border-radius: 10px;
      margin: 14px 0;
      font-size: 14px;
      line-height: 1.5;
      color: #854d0e;
    }
    .cta-button {
      display: inline-block;
      background: #0f766e;
      color: white;
      padding: 11px 20px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      margin-top: 10px;
    }
    .help {
      margin-top: 14px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }
    .footer {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 14px 20px;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
    ul {
      margin: 8px 0 0;
      padding-left: 18px;
      color: #334155;
      font-size: 14px;
      line-height: 1.6;
    }
    @media (max-width: 520px) {
      .title {
        font-size: 24px;
      }
      .meta-grid {
        grid-template-columns: 1fr;
      }
      .body {
        padding: 18px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="container">
      <div class="header">
        <div class="brand">ClassPulse Billing</div>
        <h1 class="title">Subscription Update</h1>
        <span class="status-badge">${subscription.status}</span>
      </div>

      <div class="body">
        <p class="intro">Hello <strong>${school.name}</strong>,</p>
        <p class="intro">${statusMessage[subscription.status] || "Your subscription has been updated."}</p>

        ${trialInfo}

        <div class="section-title">Account Summary</div>
        <div class="meta-grid">
          <div class="meta-card">
            <p class="meta-label">School</p>
            <p class="meta-value">${school.name}</p>
          </div>
          <div class="meta-card">
            <p class="meta-label">Status</p>
            <p class="meta-value" style="text-transform: capitalize;">${subscription.status}</p>
          </div>
          <div class="meta-card">
            <p class="meta-label">Started</p>
            <p class="meta-value">${formatDate(subscription.started_at)}</p>
          </div>
          ${
            subscription.current_period_end
              ? `<div class="meta-card">
            <p class="meta-label">Current Period Ends</p>
            <p class="meta-value">${formatDate(subscription.current_period_end)}</p>
          </div>`
              : ""
          }
          ${planDetails}
        </div>

        <div class="info-box">
          <strong>Next Step:</strong> Review your billing and subscription settings in ClassPulse to keep your account up to date.
        </div>

        <a href="${appUrl}/dashboard" class="cta-button">Open Dashboard</a>

        <div class="section-title">Need Help?</div>
        <ul>
          <li>Email support@classpulse.app</li>
          <li>Open in-app support from your dashboard</li>
          <li>Review docs at ${appUrl}/docs</li>
        </ul>

        <p class="help">
          Thanks for using ClassPulse. This is an automated service email.
        </p>
      </div>

      <div class="footer">
        <p style="margin: 0;">ClassPulse Subscription Notifications</p>
        <p style="margin: 6px 0 0;">© ${new Date().getFullYear()} ClassPulse</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

function getSubscriptionSubject(schoolName: string, status: string): string {
  if (status === "active") {
    return `Welcome to ClassPulse - Subscription Active for ${schoolName}`;
  }

  if (status === "trialing") {
    return `ClassPulse Trial is Live for ${schoolName}`;
  }

  if (status === "past_due") {
    return `Action Required: ClassPulse Payment Past Due for ${schoolName}`;
  }

  if (status === "canceled" || status === "expired") {
    return `ClassPulse Subscription Ended for ${schoolName}`;
  }

  return `ClassPulse Subscription Updated for ${schoolName}`;
}

function generateSubscriptionText(
  school: SchoolData,
  plan: PlanData | null,
  subscription: SubscriptionData,
  appUrl: string
): string {
  return [
    `ClassPulse Subscription Update`,
    `School: ${school.name}`,
    `Status: ${subscription.status}`,
    `Plan: ${plan?.name || "N/A"}`,
    `Started: ${subscription.started_at}`,
    subscription.current_period_end
      ? `Current period ends: ${subscription.current_period_end}`
      : "Current period ends: N/A",
    subscription.trial_ends_at ? `Trial ends: ${subscription.trial_ends_at}` : "",
    "",
    `Manage subscription: ${appUrl}/dashboard`,
    "Support: support@classpulse.app",
  ]
    .filter(Boolean)
    .join("\n");
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify caller is an authenticated Supabase user
  const { user, error: authError, status: authStatus } = await verifyAuth(req);
  if (authError) {
    return new Response(JSON.stringify({ error: authError }), {
      status: authStatus, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { subscriptionId } = await req.json();

    if (!subscriptionId) {
      return new Response(
        JSON.stringify({ error: "Missing subscriptionId" }),
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
    if (!user || !hasAdminMfa(req) || !await authorizePlatformOwner(supabaseAdmin, user.id)) {
      return new Response(JSON.stringify({ error: "Platform owner access with MFA is required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch subscription
    const { data: subscription, error: subError } = await supabaseAdmin
      .from("school_subscriptions")
      .select("*")
      .eq("id", subscriptionId)
      .single();

    if (subError || !subscription) {
      return new Response(
        JSON.stringify({ error: "Subscription not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch school details
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name")
      .eq("id", subscription.school_id)
      .single();

    if (schoolError || !school) {
      return new Response(
        JSON.stringify({ error: "School not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const recipientEmails = await resolveSchoolAdminRecipients(
      supabaseAdmin,
      subscription.school_id
    );

    // Fetch plan details if plan_id exists
    let plan: PlanData | null = null;
    if (subscription.plan_id) {
      const { data: planData } = await supabaseAdmin
        .from("plans")
        .select("id, name, description, price_per_student, minimum_monthly")
        .eq("id", subscription.plan_id)
        .single();
      plan = planData;
    }

    // Generate HTML
    const appUrl =
      Deno.env.get("APP_URL") || "https://app.schoolmanagement.com";
    const htmlBody = generateSubscriptionConfirmationHTML(
      school,
      plan,
      subscription,
      appUrl
    );
    const textBody = generateSubscriptionText(school, plan, subscription, appUrl);
    const mailPayload: MailPayload = {
      to: recipientEmails,
      subject: getSubscriptionSubject(school.name, subscription.status),
      htmlBody,
      textBody,
      schoolId: subscription.school_id,
    };

    await sendMailViaGmail(mailPayload);
    await logEmailEvent(supabaseAdmin, mailPayload, "sent");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Subscription confirmation email sent successfully",
        to: recipientEmails,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

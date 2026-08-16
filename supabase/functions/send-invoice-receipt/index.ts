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
import { isValidUUID } from "../_shared/validation.ts";

interface InvoiceData {
  id: string;
  invoice_number: string;
  school_id: string;
  billing_period_start: string;
  billing_period_end: string;
  student_count: number;
  rate_per_student?: number;
  minimum_monthly?: number;
  subtotal: number;
  total_amount: number;
  plan_name: string;
  billing_model: string;
  status: string;
  payment_reference?: string | null;
  paid_at?: string | null;
}

interface SchoolData {
  id: string;
  name: string;
  email?: string;
  address?: string;
  phone?: string;
}

function generateInvoiceHTML(
  invoice: InvoiceData,
  school: SchoolData,
  appUrl: string
): string {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const statusMeta: Record<string, { label: string; bg: string; fg: string }> = {
    paid: { label: "Paid", bg: "#dcfce7", fg: "#166534" },
    sent: { label: "Sent", bg: "#dbeafe", fg: "#1d4ed8" },
    draft: { label: "Draft", bg: "#e2e8f0", fg: "#334155" },
    void: { label: "Voided", bg: "#fee2e2", fg: "#991b1b" },
  };
  const status = statusMeta[invoice.status] || {
    label: invoice.status,
    bg: "#e2e8f0",
    fg: "#334155",
  };

  const billingRows =
    invoice.billing_model === "per_student"
      ? `
    <tr>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0;">Student Count</td>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0; text-align: right;">${invoice.student_count} students</td>
    </tr>
    <tr>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0;">Rate per Student</td>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency(invoice.rate_per_student || 0)}</td>
    </tr>
    ${invoice.minimum_monthly ? `<tr>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0;">Minimum Monthly</td>
      <td style="padding: 12px 14px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency(invoice.minimum_monthly)}</td>
    </tr>` : ""}
    <tr>
      <td style="padding: 12px 14px; border-bottom: 2px solid #0f172a; font-weight: 600;">Subtotal</td>
      <td style="padding: 12px 14px; border-bottom: 2px solid #0f172a; text-align: right; font-weight: 700;">${formatCurrency(invoice.subtotal)}</td>
    </tr>
    `
      : `
    <tr>
      <td style="padding: 12px 14px; border-bottom: 2px solid #0f172a; font-weight: 600;">Subtotal</td>
      <td style="padding: 12px 14px; border-bottom: 2px solid #0f172a; text-align: right; font-weight: 700;">${formatCurrency(invoice.subtotal)}</td>
    </tr>
    `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number}</title>
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
      padding: 24px;
      color: #ffffff;
    }
    .brand {
      font-size: 13px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      opacity: 0.9;
      margin-bottom: 10px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .invoice-title {
      margin: 0;
      font-size: 30px;
      font-weight: 700;
    }
    .badge {
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      background: ${status.bg};
      color: ${status.fg};
    }
    .header-note {
      margin: 14px 0 0 0;
      font-size: 14px;
      opacity: 0.95;
    }
    .body {
      padding: 24px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .meta-card {
      border: 1px solid #dbe4ee;
      background: #f8fafc;
      border-radius: 12px;
      padding: 10px 12px;
    }
    .meta-label {
      margin: 0;
      font-size: 11px;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.4px;
    }
    .meta-value {
      margin: 4px 0 0 0;
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 20px 0 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 12px;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      overflow: hidden;
    }
    .total-row {
      background: #f8fafc;
    }
    .total-amount {
      color: #0369a1;
      font-size: 24px;
      font-weight: 800;
    }
    .status-line {
      margin: 8px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      background: ${invoice.status === "paid" ? "#dcfce7" : "#fef9c3"};
      color: ${invoice.status === "paid" ? "#166534" : "#92400e"};
    }
    .cta-wrap {
      margin-top: 16px;
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
    @media (max-width: 520px) {
      .meta-grid {
        grid-template-columns: 1fr;
      }
      .invoice-title {
        font-size: 24px;
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
        <div class="title-row">
          <h1 class="invoice-title">Invoice</h1>
          <span class="badge">${status.label}</span>
        </div>
        <p class="header-note">Here is your latest billing summary for ${school.name}.</p>
      </div>

      <div class="body">
        <div class="meta-grid">
          <div class="meta-card">
            <p class="meta-label">Invoice Number</p>
            <p class="meta-value">${invoice.invoice_number}</p>
          </div>
          <div class="meta-card">
            <p class="meta-label">Plan</p>
            <p class="meta-value">${invoice.plan_name || "Standard Plan"}</p>
          </div>
          <div class="meta-card">
            <p class="meta-label">Billing Period</p>
            <p class="meta-value">${formatDate(invoice.billing_period_start)} - ${formatDate(invoice.billing_period_end)}</p>
          </div>
          <div class="meta-card">
            <p class="meta-label">Invoice Date</p>
            <p class="meta-value">${formatDate(invoice.billing_period_start)}</p>
          </div>
        </div>

        <div class="section-title">Bill To</div>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
          <strong>${school.name}</strong><br>
          ${school.address ? school.address + "<br>" : ""}
          ${school.email ? "<a href='mailto:" + school.email + "'>" + school.email + "</a>" : ""}
          ${school.phone ? "<br>" + school.phone : ""}
        </p>

        <div class="section-title">Billing Breakdown</div>
        <table>
          <tbody>
            ${billingRows}
            <tr class="total-row">
              <td style="padding: 14px; font-size: 16px; font-weight: 700;">Total Amount Due</td>
              <td style="padding: 14px; text-align: right;" class="total-amount">${formatCurrency(invoice.total_amount)}</td>
            </tr>
          </tbody>
        </table>

        ${invoice.payment_reference ? `<p style="margin: 10px 0 0; font-size: 13px; color: #475569;"><strong>Payment Reference:</strong> ${invoice.payment_reference}</p>` : ""}

        <div class="status-line">
          ${invoice.status === "paid" ? "Payment received. Thank you." : "Payment is currently pending. Please review your billing portal."}
        </div>

        <div class="cta-wrap">
          <a href="${appUrl}/billing" class="cta-button">Open Billing Portal</a>
        </div>

        <p class="help">
          Need help with this invoice? Reply to your billing contact or email billing@classpulse.app.
        </p>
      </div>

      <div class="footer">
        <p style="margin: 0;">ClassPulse Billing - Automated message</p>
        <p style="margin: 6px 0 0;">© ${new Date().getFullYear()} ClassPulse</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

function generateInvoiceText(invoice: InvoiceData, school: SchoolData, appUrl: string): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  return [
    `ClassPulse Invoice ${invoice.invoice_number}`,
    `School: ${school.name}`,
    `Plan: ${invoice.plan_name || "Standard Plan"}`,
    `Billing Period: ${invoice.billing_period_start} to ${invoice.billing_period_end}`,
    `Student Count: ${invoice.student_count}`,
    invoice.rate_per_student ? `Rate per Student: ${formatCurrency(invoice.rate_per_student)}` : "",
    invoice.minimum_monthly ? `Minimum Monthly: ${formatCurrency(invoice.minimum_monthly)}` : "",
    `Subtotal: ${formatCurrency(invoice.subtotal)}`,
    `Total Due: ${formatCurrency(invoice.total_amount)}`,
    `Status: ${invoice.status}`,
    invoice.payment_reference ? `Payment Reference: ${invoice.payment_reference}` : "",
    "",
    `Review and pay online: ${appUrl}/billing`,
    "Need support? Contact billing@classpulse.app",
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
    const { invoiceId } = await req.json();

    if (!invoiceId || !isValidUUID(invoiceId)) {
      return new Response(
        JSON.stringify({ error: "Missing invoiceId" }),
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

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("school_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch school details
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name, address")
      .eq("id", invoice.school_id)
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
      invoice.school_id
    );
    const primaryRecipient = recipientEmails[0];

    // Generate HTML
    const appUrl =
      Deno.env.get("APP_URL") || "https://app.schoolmanagement.com";
    const htmlBody = generateInvoiceHTML(
      invoice,
      {
        ...school,
        email: primaryRecipient,
      },
      appUrl
    );
    const textBody = generateInvoiceText(invoice, school, appUrl);
    const mailPayload: MailPayload = {
      to: recipientEmails,
      subject: `ClassPulse Invoice ${invoice.invoice_number} for ${school.name}`,
      htmlBody,
      textBody,
      schoolId: invoice.school_id,
      invoiceId,
    };

    await sendMailViaGmail(mailPayload);
    await logEmailEvent(supabaseAdmin, mailPayload, "sent");

    // Update invoice status to "sent"
    const { error: updateError } = await supabaseAdmin
      .from("school_invoices")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("Failed to update invoice status:", updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invoice receipt sent successfully",
        invoiceNumber: invoice.invoice_number,
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

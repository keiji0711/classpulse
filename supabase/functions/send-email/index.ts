import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getErrorMessage,
  logEmailEvent,
  type MailPayload,
  sendMailViaGmail,
} from "../_shared/gmailMailer.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasAdminMfa, verifyAuth } from "../_shared/auth.ts";
import { authorizePlatformOwner } from "../_shared/staffAuthorization.ts";
import { isValidEmail, sanitizeString } from "../_shared/validation.ts";

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

  let payload: MailPayload | null = null;

  try {
    const rawPayload = await req.json();

    // Validate required fields
    if (!rawPayload?.to || !rawPayload?.subject || !rawPayload?.htmlBody) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: to, subject, htmlBody",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    payload = {
      to: rawPayload.to,
      subject: sanitizeString(rawPayload.subject),
      htmlBody: rawPayload.htmlBody,
      textBody: rawPayload.textBody,
      schoolId: rawPayload.schoolId,
      invoiceId: rawPayload.invoiceId,
    };

    // Validate email recipients
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    const invalidEmails = recipients.filter((e: string) => !isValidEmail(e));
    if (invalidEmails.length > 0) {
      return new Response(
        JSON.stringify({ error: `Invalid email address(es): ${invalidEmails.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Send email via Gmail
    await sendMailViaGmail(payload);
    await logEmailEvent(supabaseAdmin, payload, "sent");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email sent successfully",
        to: payload.to,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = getErrorMessage(error);

    // Try to log the failure
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      if (payload) {
        await logEmailEvent(supabaseAdmin, payload, "failed", errorMessage);
      }
    } catch (logError) {
      console.error("Failed to log error:", logError);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

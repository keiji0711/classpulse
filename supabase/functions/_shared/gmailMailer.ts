import nodemailer from "npm:nodemailer@6.9.16";

export interface MailPayload {
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toRecipientList(to: string | string[]): string[] {
  if (Array.isArray(to)) {
    return to.filter((email) => typeof email === "string" && email.trim().length > 0);
  }

  return to
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

export async function sendMailViaGmail(payload: MailPayload): Promise<void> {
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

export async function logEmailEvent(
  supabaseAdmin: any,
  payload: MailPayload,
  status: "sent" | "failed",
  errorMessage?: string
): Promise<void> {
  const recipients = toRecipientList(payload.to);

  if (recipients.length === 0) {
    return;
  }

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

export async function resolveSchoolAdminRecipients(
  supabaseAdmin: any,
  schoolId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("school_id", schoolId)
    .eq("role", "school_admin")
    .not("email", "is", null)
    .neq("email", "")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch school admin email: ${error.message}`);
  }

  const emails = (data || [])
    .map((row: { email?: string }) => row.email?.trim())
    .filter((email: string | undefined): email is string => Boolean(email));

  if (emails.length === 0) {
    throw new Error("No school admin email found for this school");
  }

  const uniqueEmails = Array.from(new Set<string>(emails));
  return uniqueEmails;
}

# Gmail Integration Setup Guide

This guide explains how to set up the Gmail email sending functionality for your SaaS platform.

## Overview

The email system consists of three main functions:

1. **send-email** - Generic email sending function via Gmail SMTP
2. **send-invoice-receipt** - Generates and sends formatted invoice emails
3. **send-subscription-confirmation** - Sends confirmation emails when subscriptions change

## Prerequisites

- A Gmail account with 2-factor authentication enabled
- Access to your Supabase project and environment variables
- Deployed Supabase Edge Functions

## Gmail Configuration

### Step 1: Enable 2-Factor Authentication

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Factor Authentication if not already enabled

### Step 2: Create an App Password

1. Go to [Google Account App Passwords](https://myaccount.google.com/apppasswords)
2. Select:
   - Device type: **Windows PC** (or your device)
   - App: **Mail**
3. Google will generate a 16-character password
4. Copy this password and save it securely

### Step 3: Set Environment Variables

Add the following to your Supabase project's environment variables:

```bash
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_FROM=your-email@gmail.com
APP_URL=https://app.yourschool.com
```

For local development, add to `.env.local`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_FROM=noreply@yourschool.com
APP_URL=http://localhost:5173
```

## Database Setup

Run the migration to create the email_logs table:

```bash
supabase migration up --local
```

Or manually apply the migration at: `migrations/010_email_logs.sql`

## API Functions

### 1. send-email

**Purpose:** Send any email via Gmail SMTP

**Endpoint:** `/functions/v1/send-email`

**Request Body:**

```json
{
  "to": "admin@school.com",
  "subject": "Test Email",
  "htmlBody": "<h1>Hello</h1><p>This is a test.</p>",
  "textBody": "Optional plain text version",
  "schoolId": "optional-uuid",
  "invoiceId": "optional-uuid"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Email sent successfully",
  "to": "admin@school.com"
}
```

### 2. send-invoice-receipt

**Purpose:** Generate and send invoice receipt emails

**Endpoint:** `/functions/v1/send-invoice-receipt`

**Request Body:**

```json
{
  "invoiceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Features:**
- Automatically fetches invoice details from database
- Generates professional invoice HTML
- Includes billing breakdown based on plan type
- Shows payment status
- Updates invoice status to "sent"
- Logs email event

**Response:**

```json
{
  "success": true,
  "message": "Invoice receipt sent successfully",
  "invoiceNumber": "INV-2024-001",
  "to": "admin@school.com"
}
```

### 3. send-subscription-confirmation

**Purpose:** Send subscription confirmation/update emails

**Endpoint:** `/functions/v1/send-subscription-confirmation`

**Request Body:**

```json
{
  "subscriptionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Features:**
- Personalizes message based on subscription status
- Shows trial end date if applicable
- Includes plan details
- Provides next steps and support information
- Logs email event

**Response:**

```json
{
  "success": true,
  "message": "Subscription confirmation email sent successfully",
  "to": "admin@school.com"
}
```

## Integration Examples

### Sending an Invoice Receipt After Creating an Invoice

From your web backend or admin panel:

```typescript
// After creating an invoice
const response = await supabase.functions.invoke("send-invoice-receipt", {
  body: { invoiceId: newInvoice.id },
});

if (response.error) {
  console.error("Failed to send invoice:", response.error);
} else {
  console.log("Invoice sent:", response.data);
}
```

### Sending Subscription Confirmation After Subscription Change

From your web backend:

```typescript
// After updating a subscription
const response = await supabase.functions.invoke(
  "send-subscription-confirmation",
  {
    body: { subscriptionId: subscription.id },
  }
);

if (response.error) {
  console.error("Failed to send confirmation:", response.error);
} else {
  console.log("Confirmation sent:", response.data);
}
```

### Triggering on Database Events

You can set up triggers to automatically send emails:

```sql
-- Function to send invoice receipt on invoice status change
create or replace function public.handle_invoice_sent()
returns trigger language plpgsql security definer
as $$
begin
  if new.status = 'sent' and old.status != 'sent' then
    perform http_post(
      'https://your-project.supabase.co/functions/v1/send-invoice-receipt',
      json_build_object('invoiceId', new.id),
      json_object_agg('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
    );
  end if;
  return new;
end;
$$;

create trigger invoice_status_change_trigger
after update on public.school_invoices
for each row
execute function public.handle_invoice_sent();
```

## Email Log Tracking

All sent and failed emails are logged in the `email_logs` table:

```sql
-- View sent invoices
select * from email_logs 
where invoice_id is not null 
and created_at > now() - interval '7 days'
order by created_at desc;

-- View failed emails
select * from email_logs 
where status = 'failed'
order by created_at desc;
```

## Troubleshooting

### "Gmail credentials not configured"

- Verify `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set in environment variables
- Check that the App Password was copied correctly (remove any spaces)
- Verify 2-Factor Authentication is enabled on the Gmail account

### "Failed to send email: timeout"

- Check internet connectivity
- Verify Gmail SMTP port 465 is not blocked by firewall
- Try again (may be temporary SMTP issue)

### "Invalid credentials"

- Regenerate the App Password in Google Account settings
- Update the environment variable with the new password
- Verify the Gmail account hasn't changed

### Emails not being logged

- Check that the `email_logs` table exists (run migration)
- Verify RLS policies allow logging (should automatically work)
- Check Supabase logs for function errors

## Security Best Practices

1. **Never commit credentials** - Use environment variables only
2. **Restrict email access** - Only super admins should see email logs
3. **Use SMTP encryption** - Already configured (TLS on port 465)
4. **Monitor email logs** - Regularly check for failed sends
5. **Rate limiting** - Consider implementing rate limiting if sending bulk emails
6. **Unsubscribe options** - Add unsubscribe links for non-transactional emails

## Testing

Test the email functions locally:

```bash
# Test send-email
curl -X POST http://localhost:54321/functions/v1/send-email \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@gmail.com",
    "subject": "Test Email",
    "htmlBody": "<h1>Test</h1>"
  }'

# Test send-invoice-receipt
curl -X POST http://localhost:54321/functions/v1/send-invoice-receipt \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"invoiceId": "YOUR_INVOICE_ID"}'
```

## Next Steps

1. Deploy the Supabase functions: `supabase functions deploy`
2. Set up environment variables in Supabase
3. Test with a sample invoice
4. Set up or integrate invoice sending in your billing workflow
5. Monitor email logs for issues

## Additional Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Gmail SMTP Configuration](https://support.google.com/mail/answer/185833)
- [App Passwords Help](https://support.google.com/accounts/answer/185833)

# Gmail Integration - Quick Checklist

## 📋 Pre-Setup (Before You Start)

- [ ] Gmail account with 2-Factor Authentication enabled
- [ ] Access to Supabase project (super admin)
- [ ] Local development environment set up (Node.js, Supabase CLI)
- [ ] Git repository initialized
- [ ] Terminal/PowerShell access

## 🔑 Step 1: Gmail Configuration (10 minutes)

- [ ] Go to [Google Account Security](https://myaccount.google.com/security)
- [ ] Enable 2-Factor Authentication (if not already done)
- [ ] Go to [App Passwords](https://myaccount.google.com/apppasswords)
- [ ] Select: Device = "Windows PC", App = "Mail"
- [ ] Copy the 16-character password generated
- [ ] **IMPORTANT:** Save this password securely - you'll need it next

## 🚀 Step 2: Deploy to Supabase

### 2.1 Add Environment Variables
- [ ] In Supabase Dashboard: Settings → Secrets
- [ ] Add these secrets:
  - `GMAIL_USER` = your-email@gmail.com
  - `GMAIL_APP_PASSWORD` = xxxx xxxx xxxx xxxx (from Google)
  - `GMAIL_FROM` = noreply@yourschool.com
  - `APP_URL` = https://app.yourschool.com

### 2.2 Deploy Database
- [ ] Terminal: `supabase migration push`
- [ ] Verify in Dashboard: SQL Editor should show `email_logs` table

### 2.3 Deploy Functions
```bash
supabase functions deploy send-email
supabase functions deploy send-invoice-receipt
supabase functions deploy send-subscription-confirmation
```
- [ ] All three functions show in Edge Functions dashboard
- [ ] No deployment errors in logs

## 📁 Step 3: Verify Files Created

```
supabase/
  ├── functions/
  │   ├── send-email/index.ts ✅
  │   ├── send-invoice-receipt/index.ts ✅
  │   ├── send-subscription-confirmation/index.ts ✅
  └── migrations/
      └── 010_email_logs.sql ✅

web/
  ├── src/
  │   ├── lib/
  │   │   └── email.ts ✅
  │   └── pages/super-admin/
  │       └── BillingEmailPage.tsx ✅

Root:
  ├── GMAIL_SETUP.md ✅
  ├── EMAIL_INTEGRATION_SUMMARY.md ✅
  └── DEPENDENCIES.md ✅
```

- [ ] All files present in correct locations
- [ ] No TypeScript errors in web/src/lib/email.ts

## 🧪 Step 4: Test Email System

### 4.1 Test Basic Email
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/send-email \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "your-email@gmail.com",
    "subject": "Test Email",
    "htmlBody": "<h1>Success!</h1><p>Gmail integration is working.</p>"
  }'
```
- [ ] Response shows success: "Email sent successfully"
- [ ] Check your email inbox - should receive test email

### 4.2 Verify Email Log
- [ ] In Supabase Dashboard: SQL Editor
- [ ] Run: `SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 1;`
- [ ] Should show one row with status "sent"

### 4.3 Test with Invoice (If you have test data)
```typescript
import { sendInvoiceReceipt } from "@/lib/email";

// Replace with your actual invoice ID
await sendInvoiceReceipt("550e8400-e29b-41d4-a716-446655440000");
```
- [ ] Invoice email sends successfully
- [ ] Email log shows status "sent"
- [ ] Invoice status changes to "sent" in database

## 🔌 Step 5: Integration

### 5.1 In Your Billing Workflow
Add after creating an invoice:

```typescript
import { sendInvoiceReceipt } from "@/lib/email";

// After successful invoice creation
const newInvoice = await createInvoiceInDatabase(...);

// Send receipt
try {
  await sendInvoiceReceipt(newInvoice.id);
  console.log("Invoice receipt sent");
} catch (error) {
  console.error("Failed to send receipt:", error);
  // Handle error (e.g., log to monitoring)
}
```

- [ ] Import email helper in billing page/component
- [ ] Add sendInvoiceReceipt after invoice creation
- [ ] Test creating a new invoice - should send email
- [ ] Verify email received by school admin

### 5.2 For Subscription Updates
```typescript
import { sendSubscriptionConfirmation } from "@/lib/email";

// After subscription status change
await sendSubscriptionConfirmation(subscription.id);
```

- [ ] Import email helper in subscription management
- [ ] Add sendSubscriptionConfirmation after subscription updates
- [ ] Test subscription creation - should send confirmation email

## 📊 Step 6: Monitoring Setup

### 6.1 Check Email Logs Regularly
```sql
-- View recent emails
SELECT * FROM email_logs 
ORDER BY created_at DESC 
LIMIT 20;

-- View failed emails
SELECT * FROM email_logs 
WHERE status = 'failed' 
ORDER BY created_at DESC;

-- Count by status
SELECT status, COUNT(*) 
FROM email_logs 
GROUP BY status;
```

- [ ] Bookmark this query for reference
- [ ] Review failed emails weekly
- [ ] Set up alerts for repeated failures (optional)

### 6.2 Use Dashboard Page
- [ ] Navigate to billing email management page
- [ ] View recent invoices
- [ ] View email logs
- [ ] Can manually resend invoices/confirmations

## ⚠️ Troubleshooting

If emails aren't sending:

1. **Check environment variables**
   ```bash
   # Can't check directly, but if emails fail:
   # - Verify GMAIL_USER format is correct
   # - Verify GMAIL_APP_PASSWORD length is 16 chars (no spaces in middle)
   # - Regenerate if unsure
   ```

2. **Check email logs for errors**
   ```sql
   SELECT to_email, error_message FROM email_logs 
   WHERE status = 'failed' 
   LIMIT 5;
   ```

3. **Verify Gmail 2FA is enabled**
   - Go to [Google Account Security](https://myaccount.google.com/security)
   - Confirm 2FA is ON

4. **Test with curl command** (use your actual service role key)
   - Should get immediate success/failure response
   - Check inbox for email

5. **Check Supabase logs**
   - Dashboard → Edge Functions → Select function
   - Look for error messages or stack traces

## 📝 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "Gmail credentials not configured" | Add GMAIL_USER and GMAIL_APP_PASSWORD to Supabase secrets |
| "Failed to send email: timeout" | Check internet connection, try again |
| "Invalid credentials" | Regenerate App Password in Google Account |
| Emails not in inbox | Check spam folder, verify recipient email |
| "Function not found" | Redeploy functions with `supabase functions deploy` |
| Emails not logged | Run migration: `supabase migration push` |

## 🎯 Next Steps (After Testing)

1. **Configure automatic billing emails**
   - [ ] Set up invoice sending in billing workflow
   - [ ] Set up subscription confirmation emails

2. **Set up monitoring**
   - [ ] Review email logs weekly
   - [ ] Set up alerts for high failure rates

3. **Customize templates** (Optional)
   - [ ] Edit HTML templates in function files
   - [ ] Brand with your colors/logo
   - [ ] Update copy to match your tone

4. **Scale up**
   - [ ] Handle bulk sending if needed
   - [ ] Implement queuing for large batches
   - [ ] Add retry logic for failed sends

## 📚 Documentation Reference

- **Full Setup Guide:** [GMAIL_SETUP.md](./GMAIL_SETUP.md)
- **Implementation Summary:** [EMAIL_INTEGRATION_SUMMARY.md](./EMAIL_INTEGRATION_SUMMARY.md)
- **Dependencies & Config:** [DEPENDENCIES.md](./DEPENDENCIES.md)

## 🆘 Need Help?

1. Check the relevant documentation file above
2. Review error message in email_logs table
3. Check Supabase function logs for stack trace
4. Verify all environment variables are set
5. Try the curl test command

## ✅ Final Verification

When complete, verify:

- [ ] All 3 Supabase functions deployed
- [ ] All environment variables set
- [ ] Database migration applied (email_logs table exists)
- [ ] Test email sends successfully
- [ ] Email appears in logs with "sent" status
- [ ] Integrated into billing workflow
- [ ] Invoices send emails when created
- [ ] Subscriptions send confirmation emails

---

**Status:** Ready for Production ✅
**Created:** 2024
**Last Updated:** 2024

When complete, your system will automatically send:
- ✉️ Invoice receipts to school admins
- ✉️ Subscription confirmations on plan changes
- ✉️ Any custom transactional emails

All emails are professionally formatted, tracked, and logged for auditing.

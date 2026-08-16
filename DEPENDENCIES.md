# Email Integration - Dependencies & Configuration

## Deno Dependencies (Supabase Edge Functions)

The following dependencies are automatically available via `esm.sh` in Deno:

### send-email/index.ts
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
```

- **@supabase/supabase-js** - Supabase client library
- **smtp** - SMTP client for Gmail connections

### send-invoice-receipt/index.ts & send-subscription-confirmation/index.ts
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```

- **@supabase/supabase-js** - Supabase client library
- Native Deno `fetch()` for HTTP requests

## Web App Dependencies

### TypeScript Types
The email helpers use TypeScript interfaces:

```typescript
interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  schoolId?: string;
  invoiceId?: string;
}
```

### Required Packages
These should already be in your web app:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x.x",
    "react": "^18.x.x",
    "react-router-dom": "^6.x.x"
  }
}
```

If missing, install:
```bash
npm install @supabase/supabase-js react-router-dom
```

## Environment Variables

### Required
```bash
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  # 16-char App Password from Gmail
APP_URL=https://app.yourschool.com
```

### Supabase Secret Keys (Auto-provided from project)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Optional
```bash
GMAIL_FROM=noreply@yourschool.com  # Defaults to GMAIL_USER if not set
```

## Setup on Supabase

### 1. Add Environment Variables

**In Supabase Dashboard:**

1. Navigate to **Settings → Secrets**
2. Add secrets for production:
   - Key: `GMAIL_USER`, Value: `your-email@gmail.com`
   - Key: `GMAIL_APP_PASSWORD`, Value: `xxxx xxxx xxxx xxxx`
   - Key: `GMAIL_FROM`, Value: `noreply@yourschool.com`
   - Key: `APP_URL`, Value: `https://app.yourschool.com`

### 2. Deploy Migrations

```bash
# List available migrations
supabase migration list

# Deploy specific migration
supabase migration push

# Or manually run SQL:
supabase db push
```

### 3. Deploy Functions

```bash
# Deploy all email functions
supabase functions deploy send-email
supabase functions deploy send-invoice-receipt
supabase functions deploy send-subscription-confirmation

# Or deploy all at once
supabase functions deploy
```

### 4. Verify Functions

Check the Supabase Dashboard:
- Go to **Edge Functions**
- You should see three new functions listed
- Check logs to verify no deploy errors

## Local Development Setup

### 1. Configure .env.local

Create `.env.local` in workspace root:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Gmail
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_FROM=noreply@yourschool-dev.com
APP_URL=http://localhost:5173
```

### 2. Start Supabase Locally

```bash
supabase start
```

### 3. Create Local Tables

```bash
supabase db push  # Applies all migrations locally
```

### 4. Test Functions Locally

```bash
# Start function in watch mode
supabase functions serve --env-file .env.local

# In another terminal, test:
curl -X POST http://localhost:54321/functions/v1/send-email \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@gmail.com",
    "subject": "Test",
    "htmlBody": "<h1>Test</h1>"
  }'
```

## Database Schema

### email_logs Table

```sql
-- Auto-created by migration 010_email_logs.sql
CREATE TABLE public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'failed' | 'bounced'
  error_message TEXT,
  school_id UUID REFERENCES schools(id),
  invoice_id UUID REFERENCES school_invoices(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## File Structure

```
supabase/
├── functions/
│   ├── send-email/
│   │   └── index.ts          # Core email sender
│   ├── send-invoice-receipt/
│   │   └── index.ts          # Invoice email generator
│   └── send-subscription-confirmation/
│       └── index.ts          # Subscription email generator
└── migrations/
    └── 010_email_logs.sql    # Email logs table

web/
├── src/
│   ├── lib/
│   │   └── email.ts          # Email helper functions
│   └── pages/
│       └── super-admin/
│           └── BillingEmailPage.tsx  # Example page

Documentation/
├── GMAIL_SETUP.md            # Complete Gmail setup
├── EMAIL_INTEGRATION_SUMMARY.md  # Quick overview
└── DEPENDENCIES.md           # This file
```

## Testing Checklist

- [ ] Gmail credentials working (test via SMTP)
- [ ] Environment variables set in Supabase
- [ ] Migrations applied to database
- [ ] Functions deployed successfully
- [ ] Test email sends successfully
- [ ] Email log appears in database
- [ ] Failed send is logged with error
- [ ] Email templates render correctly
- [ ] Integration with billing workflow
- [ ] RLS policies working correctly

## Troubleshooting Dependencies

### SMTP Connection Issues

**Problem:** `SmtpClient is not defined`
- **Solution:** Ensure import is correct:
  ```typescript
  import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
  ```

### Supabase Client Issues

**Problem:** `createClient is not exported`
- **Solution:** Update import URL if version changed:
  ```typescript
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  ```

### Environment Variable Not Defined

**Problem:** `Deno.env.get("GMAIL_USER")` returns null
- **Solution:** 
  1. Add to Supabase project secrets
  2. Wait 30 seconds for changes to propagate
  3. Redeploy functions: `supabase functions deploy`

### Web App Import Errors

**Problem:** `Cannot find module "@/lib/email"`
- **Solution:** Check tsconfig paths configuration:
  ```json
  {
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "@/*": ["src/*"]
      }
    }
  }
  ```

## Version Compatibility

| Component | Version | Status |
|-----------|---------|--------|
| Supabase JS | ^2.0.0 | ✓ Tested |
| Deno | ^1.40.0 | ✓ Tested |
| SMTP | v0.7.0 | ✓ Tested |
| React | ^18.0 | ✓ Tested |
| TypeScript | ^5.0 | ✓ Tested |

## Performance Considerations

### Email Function Timeouts

- Default Supabase timeout: 60s
- Gmail SMTP typically replies in < 5s
- Email logging < 100ms

### Rate Limiting

Gmail limits: ~30 emails per minute per account

For bulk sends, implement queue:

```typescript
export async function sendBulkWithQueue(
  emailIds: string[],
  delayMs: number = 2000
) {
  for (const id of emailIds) {
    await sendEmail(id);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
```

### Database Indexing

Email logs are indexed for:
- `school_id` - Query by school
- `status` - Find failed sends
- `created_at` - Time-based queries

No additional indexes needed unless querying other fields.

## Security Checklist

- [ ] Gmail credentials never logged
- [ ] App Password not committed to git
- [ ] RLS policies prevent cross-school email access
- [ ] Email logs retention configured
- [ ] Sensitive data not included in email metadata
- [ ] HTTPS enforced for all email links
- [ ] Unsubscribe tokens for bulk emails

## Monitoring & Alerts

### Check Email Health

```sql
-- Failed emails in last hour
SELECT count(*), error_message
FROM email_logs
WHERE status = 'failed'
AND created_at > now() - interval '1 hour'
GROUP BY error_message;

-- Success rate by school
SELECT school_id, 
  status,
  count(*) as count
FROM email_logs
WHERE created_at > now() - interval '7 days'
GROUP BY school_id, status;
```

### Alert Conditions

Set alerts for:
1. More than 5% send failures in 1 hour
2. No emails sent for 24 hours
3. Specific error patterns repeating

## Next Steps

1. Complete Gmail setup (see [GMAIL_SETUP.md](./GMAIL_SETUP.md))
2. Configure all environment variables
3. Deploy migrations and functions
4. Run tests from testing checklist
5. Integrate into billing workflow
6. Set up monitoring

---

For detailed setup instructions, see [GMAIL_SETUP.md](./GMAIL_SETUP.md)

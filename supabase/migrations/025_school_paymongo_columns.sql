-- Migration: Add PayMongo columns to school_subscriptions for QR Ph payments
ALTER TABLE public.school_subscriptions
  ADD COLUMN IF NOT EXISTS paymongo_checkout_id text,
  ADD COLUMN IF NOT EXISTS paymongo_payment_id text,
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE INDEX IF NOT EXISTS idx_school_sub_checkout_id
  ON public.school_subscriptions(paymongo_checkout_id)
  WHERE paymongo_checkout_id IS NOT NULL;

-- Allow school_admin to update their own subscription (for initiating payment)
DROP POLICY IF EXISTS "school_admin_update_own_subscription" ON public.school_subscriptions;
CREATE POLICY "school_admin_update_own_subscription" ON public.school_subscriptions
  FOR UPDATE USING (
    school_id = (SELECT school_id FROM public.users WHERE id = auth.uid())
    AND public.get_user_role() = 'school_admin'
  )
  WITH CHECK (
    school_id = (SELECT school_id FROM public.users WHERE id = auth.uid())
    AND public.get_user_role() = 'school_admin'
  );

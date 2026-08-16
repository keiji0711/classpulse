-- ============================================
-- Update subscription plans to per-student pricing model
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'billing_model'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN billing_model text NOT NULL DEFAULT 'per_student';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'billing_cycle'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN billing_cycle text NOT NULL DEFAULT 'monthly';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'price_per_student'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN price_per_student numeric(10,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'minimum_monthly'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN minimum_monthly numeric(10,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'annual_discount_months'
  ) THEN
    ALTER TABLE public.plans ADD COLUMN annual_discount_months int;
  END IF;
END $$;

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_billing_model_check;
ALTER TABLE public.plans ADD CONSTRAINT plans_billing_model_check CHECK (billing_model IN ('per_student', 'custom'));

ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_billing_cycle_check;
ALTER TABLE public.plans ADD CONSTRAINT plans_billing_cycle_check CHECK (billing_cycle IN ('monthly', 'annual', 'custom'));

-- Align existing plans with the landing page pricing model.
UPDATE public.plans
SET
  name = 'Standard School Plan',
  description = 'Per-student monthly billing for most schools',
  monthly_price = 0,
  billing_model = 'per_student',
  billing_cycle = 'monthly',
  price_per_student = 10.00,
  minimum_monthly = 2500.00,
  annual_discount_months = null,
  features = '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
  limits = '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
  is_active = true
WHERE code = 'starter';

UPDATE public.plans
SET
  name = 'Annual Saver',
  description = 'Annual commitment with lower effective per-student pricing',
  monthly_price = 0,
  billing_model = 'per_student',
  billing_cycle = 'annual',
  price_per_student = 8.33,
  minimum_monthly = 2500.00,
  annual_discount_months = 2,
  features = '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
  limits = '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
  is_active = true
WHERE code = 'growth';

UPDATE public.plans
SET
  name = 'Enterprise Volume',
  description = 'Custom pricing for large schools or school groups',
  monthly_price = 0,
  billing_model = 'custom',
  billing_cycle = 'custom',
  price_per_student = null,
  minimum_monthly = null,
  annual_discount_months = null,
  features = '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
  limits = '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
  is_active = true
WHERE code = 'premium';

-- Ensure plans exist even if prior rows were removed.
INSERT INTO public.plans (
  code,
  name,
  description,
  monthly_price,
  billing_model,
  billing_cycle,
  price_per_student,
  minimum_monthly,
  annual_discount_months,
  features,
  limits,
  is_active
)
VALUES
  (
    'starter',
    'Standard School Plan',
    'Per-student monthly billing for most schools',
    0,
    'per_student',
    'monthly',
    10.00,
    2500.00,
    null,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
    '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
    true
  ),
  (
    'growth',
    'Annual Saver',
    'Annual commitment with lower effective per-student pricing',
    0,
    'per_student',
    'annual',
    8.33,
    2500.00,
    2,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
    '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
    true
  ),
  (
    'premium',
    'Enterprise Volume',
    'Custom pricing for large schools or school groups',
    0,
    'custom',
    'custom',
    null,
    null,
    null,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
    '{"max_students": 999999, "max_instructors": 999999}'::jsonb,
    true
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_price = EXCLUDED.monthly_price,
  billing_model = EXCLUDED.billing_model,
  billing_cycle = EXCLUDED.billing_cycle,
  price_per_student = EXCLUDED.price_per_student,
  minimum_monthly = EXCLUDED.minimum_monthly,
  annual_discount_months = EXCLUDED.annual_discount_months,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  is_active = EXCLUDED.is_active;

-- Migration: Re-seed plans as student-count-based tiers
-- Tier 1: Up to 1,000 students — ₱1/mo (TESTING)
-- Tier 2: 1,001 – 5,000 students — ₱5,000/mo
-- Tier 3: 5,001 – 9,000 students — ₱9,000/mo
-- Tier 4: 9,000+ students — Custom / Request pricing

INSERT INTO public.plans (
  code, name, description, monthly_price,
  billing_model, billing_cycle,
  price_per_student, minimum_monthly, annual_discount_months,
  features, limits, is_active
)
VALUES
  (
    'starter',
    'Basic',
    'For small schools with up to 1,000 students',
    1,
    'per_student', 'monthly',
    null, null, null,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": false}'::jsonb,
    '{"max_students": 1000, "max_instructors": 50}'::jsonb,
    true
  ),
  (
    'growth',
    'Standard',
    'For growing schools with up to 5,000 students',
    5000,
    'per_student', 'monthly',
    null, null, null,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
    '{"max_students": 5000, "max_instructors": 200}'::jsonb,
    true
  ),
  (
    'premium',
    'Premium',
    'For large schools with up to 9,000 students',
    9000,
    'per_student', 'monthly',
    null, null, null,
    '{"attendance_take": true, "grades_manage": true, "exports_download": true, "parent_messaging": true, "analytics_advanced": true}'::jsonb,
    '{"max_students": 9000, "max_instructors": 500}'::jsonb,
    true
  ),
  (
    'enterprise',
    'Enterprise',
    'For very large schools or school groups with 9,000+ students',
    0,
    'custom', 'custom',
    null, null, null,
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

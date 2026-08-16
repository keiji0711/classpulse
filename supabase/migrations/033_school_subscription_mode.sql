-- ═══════════════════════════════════════════════════════════════════════
-- School-level billing mode
--   'subscription' (default) → parents subscribe individually (₱50/mo)
--   'school_paid'            → the school paid for everyone; parents get
--                              full access with no individual subscription.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.schools
  add column if not exists subscription_mode text not null default 'subscription'
  check (subscription_mode in ('subscription', 'school_paid'));

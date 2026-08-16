-- Supabase-native scheduling avoids relying on an external CI runner for the
-- production retry/maintenance heartbeat.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;


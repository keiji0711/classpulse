import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { supabaseSecureStorage } from './secureStorage';

export const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.supabaseAnonKey ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Missing Supabase credentials. Set supabaseUrl and supabaseAnonKey in app.json extra or via EAS secrets.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: supabaseSecureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ── Parent JWT token management ────────────────────────────────
// Stored in memory and persisted via AuthContext.
// Used by all fetch() calls to edge functions.
let _parentJwt: string | null = null;

export function setParentJwt(jwt: string | null) {
  _parentJwt = jwt;
}

export function getParentJwt(): string | null {
  return _parentJwt;
}

/**
 * Build headers for edge function calls.
 * - If a parent JWT is available, uses it as the Bearer token.
 * - Otherwise falls back to the anon key (for unauthenticated calls like parent-login).
 */
export function getAuthHeaders(): Record<string, string> {
  const token = _parentJwt || SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

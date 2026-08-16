import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

const SESSION_EXPIRY_BUFFER_MS = 60_000;

function isExpiringSoon(session: Session) {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 - Date.now() < SESSION_EXPIRY_BUFFER_MS;
}

export async function ensureSupabaseSession(): Promise<{ session: Session | null; error: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { session: null, error: 'Your session expired. Please sign in again.' };
  }

  if (isExpiringSoon(session)) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      await supabase.auth.signOut();
      return { session: null, error: 'Your session expired. Please sign in again.' };
    }
    return { session: data.session, error: null };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      await supabase.auth.signOut();
      return { session: null, error: 'Your session expired. Please sign in again.' };
    }
    return { session: data.session, error: null };
  }

  return { session, error: null };
}

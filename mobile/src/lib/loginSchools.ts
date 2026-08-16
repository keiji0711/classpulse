import { fetchWithTimeout } from './fetchWithTimeout';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';

export interface LoginSchool {
  id: string;
  name: string;
}

/**
 * The school directory is public and must not inherit a stale staff session
 * from the shared Supabase client. Always use the configured anon credential.
 */
export async function fetchLoginSchools(): Promise<LoginSchool[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Mobile app configuration is incomplete');

  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/list_login_schools`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) throw new Error(`School directory request failed (${response.status})`);

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('School directory returned an invalid response');

  return body.filter((item): item is LoginSchool => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.name === 'string' && candidate.name.trim().length > 0;
  });
}

// ═══════════════════════════════════════════════════════════════
// Shared auth helpers — verify Supabase JWT from Authorization
// header before allowing access to protected edge functions.
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getAuthAssuranceLevel(req: Request): "aal1" | "aal2" | null {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    return claims?.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return null;
  }
}

export function hasAdminMfa(req: Request): boolean {
  return getAuthAssuranceLevel(req) === "aal2";
}

/**
 * Verifies the Authorization header contains a valid Supabase JWT.
 * Returns the authenticated user on success, or null + error message
 * on failure.
 *
 * Usage (inside Deno.serve handler):
 * ```ts
 * const { user, error, status } = await verifyAuth(req);
 * if (error) return new Response(JSON.stringify({ error }), { status, headers: ... });
 * ```
 */
export async function verifyAuth(
  req: Request
): Promise<
  | { user: { id: string; email?: string; role?: string }; error: null; status: 200 }
  | { user: null; error: string; status: 401 | 403 }
> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return { user: null, error: "Missing authorization header", status: 401 };
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user) {
    return {
      user: null,
      error: authError?.message || "Invalid or expired token",
      status: 401,
    };
  }

  return { user: { id: user.id, email: user.email }, error: null, status: 200 };
}

/**
 * Verifies the caller via JWT **or** API-key — whichever succeeds first.
 * This covers both web-app instructors (who send a Supabase Auth JWT)
 * and mobile/parent clients (who send the anon key).
 */
export async function verifyAuthOrApiKey(
  req: Request
): Promise<
  | { user: { id: string; email?: string } | null; error: null; status: 200 }
  | { user: null; error: string; status: 401 }
> {
  // 1) Try API-key first (cheap, no network call)
  const apiKeyResult = verifyApiKey(req);
  if (apiKeyResult.valid) {
    return { user: null, error: null, status: 200 };
  }

  // 2) Fall back to JWT verification
  const authResult = await verifyAuth(req);
  if (!authResult.error) {
    return authResult;
  }

  return {
    user: null,
    error: "Unauthorized – provide a valid JWT or API key",
    status: 401,
  };
}

/**
 * Verifies the request has a valid Supabase `apikey` header (anon key).
 * This is a lighter check for mobile/parent endpoints that don't use
 * Supabase Auth sessions but still need to prove they're calling from
 * a legitimate client (i.e. they possess the anon key).
 */
export function verifyApiKey(req: Request): { valid: boolean; error?: string } {
  const apiKey =
    req.headers.get("apikey") ??
    req.headers.get("authorization")?.replace("Bearer ", "");

  const expectedKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!apiKey || !expectedKey) {
    return { valid: false, error: "Missing API key" };
  }

  if (apiKey !== expectedKey) {
    return { valid: false, error: "Invalid API key" };
  }

  return { valid: true };
}

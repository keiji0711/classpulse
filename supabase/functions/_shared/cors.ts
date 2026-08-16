// ═══════════════════════════════════════════════════════════════
// Shared CORS configuration — restrict to known app origins.
// ═══════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS: string[] = [
  // Production web app
  "https://classpulse101.netlify.app",
  "https://classpulse.pages.dev",
  // Local dev
  "http://localhost:5173",
  "http://localhost:3000",
  // React-Native / Capacitor / Expo
  "capacitor://localhost",
  "http://localhost",
];

/**
 * Returns CORS headers with `Access-Control-Allow-Origin` set to the
 * request origin **only** if it matches the allow-list, otherwise falls
 * back to the first allowed origin. This prevents `*` from being used
 * in production while still supporting local dev & the mobile app.
 */
export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, paymongo-signature",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

/** Legacy-compatible constant for quick migration (defaults to primary origin). */
export const corsHeaders = getCorsHeaders();

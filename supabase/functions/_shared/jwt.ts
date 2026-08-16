// ═══════════════════════════════════════════════════════════════
// Shared JWT helpers — sign & verify tokens using SUPABASE_JWT_SECRET
// so the Supabase gateway accepts them as valid bearer tokens.
// ═══════════════════════════════════════════════════════════════

/**
 * Sign a JWT compatible with Supabase's gateway verification.
 * Uses the Web Crypto API (available in Deno) for HMAC-SHA256.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds = 7 * 24 * 60 * 60
): Promise<string> {
  const secret = Deno.env.get("APP_JWT_SECRET");
  if (!secret) throw new Error("APP_JWT_SECRET is not set");

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    role: "parent",
    iss: "classpulse-parent-auth",
    aud: "classpulse-mobile",
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const encodedSignature = base64UrlEncodeBuffer(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT signed with SUPABASE_JWT_SECRET.
 * Returns the payload if valid, or null if expired/invalid.
 */
export async function verifyJwt(
  token: string
): Promise<Record<string, unknown> | null> {
  const secret = Deno.env.get("APP_JWT_SECRET");
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureBytes = base64UrlDecodeToBuffer(encodedSignature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecodeToBuffer(encodedPayload))
    );

    if (payload.iss !== "classpulse-parent-auth" || payload.aud !== "classpulse-mobile") {
      return null;
    }

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ── Base64-URL helpers ─────────────────────────────────────────

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64UrlEncodeBuffer(bytes.buffer);
}

function base64UrlEncodeBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBuffer(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

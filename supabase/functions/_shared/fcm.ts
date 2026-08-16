const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cachedAccessToken = "";
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount: { project_id: string; client_email: string; private_key: string } | null = null;

function getServiceAccount() {
  if (cachedServiceAccount) return cachedServiceAccount;

  const b64 = Deno.env.get("FCM_SERVICE_ACCOUNT_B64") || "";
  if (!b64) {
    throw new Error("Missing FCM_SERVICE_ACCOUNT_B64 secret");
  }

  const jsonStr = atob(b64);
  const parsed = JSON.parse(jsonStr);

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM service account JSON missing required fields");
  }

  console.log(`[FCM] Loaded service account: project=${parsed.project_id}, email=${parsed.client_email}, key_len=${parsed.private_key.length}`);

  cachedServiceAccount = {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key,
  };

  return cachedServiceAccount;
}

function base64UrlEncode(input: string | Uint8Array): string {
  const base64 = typeof input === "string"
    ? btoa(input)
    : btoa(String.fromCharCode(...input));

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToPkcs8ArrayBuffer(pem: string): ArrayBuffer {
  const normalizedPem = pem.replace(/\\n/g, "\n").trim();
  const keyBase64 = normalizedPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const raw = atob(keyBase64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes.buffer;
}

async function createSignedJwt(
  clientEmail: string,
  privateKeyPem: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8ArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${unsignedToken}.${encodedSignature}`;
}

async function getGoogleAccessToken(): Promise<string> {
  const nowMs = Date.now();
  if (cachedAccessToken && nowMs < cachedAccessTokenExpiryMs - 60_000) {
    return cachedAccessToken;
  }

  const sa = getServiceAccount();

  const assertion = await createSignedJwt(sa.client_email, sa.private_key);

  const tokenResponse = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const tokenResult = await tokenResponse.json().catch(() => null);

  if (!tokenResponse.ok || !tokenResult?.access_token) {
    const details = tokenResult?.error_description || tokenResult?.error || "unknown error";
    throw new Error(`Failed to get FCM access token: ${details}`);
  }

  cachedAccessToken = tokenResult.access_token;
  cachedAccessTokenExpiryMs = nowMs + Number(tokenResult.expires_in || 3600) * 1000;

  return cachedAccessToken;
}

function normalizeData(
  data?: Record<string, string | number | boolean | null | undefined>
): Record<string, string> | undefined {
  if (!data) {
    return undefined;
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      continue;
    }
    normalized[key] = String(value);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export interface FcmNotificationPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

/** Permanent token failures must be removed and must never be retried. */
export function isStaleFcmTokenError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    "notregistered",
    "not registered",
    "unregistered",
    "registration-token-not-registered",
    "requested entity was not found",
    "invalid registration token",
  ].some((marker) => message.includes(marker));
}

export async function sendFcmNotification(payload: FcmNotificationPayload): Promise<unknown> {
  const sa = getServiceAccount();

  if (!payload.token?.trim()) {
    throw new Error("Missing destination FCM token");
  }

  const accessToken = await getGoogleAccessToken();

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: payload.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: normalizeData(payload.data),
          android: {
            priority: "high",
            notification: {
              channel_id: "classpulse-sound-v2",
              sound: "default",
            },
          },
        },
      }),
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const details =
      result?.error?.message ||
      result?.error?.status ||
      JSON.stringify(result || {});
    throw new Error(`FCM send failed: ${details}`);
  }

  return result;
}

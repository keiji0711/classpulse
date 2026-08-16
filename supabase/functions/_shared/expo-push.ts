const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  sound?: string;
  channelId?: string;
}

export function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

export async function sendExpoPushNotification(payload: ExpoPushPayload): Promise<unknown> {
  if (!payload.token?.trim()) {
    throw new Error("Missing destination push token");
  }

  const message: Record<string, unknown> = {
    to: payload.token,
    title: payload.title,
    body: payload.body,
    sound: payload.sound ?? "default",
    channelId: payload.channelId ?? "default",
    priority: "high",
  };

  if (payload.data) {
    const cleanData: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.data)) {
      if (value !== null && value !== undefined) {
        cleanData[key] = String(value);
      }
    }
    if (Object.keys(cleanData).length > 0) {
      message.data = cleanData;
    }
  }

  console.log(`[Expo Push] Sending to ${payload.token.substring(0, 30)}...`);

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(message),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const details = result?.errors?.[0]?.message || JSON.stringify(result || {});
    throw new Error(`Expo push failed (HTTP ${response.status}): ${details}`);
  }

  // Check per-ticket errors
  const ticket = result?.data;
  if (ticket?.status === "error") {
    throw new Error(`Expo push ticket error: ${ticket.message} (${ticket.details?.error || "unknown"})`);
  }

  console.log(`[Expo Push] Success:`, JSON.stringify(result));
  return result;
}

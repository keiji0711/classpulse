function toFriendlyMessage(message: string) {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes('invalid jwt') || normalized.includes('jwt expired') || normalized.includes('unauthorized')) {
    return 'Your session expired. Please sign out and sign in again.';
  }

  return message;
}

export async function getFunctionErrorMessage(error: unknown, fallback = 'Request failed') {
  if (!error || typeof error !== 'object') return fallback;

  const maybeError = error as {
    message?: string;
    context?: {
      clone?: () => { json: () => Promise<any>; text: () => Promise<string> };
      json?: () => Promise<any>;
      text?: () => Promise<string>;
    };
  };

  const response = maybeError.context;

  if (response) {
    try {
      const payload = response.clone ? await response.clone().json() : await response.json?.();
      if (typeof payload?.error === 'string' && payload.error.trim()) return toFriendlyMessage(payload.error);
      if (typeof payload?.message === 'string' && payload.message.trim()) return toFriendlyMessage(payload.message);
    } catch {
      // ignore JSON parsing issues
    }

    try {
      const text = response.clone ? await response.clone().text() : await response.text?.();
      if (typeof text === 'string' && text.trim()) return toFriendlyMessage(text);
    } catch {
      // ignore text parsing issues
    }
  }

  return maybeError.message ? toFriendlyMessage(maybeError.message) : fallback;
}

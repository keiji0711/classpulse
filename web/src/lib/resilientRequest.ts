interface RequestError {
  message?: string;
  code?: string;
  status?: number;
}

interface RequestResult {
  error: RequestError | null;
}

interface ResilientReadOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
}

const TRANSIENT_MESSAGE = /abort|timeout|timed out|network|fetch|connection|temporar|gateway|unavailable/i;

function isTransient(error: RequestError | null) {
  if (!error) return false;
  if (error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500)) return true;
  if (error.code === '57014' || error.code === 'PGRST003') return true;
  return TRANSIENT_MESSAGE.test(error.message ?? '');
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Runs an idempotent Supabase read with a deadline and bounded retries.
 * Do not use this wrapper for non-idempotent writes.
 */
export async function resilientRead<T extends RequestResult>(
  request: (signal: AbortSignal) => PromiseLike<T>,
  options: ResilientReadOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const retries = options.retries ?? 1;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastResult: T | null = null;
  let lastThrown: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await request(controller.signal);
      lastResult = result;
      if (!result.error || !isTransient(result.error) || attempt === retries) return result;
    } catch (error) {
      lastThrown = error;
      if (attempt === retries) throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }

    // Jitter prevents many clients from retrying at precisely the same moment.
    await wait(baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250));
  }

  if (lastResult) return lastResult;
  throw lastThrown instanceof Error ? lastThrown : new Error('The request could not be completed.');
}

export function friendlyReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/abort|timeout|timed out/i.test(message)) {
    return 'The server took too long to respond. Please try again.';
  }
  return message || 'The request could not be completed. Please try again.';
}

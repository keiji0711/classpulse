/**
 * Wrapper around fetch with a configurable timeout (default 15 seconds).
 * Automatically aborts the request if it takes too long.
 */
export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_MARKER = 'classpulse:route-chunk-reload';

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|loading chunk|chunkloaderror|importing a module script failed|error loading dynamically imported module/i.test(message);
}

/**
 * Loads route bundles defensively. An open tab can still reference an old,
 * hashed bundle after a deployment; one full reload gives it the new index.
 */
export function lazyWithRetry<T extends ComponentType>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const loaded = await importer();
      sessionStorage.removeItem(RELOAD_MARKER);
      return loaded;
    } catch (firstError) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));

      try {
        const loaded = await importer();
        sessionStorage.removeItem(RELOAD_MARKER);
        return loaded;
      } catch (retryError) {
        const route = window.location.pathname;
        if (isChunkLoadError(retryError) && sessionStorage.getItem(RELOAD_MARKER) !== route) {
          sessionStorage.setItem(RELOAD_MARKER, route);
          window.location.reload();
          return new Promise<never>(() => undefined);
        }

        throw retryError ?? firstError;
      }
    }
  });
}

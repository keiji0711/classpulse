import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './lazyWithRetry';

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module',
    'ChunkLoadError: Loading chunk 42 failed',
    'Importing a module script failed',
  ])('recognizes stale route bundle errors: %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('does not treat ordinary application errors as stale bundles', () => {
    expect(isChunkLoadError(new Error('Assessment RPC failed'))).toBe(false);
  });
});

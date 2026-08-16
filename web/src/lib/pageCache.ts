import { useState, useCallback, useRef } from 'react';

const store = new Map<string, unknown>();

export function hasCached(key: string): boolean {
  return store.has(key);
}

export function useCachedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, rawSet] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const keyRef = useRef(key);
  keyRef.current = key;

  const set = useCallback((v: T | ((prev: T) => T)) => {
    rawSet((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      store.set(keyRef.current, next);
      return next;
    });
  }, []);

  return [state, set];
}

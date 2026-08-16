import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted key-value storage using the device keychain (iOS) / Keystore (Android).
 * Falls back gracefully if value exceeds platform limits.
 *
 * expo-secure-store has a ~2KB value limit on some Android devices.
 * For session data that may exceed this, we chunk into multiple keys.
 */

const CHUNK_SIZE = 1800; // Safe limit per key
const CHUNK_COUNT_SUFFIX = '__chunks';

export async function secureGet(key: string): Promise<string | null> {
  try {
    // Try single-key read first
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) return value;

    // Check for chunked storage
    const countStr = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
    if (!countStr) return null;

    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) return null;

    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(`${key}__${i}`);
      if (chunk === null) return null; // Corrupted, treat as missing
      chunks.push(chunk);
    }
    return chunks.join('');
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  try {
    // Clean up any old chunked data first
    await secureDelete(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    // Chunk for large values
    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(key + CHUNK_COUNT_SUFFIX, String(chunks));
    for (let i = 0; i < chunks; i++) {
      const slice = value.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}__${i}`, slice);
    }
  } catch (err) {
    if (__DEV__) console.warn('[secureSet] Failed:', err);
  }
}

export async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key).catch(() => {});

    const countStr = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
    if (countStr) {
      const count = parseInt(countStr, 10);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {});
      }
      await SecureStore.deleteItemAsync(key + CHUNK_COUNT_SUFFIX).catch(() => {});
    }
  } catch {
    // best effort
  }
}

/**
 * Adapter for Supabase auth to use SecureStore instead of AsyncStorage.
 * Conforms to the { getItem, setItem, removeItem } interface.
 */
export const supabaseSecureStorage = {
  getItem: (key: string) => secureGet(key),
  setItem: (key: string, value: string) => secureSet(key, value),
  removeItem: (key: string) => secureDelete(key),
};

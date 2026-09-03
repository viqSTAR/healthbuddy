/**
 * Stands in for `expo-secure-store`, which is a native module with no Node
 * implementation — importing the real one outside a device throws.
 *
 * Backed by a Map so a test can assert on what was written without reaching
 * into the module under test.
 */
const store = new Map<string, string>();

export const setItemAsync = async (key: string, value: string): Promise<void> => {
  store.set(key, value);
};

export const getItemAsync = async (key: string): Promise<string | null> => store.get(key) ?? null;

export const deleteItemAsync = async (key: string): Promise<void> => {
  store.delete(key);
};

/** Test-only: inspect and reset the keychain. */
export const __store = store;

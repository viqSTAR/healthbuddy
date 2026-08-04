import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'hb.accessToken';
const REFRESH_KEY = 'hb.refreshToken';

/**
 * Tokens live in the OS keychain / Android keystore rather than React state, so
 * a session survives an app restart and is not readable by other apps.
 *
 * SecureStore has no web implementation; on web we fall back to localStorage,
 * which is the best available there and only used by the Expo web preview.
 */
const isWeb = Platform.OS === 'web';

const setItem = async (key: string, value: string) => {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

const getItem = async (key: string): Promise<string | null> => {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
};

const removeItem = async (key: string) => {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
};

/**
 * In-memory mirror so the request interceptor doesn't await the keychain on
 * every call. Kept in sync by save/clear.
 */
let cachedAccess: string | null = null;
let cachedRefresh: string | null = null;
let hydrated = false;

export const hydrate = async (): Promise<boolean> => {
  cachedAccess = await getItem(ACCESS_KEY);
  cachedRefresh = await getItem(REFRESH_KEY);
  hydrated = true;
  return !!cachedAccess;
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!hydrated) await hydrate();
  return cachedAccess;
};

export const getRefreshToken = async (): Promise<string | null> => {
  if (!hydrated) await hydrate();
  return cachedRefresh;
};

export const saveTokens = async (accessToken: string, refreshToken: string) => {
  cachedAccess = accessToken;
  cachedRefresh = refreshToken;
  hydrated = true;
  await Promise.all([setItem(ACCESS_KEY, accessToken), setItem(REFRESH_KEY, refreshToken)]);
};

export const clearTokens = async () => {
  cachedAccess = null;
  cachedRefresh = null;
  hydrated = true;
  await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
};

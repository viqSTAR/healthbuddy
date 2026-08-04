import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as tokenStore from './tokenStore';

/**
 * Resolves the API base URL.
 *
 * Order: an explicit EXPO_PUBLIC_API_URL, then the host that served the Expo
 * bundle (so a physical device reaches the dev machine rather than its own
 * loopback), then platform loopback defaults.
 */
const resolveBaseUrl = (): string => {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:5000/api/v1`;
    }
  }

  // Android emulators reach the host machine through 10.0.2.2, not localhost.
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:5000/api/v1'
    : 'http://localhost:5000/api/v1';
};

export const API_BASE_URL = resolveBaseUrl();

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

/* ---------- Request: attach the current access token ---------- */

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStore.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* ---------- Response: refresh once on 401, then replay ---------- */

let refreshInFlight: Promise<string | null> | null = null;

/** Callback invoked when the session cannot be recovered. */
let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return null;

  try {
    // Bare axios: using `api` here would recurse through this interceptor.
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: nextRefresh } = res.data.tokens;
    await tokenStore.saveTokens(accessToken, nextRefresh);
    return accessToken;
  } catch {
    await tokenStore.clearTokens();
    return null;
  }
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;

    // Collapse concurrent 401s into a single refresh round trip.
    refreshInFlight ??= refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });

    const token = await refreshInFlight;
    if (!token) {
      onSessionExpired?.();
      return Promise.reject(error);
    }

    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  }
);

/** Extracts a human-readable message from an axios failure. */
export const errorMessage = (err: unknown, fallback = 'Something went wrong.'): string => {
  const axiosErr = err as AxiosError<{ error?: string; details?: { message: string }[] }>;
  const data = axiosErr?.response?.data;

  if (data?.details?.length) return data.details[0]!.message;
  if (data?.error) return data.error;
  if (axiosErr?.message === 'Network Error') {
    return `Cannot reach the server at ${API_BASE_URL}. Is the backend running?`;
  }
  return axiosErr?.message || fallback;
};

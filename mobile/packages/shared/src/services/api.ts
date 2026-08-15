import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as tokenStore from './tokenStore';

/**
 * An Android emulator is not on the LAN, whatever its bundle host says.
 *
 * It sits behind its own NAT and reaches the dev machine only through the
 * 10.0.2.2 alias. A request aimed at the machine's LAN address instead leaves
 * that NAT and arrives back as external traffic, which Windows Firewall drops
 * unless someone has opened the port — so the emulator has to be settled before
 * the host-derived branch below, or the app resolves an address it can never
 * reach and every screen fails at "cannot reach the server".
 */
const isAndroidEmulator = (): boolean => {
  if (Platform.OS !== 'android') return false;
  const { Fingerprint = '', Model = '', Brand = '' } = Platform.constants;
  return (
    Fingerprint.startsWith('generic') ||
    Fingerprint.startsWith('unknown') ||
    Fingerprint.includes('sdk_gphone') ||
    Model.startsWith('sdk_') ||
    Model.includes('Emulator') ||
    Model.includes('Android SDK built for') ||
    Brand.startsWith('generic')
  );
};

/**
 * Resolves the API base URL.
 *
 * Order: an explicit EXPO_PUBLIC_API_URL, then the Android emulator alias, then
 * the host that served the Expo bundle (so a physical device reaches the dev
 * machine rather than its own loopback), then platform loopback defaults.
 */
const resolveBaseUrl = (): string => {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/+$/, '');

  if (isAndroidEmulator()) return 'http://10.0.2.2:5000/api/v1';

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:5000/api/v1`;
    }
  }

  return Platform.OS === 'android'
    ? 'http://10.0.2.2:5000/api/v1'
    : 'http://localhost:5000/api/v1';
};

export const API_BASE_URL = resolveBaseUrl();

/**
 * Long enough for a write that touches several tables.
 *
 * Placing an order is not one query: it creates the order, splits it into a
 * shipment per pharmacy, reserves stock on each shelf, books the lab tests and
 * opens a payment — each a round trip to a managed database that may be an
 * ocean away, and which reconnects from cold after idling. Fifteen seconds was
 * comfortably under that, so a perfectly good order came back as "cannot reach
 * the server" while the server was busy completing it.
 *
 * Timing out a write is the worst kind of failure: the client cannot tell a
 * request that never arrived from one that succeeded after it stopped
 * listening. The cheap half of the fix is to wait long enough that it rarely
 * happens; the other half is `errorMessage` below, which stops claiming failure
 * when it does not know.
 */
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
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

  /**
   * A timeout is not a failure — it is an unknown.
   *
   * The request left the device and no answer came back in time, which means
   * the server may well have completed it. Saying "could not place the order"
   * is a claim we cannot support, and it is the dangerous direction to be wrong
   * in: a patient told their order failed will place it again, and the first
   * one is already on its way. Point them at the place that holds the truth
   * instead.
   */
  if (axiosErr?.code === 'ECONNABORTED' || /timeout/i.test(axiosErr?.message ?? '')) {
    return 'This is taking longer than usual, so we lost track of it. Check your orders before trying again — it may already have gone through.';
  }

  if (axiosErr?.message === 'Network Error') {
    return `Cannot reach the server at ${API_BASE_URL}. Is the backend running?`;
  }
  return axiosErr?.message || fallback;
};

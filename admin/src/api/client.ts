import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

/**
 * In development Vite proxies /api to the backend, so a relative base URL keeps
 * the panel same-origin. A deployed panel points at the API host explicitly.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');

/**
 * Tokens are no longer written to localStorage.
 *
 * Both used to live there, where any script on the page can read them — and the
 * refresh token is a seven-day key to an account that can read every patient
 * record on the platform. One XSS, in the panel or in anything it imports, and
 * that key walks out; the access token expiring in fifteen minutes is no help
 * when the thief can mint a new one all week.
 *
 * The refresh token is now an httpOnly cookie the server sets, which JavaScript
 * cannot read at all. The access token stays in a module variable: an XSS can
 * still use it while the tab is open, which is unavoidable for a token the app
 * has to attach to requests, but it dies on reload and takes nothing with it.
 *
 * The cost is that a refresh happens on load rather than reading a stored
 * token — one extra round trip, in exchange for the long-lived credential
 * never being reachable from script.
 */
let accessToken: string | null = null;

export const tokens = {
  access: () => accessToken,
  save(access: string) {
    accessToken = access;
  },
  clear() {
    accessToken = null;
  },
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
  // Sends the httpOnly refresh cookie on the auth calls that need it.
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokens.access();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

let refreshInFlight: Promise<string | null> | null = null;

/**
 * No token is sent: the browser attaches the httpOnly cookie itself, which is
 * the point — the panel cannot read the credential it authenticates with.
 */
const refreshAccessToken = async (): Promise<string | null> => {
  try {
    // Bare axios — using `api` would recurse through this interceptor.
    const res = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    tokens.save(res.data.tokens.accessToken);
    return res.data.tokens.accessToken as string;
  } catch {
    tokens.clear();
    return null;
  }
};

/** Restores a session on page load from the cookie alone. */
export const restoreSession = refreshAccessToken;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };

    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;

    // Collapse concurrent 401s into one refresh round trip.
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

export const errorMessage = (err: unknown, fallback = 'Something went wrong.'): string => {
  const axiosErr = err as AxiosError<{ error?: string; details?: { message: string }[] }>;
  const data = axiosErr?.response?.data;

  if (data?.details?.length) return data.details[0]!.message;
  if (data?.error) return data.error;
  if (axiosErr?.message === 'Network Error') {
    return `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`;
  }
  return axiosErr?.message || fallback;
};

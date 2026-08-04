import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

/**
 * In development Vite proxies /api to the backend, so a relative base URL keeps
 * the panel same-origin. A deployed panel points at the API host explicitly.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');

const ACCESS_KEY = 'hb.admin.accessToken';
const REFRESH_KEY = 'hb.admin.refreshToken';

export const tokens = {
  access: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  save(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
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

const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = tokens.refresh();
  if (!refreshToken) return null;

  try {
    // Bare axios — using `api` would recurse through this interceptor.
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    tokens.save(res.data.tokens.accessToken, res.data.tokens.refreshToken);
    return res.data.tokens.accessToken as string;
  } catch {
    tokens.clear();
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

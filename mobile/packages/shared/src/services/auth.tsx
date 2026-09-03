import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { api, setSessionExpiredHandler, errorMessage } from './api';
import * as tokenStore from './tokenStore';
import { registerForPushNotifications, unregisterPushToken } from './notifications';
import type { AppId, Role } from './endpoints';

export type { Role };

export interface AuthUser {
  id: string;
  phoneNumber: string;
  role: Role;
  fullName: string | null;
}

interface AuthState {
  user: AuthUser | null;
  bootstrapping: boolean;
  /** Phone number awaiting OTP entry, if any. */
  pendingPhone: string | null;
  /** Only populated when the backend runs with EXPOSE_DEV_OTP=true. */
  devOtp: string | null;
  /** `fullName` is applied to the profile once verification succeeds (sign-up). */
  requestOtp: (phoneNumber: string, fullName?: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<AuthUser>;
  resendOtp: () => Promise<void>;
  cancelOtp: () => void;
  /**
   * Re-reads the session from the server. Roles are resolved from the database
   * on refresh, so this is how a newly approved provider picks up their role
   * without signing out and back in.
   */
  refreshSession: () => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  /** Which app this is, so push notifications reach the right install. */
  appId: AppId;
}> = ({ children, appId }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  /** Name captured during sign-up, applied to the profile after verification. */
  const pendingName = useRef<string | null>(null);
  const pushToken = useRef<string | null>(null);

  const signOut = useCallback(async () => {
    // Drop the push registration first so a signed-out device stops receiving
    // this account's notifications.
    if (pushToken.current) {
      await unregisterPushToken(pushToken.current).catch(() => undefined);
      pushToken.current = null;
    }

    /**
     * Tell the server, not just the keychain.
     *
     * Clearing the local tokens is what signing out *looks* like, but the
     * refresh token is a bearer credential the server had no record of
     * cancelling — on its own, forgetting it locally left a working seven-day
     * key to the account in whatever logs, backups or clipboards it had already
     * reached. Posting it back revokes every session on the account.
     *
     * Best-effort on purpose: someone signing out on a train with no signal
     * must still end up signed out on the device. The local clear below is
     * unconditional.
     */
    const refreshToken = await tokenStore.getRefreshToken().catch(() => null);
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }

    await tokenStore.clearTokens();
    setUser(null);
    setPendingPhone(null);
    setDevOtp(null);
  }, []);

  /** Push registration is best-effort — never block a login on it. */
  const attachPush = useCallback(async () => {
    try {
      const token = await registerForPushNotifications(appId);
      if (token) pushToken.current = token;
    } catch {
      /* notifications are optional */
    }
  }, [appId]);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    const refreshToken = await tokenStore.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await api.post('/auth/refresh', { refreshToken });
      await tokenStore.saveTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
      setUser(res.data.user);
      return res.data.user as AuthUser;
    } catch {
      await tokenStore.clearTokens();
      setUser(null);
      return null;
    }
  }, []);

  // Restore a stored session on cold start.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const hasToken = await tokenStore.hydrate();
        if (!hasToken) return;

        // Refresh rather than trusting the stored access token, which may have
        // expired while the app was closed.
        const restored = await refreshSession();
        if (restored && !cancelled) void attachPush();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshSession, attachPush]);

  // Drop the session when a refresh fails mid-flight.
  useEffect(() => {
    setSessionExpiredHandler(() => void signOut());
    return () => setSessionExpiredHandler(null);
  }, [signOut]);

  const requestOtp = useCallback(async (phoneNumber: string, fullName?: string) => {
    const res = await api.post('/auth/send-otp', { phoneNumber });
    setPendingPhone(res.data.phoneNumber ?? phoneNumber);
    setDevOtp(res.data.devOtp ?? null);
    pendingName.current = fullName?.trim() || null;
  }, []);

  const resendOtp = useCallback(async () => {
    if (!pendingPhone) throw new Error('No verification in progress.');
    const res = await api.post('/auth/send-otp', { phoneNumber: pendingPhone });
    setDevOtp(res.data.devOtp ?? null);
  }, [pendingPhone]);

  const verifyOtp = useCallback(
    async (otp: string) => {
      if (!pendingPhone) throw new Error('No verification in progress.');

      const res = await api.post('/auth/verify-otp', { phoneNumber: pendingPhone, otp });
      await tokenStore.saveTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);

      let authUser = res.data.user as AuthUser;

      // Apply the sign-up name now that we hold a token. A failure here must
      // not block login — the profile can always be edited later.
      if (pendingName.current && authUser.role === 'PATIENT') {
        try {
          const updated = await api.put('/patients/me', { fullName: pendingName.current });
          authUser = { ...authUser, fullName: updated.data.patient.fullName };
        } catch {
          /* non-fatal */
        }
        pendingName.current = null;
      }

      setUser(authUser);
      setPendingPhone(null);
      setDevOtp(null);
      void attachPush();
      return authUser;
    },
    [pendingPhone, attachPush]
  );

  const cancelOtp = useCallback(() => {
    setPendingPhone(null);
    setDevOtp(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      bootstrapping,
      pendingPhone,
      devOtp,
      requestOtp,
      verifyOtp,
      resendOtp,
      cancelOtp,
      refreshSession,
      signOut,
    }),
    [
      user,
      bootstrapping,
      pendingPhone,
      devOtp,
      requestOtp,
      verifyOtp,
      resendOtp,
      cancelOtp,
      refreshSession,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
};

export { errorMessage };

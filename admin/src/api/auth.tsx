import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setSessionExpiredHandler, tokens } from './client';
import { refreshSession, sendOtp, verifyOtp, endSession, type Role } from './endpoints';

export interface AdminUser {
  id: string;
  phoneNumber: string;
  role: Role;
  fullName: string | null;
}

interface AuthState {
  user: AdminUser | null;
  bootstrapping: boolean;
  pendingPhone: string | null;
  devOtp: string | null;
  requestOtp: (phoneNumber: string) => Promise<void>;
  submitOtp: (otp: string) => Promise<AdminUser>;
  cancelOtp: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const signOut = useCallback(() => {
    // Ask the server to drop the cookie too — clearing only the in-memory
    // token would leave a working refresh credential in the browser.
    void endSession().catch(() => undefined);
    tokens.clear();
    setUser(null);
    setPendingPhone(null);
    setDevOtp(null);
  }, []);

  /**
   * A session is restored by asking, not by reading.
   *
   * There is no stored token to check any more — the refresh credential is an
   * httpOnly cookie this code cannot see. So every load attempts a refresh and
   * treats failure as "not signed in". One round trip on load, in exchange for
   * the long-lived credential being unreachable from script.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await refreshSession();
        if (!cancelled) setUser(res.user);
      } catch {
        tokens.clear();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(signOut);
    return () => setSessionExpiredHandler(null);
  }, [signOut]);

  const requestOtp = useCallback(async (phoneNumber: string) => {
    const res = await sendOtp(phoneNumber);
    setPendingPhone(res.phoneNumber ?? phoneNumber);
    setDevOtp(res.devOtp ?? null);
  }, []);

  const submitOtp = useCallback(
    async (otp: string) => {
      if (!pendingPhone) throw new Error('No verification in progress.');

      const res = await verifyOtp(pendingPhone, otp);
      // Only the access token is held, and only in memory.
      tokens.save(res.tokens.accessToken);
      setUser(res.user);
      setPendingPhone(null);
      setDevOtp(null);
      return res.user;
    },
    [pendingPhone]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      bootstrapping,
      pendingPhone,
      devOtp,
      requestOtp,
      submitOtp,
      cancelOtp: () => {
        setPendingPhone(null);
        setDevOtp(null);
      },
      signOut,
    }),
    [user, bootstrapping, pendingPhone, devOtp, requestOtp, submitOtp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
};

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setSessionExpiredHandler, tokens } from './client';
import { refreshSession, sendOtp, verifyOtp, type Role } from './endpoints';

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
    tokens.clear();
    setUser(null);
    setPendingPhone(null);
    setDevOtp(null);
  }, []);

  useEffect(() => {
    const refreshToken = tokens.refresh();
    if (!refreshToken) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await refreshSession(refreshToken);
        tokens.save(res.tokens.accessToken, res.tokens.refreshToken);
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
      tokens.save(res.tokens.accessToken, res.tokens.refreshToken);
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

import React, { useState } from 'react';
import { useAuth } from '../api/auth';
import { errorMessage } from '../api/client';

/**
 * Admin sign-in.
 *
 * Authentication is the same phone-OTP flow as every other app; what makes this
 * an admin panel is the ADMIN role on the resulting session, which the server
 * enforces on each request. A non-admin who signs in here simply finds every
 * endpoint returns 403 — the panel says so rather than showing empty tables.
 */
export const Login: React.FC = () => {
  const { pendingPhone, devOtp, requestOtp, submitOtp, cancelOtp } = useAuth();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestOtp(phone.trim());
    } catch (err) {
      setError(errorMessage(err, 'Could not send the verification code.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await submitOtp(otp.trim());
      if (user.role !== 'ADMIN') {
        setError(
          `This account is a ${user.role.replace(/_/g, ' ').toLowerCase()}, not an administrator. Use the mobile app instead.`
        );
      }
    } catch (err) {
      setError(errorMessage(err, 'Verification failed.'));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand">Health Buddy</div>
        <h2 style={{ marginBottom: 18 }}>Admin panel</h2>

        {error ? <div className="banner error">{error}</div> : null}

        {!pendingPhone ? (
          <form onSubmit={send}>
            <div className="field">
              <label htmlFor="phone">Registered mobile number</label>
              <input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                autoComplete="tel"
                autoFocus
              />
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            {devOtp ? (
              <div className="banner info">
                Development code: <strong>{devOtp}</strong>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="otp">6-digit code sent to {pendingPhone}</label>
              <input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                autoFocus
              />
            </div>

            <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              className="btn outline"
              type="button"
              onClick={cancelOtp}
              style={{ width: '100%', marginTop: 10 }}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

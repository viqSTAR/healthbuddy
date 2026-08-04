import React, { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';

/* ---------- Async data ---------- */

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Fetch-on-mount with a stale-request guard, mirroring the mobile `useAsync`. */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

/* ---------- Presentation ---------- */

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  PATIENT: 'neutral',
  DOCTOR: 'info',
  PHARMACY: 'success',
  LAB_PARTNER: 'warning',
  LAB: 'warning',
  ADMIN: 'danger',
};

export const Badge: React.FC<{ label: string; tone?: Tone }> = ({ label, tone }) => (
  <span className={`badge ${tone ?? STATUS_TONE[label] ?? 'neutral'}`}>
    {label.replace(/_/g, ' ')}
  </span>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="state">
    <h3>{label}</h3>
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="state">
    <h3>Something went wrong</h3>
    <p>{message}</p>
    {onRetry ? (
      <button className="btn outline" onClick={onRetry}>
        Try again
      </button>
    ) : null}
  </div>
);

export const EmptyState: React.FC<{ title: string; message?: string }> = ({ title, message }) => (
  <div className="state">
    <h3>{title}</h3>
    {message ? <p>{message}</p> : null}
  </div>
);

export const formatDate = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const daysUntil = (iso: string | null | undefined): number | null =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;

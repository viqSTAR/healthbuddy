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

/* ---------- Money ---------- */

/**
 * Rupees, always with both decimal places.
 *
 * Truncating "₹1,240.00" to "₹1,240" saves two characters and costs an
 * operator the ability to scan a column for a rounding error, which is most of
 * why they are looking at a money column at all.
 */
export const money = (amount: number | null | undefined): string =>
  `₹${(amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Compact ages for a dispatch board: "4m", "2h 10m", "3d". */
export const duration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / (60 * 24))}d`;
};

/* ---------- Status tones ---------- */

const OPERATIONAL_TONE: Record<string, Tone> = {
  // Orders
  PENDING_PAYMENT: 'warning',
  PLACED: 'info',
  ACCEPTED: 'info',
  PROCESSING: 'info',
  DISPATCHED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'danger',
  // Lab orders
  BOOKED: 'info',
  SAMPLE_COLLECTED: 'warning',
  COMPLETED: 'success',
  // Appointments
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  // Payments
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'neutral',
  SETTLED: 'success',
  REVERSED: 'danger',
  // Emergencies
  RAISED: 'danger',
  EN_ROUTE: 'warning',
  ARRIVED: 'warning',
  RESOLVED: 'success',
  // Drug scheduling — the two that may never be sold online read as danger.
  OTC: 'success',
  SCHEDULE_H: 'warning',
  SCHEDULE_H1: 'warning',
  SCHEDULE_X: 'danger',
  NARCOTIC: 'danger',
  PROHIBITED: 'danger',
  LIST_O: 'success',
  LIST_A: 'info',
  LIST_B: 'warning',
};

/** A badge that already knows what every status in the domain means. */
export const Status: React.FC<{ value: string | null | undefined; tone?: Tone }> = ({
  value,
  tone,
}) => (value ? <Badge label={value} tone={tone ?? OPERATIONAL_TONE[value]} /> : <>—</>);

/* ---------- Layout ---------- */

export const PageHead: React.FC<{
  title: string;
  lead?: string;
  actions?: React.ReactNode;
}> = ({ title, lead, actions }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
    </div>
    {actions ? <div className="row-actions">{actions}</div> : null}
  </div>
);

export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: boolean;
  tone?: Tone;
  onClick?: () => void;
}> = ({ label, value, hint, accent, tone, onClick }) => (
  <div
    className={`stat${accent ? ' accent' : ''}${tone ? ` tone-${tone}` : ''}${onClick ? ' clickable' : ''}`}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
  >
    <div className="value">{value}</div>
    <div className="label">{label}</div>
    {hint ? <div className="hint">{hint}</div> : null}
  </div>
);

/** A definition list for a record's fields. Nulls render as an em dash. */
export const Facts: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl className="detail-list">
    {rows.map(([term, value]) => (
      <React.Fragment key={term}>
        <dt>{term}</dt>
        <dd>{value === null || value === undefined || value === '' ? '—' : value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/* ---------- Search ---------- */

/**
 * A search box whose value only reaches the caller once typing settles.
 *
 * Without the delay every keystroke is a round trip, and on a slow connection
 * the results that land are for a prefix the operator has already moved past.
 */
export const useDebounced = <T,>(value: T, ms = 350): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
};

export const SearchBox: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'Search…' }) => (
  <input
    type="search"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
    style={{ minWidth: 260 }}
  />
);

/* ---------- Pagination ---------- */

export const Pager: React.FC<{
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}> = ({ page, limit, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="pager">
      <span>
        {first}–{last} of {total.toLocaleString()}
      </span>
      <div className="row-actions">
        <button className="btn outline sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="btn outline sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
};

/* ---------- Drawer ---------- */

/**
 * A record opens beside the list rather than replacing it.
 *
 * Working a queue means checking one row and going back to the next; a full
 * page navigation loses the filter, the scroll position and the operator's
 * place in the list every single time.
 */
export const Drawer: React.FC<{
  open: boolean;
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, title, subtitle, onClose, children, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          <button className="btn outline sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </aside>
    </>
  );
};

/* ---------- Tabs ---------- */

export const Tabs: React.FC<{
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="tabs">
    {tabs.map((t) => (
      <button
        key={t.key}
        className={`tab${t.key === active ? ' active' : ''}`}
        onClick={() => onChange(t.key)}
      >
        {t.label}
        {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
      </button>
    ))}
  </div>
);

/* ---------- List body ---------- */

/**
 * The loading / error / empty / content decision, made once.
 *
 * Every list page needs all four states, and the ones that get skipped when
 * each page hand-rolls them are the empty and error branches — the two an
 * operator actually hits when something is wrong.
 *
 * `isEmpty` is asked of the loaded data rather than assumed, because the shape
 * differs per page: some return `{ orders: [] }`, some a board of lanes.
 */
export function Resource<T>({
  state,
  isEmpty,
  emptyTitle = 'Nothing matches those filters',
  emptyMessage,
  children,
}: {
  state: AsyncState<T>;
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  children: (data: T) => React.ReactNode;
}): React.ReactElement {
  // Keep showing the previous page while the next one loads: a table that
  // blanks on every filter change is far harder to work than a stale one.
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) return <EmptyState title={emptyTitle} />;
  if (isEmpty?.(state.data)) {
    return <EmptyState title={emptyTitle} {...(emptyMessage ? { message: emptyMessage } : {})} />;
  }
  return <>{children(state.data)}</>;
}

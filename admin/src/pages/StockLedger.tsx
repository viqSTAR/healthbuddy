import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, ErrorState, Loading, formatDateTime, useAsync } from '../components/ui';
import { fetchStockMovements, type StockMovementReason } from '../api/endpoints';

/**
 * Stock movement across the whole platform, and the way into one shop.
 *
 * The reason this is an admin page at all: expired and damaged stock is where
 * shrinkage hides. A partner who writes off 300 units a month is either running
 * a badly managed cold chain or is not really writing them off — and neither is
 * visible if stock is just a number a shop edits.
 *
 * What this view is *not* good for is acting on any of it. Every movement from
 * every shop in one list answers "how much shrinkage is there overall" and no
 * other question, and the question an operator actually arrives with is about a
 * particular shop. So the pharmacy column is a link: the platform-wide view
 * spots the pattern, the shop's own page — where its shelf can be edited — is
 * where something gets done about it.
 */

const REASONS: { value: StockMovementReason | ''; label: string }[] = [
  { value: '', label: 'All movements' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'SALE_OFFLINE', label: 'Sold at the counter' },
  { value: 'CORRECTION', label: 'Recount correction' },
  { value: 'PURCHASE', label: 'Stock received' },
  { value: 'RETURN', label: 'Customer return' },
  { value: 'SALE_ONLINE', label: 'Dispatched on an order' },
  { value: 'ORDER_CANCELLED', label: 'Reservation released' },
];

const TONE: Record<StockMovementReason, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  PURCHASE: 'success',
  RETURN: 'success',
  SALE_ONLINE: 'info',
  SALE_OFFLINE: 'info',
  CORRECTION: 'warning',
  EXPIRED: 'danger',
  DAMAGED: 'danger',
  ORDER_CANCELLED: 'neutral',
};

const label = (reason: StockMovementReason) =>
  reason
    .split('_')
    .map((w) => w[0]! + w.slice(1).toLowerCase())
    .join(' ');

export const StockLedger: React.FC = () => {
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [page, setPage] = useState(1);

  const movements = useAsync(
    () => fetchStockMovements({ ...(reason ? { reason } : {}), page, limit: 50 }),
    [reason, page]
  );

  if (movements.loading) return <Loading label="Loading stock movements" />;
  if (movements.error) return <ErrorState message={movements.error} onRetry={movements.reload} />;

  const rows = movements.data?.movements ?? [];
  const total = movements.data?.total ?? 0;

  // Written-off units, so the number that matters is not buried in the list.
  const writtenOff = rows
    .filter((m) => m.reason === 'EXPIRED' || m.reason === 'DAMAGED')
    .reduce((sum, m) => sum + Math.abs(m.delta), 0);

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Stock ledger</h1>
          <p className="sub">
            Every change to every pharmacy's stock, with the reason given. Open a shop to
            see its own shelf and adjust it.
          </p>
        </div>
      </header>

      {writtenOff > 0 ? (
        <div className="banner warning">
          {writtenOff} unit(s) written off as expired or damaged on this page.
        </div>
      ) : null}

      <div className="toolbar">
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as StockMovementReason | '');
            setPage(1);
          }}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="sub">{total} movement(s)</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No movements"
          message="Stock changes will appear here as partners record them."
        />
      ) : (
        <>
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Pharmacy</th>
                <th>Medicine</th>
                <th>Reason</th>
                <th>Change</th>
                <th>Balance</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="sub">{formatDateTime(m.createdAt)}</td>
                  <td>
                    <Link to={`/pharmacies/${m.pharmacyId}`}>{m.pharmacyName}</Link>
                  </td>
                  <td>
                    <strong>{m.medicineName}</strong>
                    {m.batchNumber ? (
                      <div className="sub">Batch {m.batchNumber}</div>
                    ) : null}
                  </td>
                  <td>
                    <Badge label={label(m.reason)} tone={TONE[m.reason]} />
                  </td>
                  <td
                    style={{
                      color:
                        m.delta > 0
                          ? 'var(--success-dark)'
                          : m.delta < 0
                            ? 'var(--error)'
                            : 'var(--caption)',
                      fontWeight: 600,
                    }}
                  >
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                  </td>
                  <td>{m.balanceAfter}</td>
                  <td className="sub">{m.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <div className="toolbar">
            <button className="btn outline sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="sub">Page {page}</span>
            <button
              className="btn outline sm"
              disabled={page * 50 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

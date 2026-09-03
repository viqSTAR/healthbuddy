import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchRetentionReport, runRetentionSweep, type RetentionReport } from '../api/endpoints';
import { ErrorState, Loading, useAsync } from '../components/ui';

/**
 * The retention position, and the button that acts on it.
 *
 * The sweep runs nightly from a scheduler. This page exists because the numbers
 * it produces need somewhere to be *seen*: the "awaiting review" column is
 * records past their statutory floor, which the job deliberately never deletes
 * on its own, and a count nobody looks at is the same as no count at all.
 */

const SWEEP_COPY: Record<string, { label: string; note: string }> = {
  notifications: {
    label: 'Notifications',
    note: 'Older than 90 days. A copy of information held properly elsewhere.',
  },
  staleDeviceTokens: {
    label: 'Dead device registrations',
    note: 'Nothing has used these in 180 days — reinstalled or discarded phones.',
  },
  processedWebhookEvents: {
    label: 'Processed gateway webhooks',
    note: 'Older than a year. Unprocessed ones are never removed — those are bugs.',
  },
  healthTipDeliveries: {
    label: 'Health tip delivery records',
    note: 'Older than a year. Only used to avoid re-sending the same tip.',
  },
};

const REVIEW_COPY: Record<string, { label: string; note: string }> = {
  consultations: { label: 'Consultations', note: 'Past the 3-year clinical floor' },
  prescriptions: { label: 'Prescriptions', note: 'Past the 3-year clinical floor' },
  labOrders: { label: 'Lab bookings', note: 'Past the 3-year clinical floor' },
  payments: { label: 'Payments', note: 'Past the 8-year accounting floor' },
  auditEntries: { label: 'Audit entries', note: 'Past the 8-year floor' },
};

export const Retention: React.FC = () => {
  const report = useAsync(() => fetchRetentionReport(), []);
  const [applied, setApplied] = useState<RetentionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Confirmed by typing, like the account-closure control.
   *
   * Running this by hand deletes rows immediately. It is a safe operation by
   * design — nothing under a statutory floor is touched — but "safe by design"
   * is a claim about the code, and the person clicking should still have meant
   * it.
   */
  const sweep = async () => {
    const pending = report.data;
    if (!pending) return;

    const total = Object.values(pending.swept).reduce((a, b) => a + b, 0);
    if (total === 0) {
      setError('Nothing is currently past its retention period.');
      return;
    }
    if (window.prompt(`Delete ${total} expired row(s)? Type SWEEP to confirm:`) !== 'SWEEP') return;

    setBusy(true);
    setError(null);
    try {
      setApplied(await runRetentionSweep(true));
      report.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The table always shows what is *pending*, never what was just swept.
   *
   * Letting the applied result take over looked right and read completely
   * wrong: straight after a sweep the table showed the rows it had deleted,
   * under a heading promising what would be removed tonight — so a successful
   * sweep appeared to have done nothing. The applied result belongs in the
   * banner, which says what happened; the table answers what is left.
   */
  const shown = report.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Retention</h1>
          <p>
            What the retention policy would remove tonight, and what has passed its statutory
            floor. Records under a floor are counted here and deleted by a person — never by
            the job, because a timer that erases medical records is one wrong constant away
            from something nobody can undo.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {applied ? (
        <div className="banner">
          Swept at {new Date(applied.ranAt).toLocaleString()} —{' '}
          {Object.values(applied.swept).reduce((a, b) => a + b, 0)} row(s) removed.
        </div>
      ) : null}

      {report.loading ? (
        <Loading label="Reading the retention position" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Swept automatically</th>
                  <th>Rows</th>
                  <th>Rule</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(shown!.swept).map(([key, count]) => (
                  <tr key={key}>
                    <td>
                      <strong>{SWEEP_COPY[key]?.label ?? key}</strong>
                    </td>
                    <td className="mono">{count}</td>
                    <td>
                      <span className="sub">{SWEEP_COPY[key]?.note ?? ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar">
            <button className="btn danger" onClick={() => void sweep()} disabled={busy}>
              {busy ? 'Sweeping…' : 'Run the sweep now'}
            </button>
            <button className="btn outline" onClick={report.reload}>
              Refresh
            </button>
            <span className="sub">
              Normally runs nightly from the scheduler — see deploy/README.md.
            </span>
          </div>

          <div className="page-head" style={{ marginTop: 32 }}>
            <div>
              <h2>Past their statutory floor</h2>
              <p>
                Deletion is now <em>permitted</em> for these, not automatic. Someone has to
                decide, and this is the number they need in order to decide.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Record type</th>
                  <th>Eligible</th>
                  <th>Floor</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(shown!.awaitingReview).map(([key, count]) => (
                  <tr key={key}>
                    <td>
                      <strong>{REVIEW_COPY[key]?.label ?? key}</strong>
                    </td>
                    <td className="mono">{count}</td>
                    <td>
                      <span className="sub">{REVIEW_COPY[key]?.note ?? ''}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
};

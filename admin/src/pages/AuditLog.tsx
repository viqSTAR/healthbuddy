import React, { useState } from 'react';
import { fetchAuditLogs } from '../api/endpoints';
import { Badge, EmptyState, ErrorState, Loading, formatDateTime, useAsync } from '../components/ui';

const ACTIONS = [
  'application.submitted',
  'application.approved',
  'application.rejected',
  'prescription.issued',
  'document.read',
  'user.suspended',
  'user.restored',
];

const TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  'application.approved': 'success',
  'application.rejected': 'danger',
  'application.submitted': 'info',
  'prescription.issued': 'info',
  'document.read': 'neutral',
  'user.suspended': 'danger',
  'user.restored': 'success',
};

/**
 * The append-only record of privileged actions.
 *
 * Role grants, application decisions and reads of patient documents all land
 * here. For a system that carries prescriptions and health records this is
 * evidence, not telemetry — which is why nothing in the panel can delete it.
 */
export const AuditLog: React.FC = () => {
  const [action, setAction] = useState('');

  const logs = useAsync(
    () => fetchAuditLogs({ ...(action ? { action } : {}), limit: 100 }),
    [action]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>
            Who granted which role, who decided an application, and who opened a patient's documents.
            Append-only — entries cannot be edited or removed from here.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className="btn outline" onClick={logs.reload}>
          Refresh
        </button>
      </div>

      {logs.loading ? (
        <Loading label="Loading audit log" />
      ) : logs.error ? (
        <ErrorState message={logs.error} onRetry={logs.reload} />
      ) : logs.data!.logs.length === 0 ? (
        <EmptyState
          title="No entries yet"
          message="Privileged actions will be recorded here as they happen."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Detail</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.data!.logs.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <Badge label={entry.action} tone={TONE[entry.action] ?? 'neutral'} />
                  </td>
                  <td>
                    {entry.actor ? (
                      <>
                        <span className="mono">{entry.actor.phoneNumber}</span>
                        <span className="sub">{entry.actor.role}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--caption)' }}>system</span>
                    )}
                  </td>
                  <td>
                    {entry.entityType}
                    <span className="sub mono">{entry.entityId.slice(0, 8)}…</span>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <span className="mono" style={{ wordBreak: 'break-word' }}>
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </span>
                  </td>
                  <td className="mono">{entry.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

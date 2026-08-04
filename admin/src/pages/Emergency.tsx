import React, { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Badge, EmptyState, ErrorState, Loading, formatDateTime, useAsync } from '../components/ui';

type EmergencyStatus = 'RAISED' | 'DISPATCHED' | 'EN_ROUTE' | 'ARRIVED' | 'RESOLVED' | 'CANCELLED';

interface EmergencySOS {
  id: string;
  patientId: string;
  latitude: number;
  longitude: number;
  status: EmergencyStatus;
  createdAt: string;
  patient?: {
    id: string;
    fullName: string;
    bloodGroup: string | null;
    emergencyContact: string | null;
  };
}

const fetchQueue = async () =>
  (await api.get<{ queue: EmergencySOS[] }>('/emergency/queue')).data.queue;

const updateStatus = async (id: string, status: EmergencyStatus) =>
  (await api.patch(`/emergency/${id}/status`, { status })).data;

/** The next dispatch step, so the common action is always one click. */
const NEXT: Partial<Record<EmergencyStatus, EmergencyStatus>> = {
  RAISED: 'DISPATCHED',
  DISPATCHED: 'EN_ROUTE',
  EN_ROUTE: 'ARRIVED',
  ARRIVED: 'RESOLVED',
};

const TONE: Record<EmergencyStatus, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  RAISED: 'danger',
  DISPATCHED: 'warning',
  EN_ROUTE: 'warning',
  ARRIVED: 'info',
  RESOLVED: 'success',
  CANCELLED: 'neutral',
};

/**
 * Live ambulance dispatch.
 *
 * This list carries patients' real-time coordinates, which is exactly why it is
 * ADMIN-only — it was previously readable by any authenticated account.
 */
export const Emergency: React.FC = () => {
  const queue = useAsync(fetchQueue, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const advance = async (sos: EmergencySOS, status: EmergencyStatus) => {
    setBusyId(sos.id);
    setError(null);
    try {
      await updateStatus(sos.id, status);
      queue.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Emergency dispatch</h1>
          <p>
            Unresolved SOS requests with live patient coordinates. Restricted to administrators.
          </p>
        </div>
        <button className="btn outline" onClick={queue.reload}>
          Refresh
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {queue.loading ? (
        <Loading label="Loading dispatch queue" />
      ) : queue.error ? (
        <ErrorState message={queue.error} onRetry={queue.reload} />
      ) : queue.data!.length === 0 ? (
        <EmptyState title="No active emergencies" message="Nothing needs dispatch right now." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Raised</th>
                <th>Patient</th>
                <th>Blood group</th>
                <th>Emergency contact</th>
                <th>Location</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data!.map((sos) => {
                const next = NEXT[sos.status];
                return (
                  <tr key={sos.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(sos.createdAt)}</td>
                    <td>
                      <strong>{sos.patient?.fullName ?? 'Unknown'}</strong>
                    </td>
                    <td>{sos.patient?.bloodGroup ?? '—'}</td>
                    <td className="mono">{sos.patient?.emergencyContact ?? '—'}</td>
                    <td>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${sos.latitude},${sos.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        {sos.latitude.toFixed(5)}, {sos.longitude.toFixed(5)}
                      </a>
                    </td>
                    <td>
                      <Badge label={sos.status} tone={TONE[sos.status]} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {next ? (
                          <button
                            className="btn sm"
                            onClick={() => void advance(sos, next)}
                            disabled={busyId === sos.id}
                          >
                            Mark {next.replace(/_/g, ' ').toLowerCase()}
                          </button>
                        ) : null}
                        <button
                          className="btn sm outline"
                          onClick={() => void advance(sos, 'CANCELLED')}
                          disabled={busyId === sos.id}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

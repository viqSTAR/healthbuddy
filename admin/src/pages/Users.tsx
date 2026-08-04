import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchUsers, setUserSuspended, type AdminUser, type Role } from '../api/endpoints';
import { useAuth } from '../api/auth';
import { Badge, EmptyState, ErrorState, Loading, formatDate, useAsync } from '../components/ui';

const ROLES: Role[] = ['PATIENT', 'DOCTOR', 'PHARMACY', 'LAB_PARTNER', 'ADMIN'];

const displayName = (user: AdminUser): string =>
  user.patient?.fullName ??
  user.doctor?.name ??
  user.pharmacy?.name ??
  user.labPartner?.name ??
  '—';

export const Users: React.FC = () => {
  const { user: me } = useAuth();
  const [role, setRole] = useState<Role | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useAsync(
    () => fetchUsers({ ...(role ? { role } : {}), limit: 100 }),
    [role]
  );

  const toggleSuspension = async (user: AdminUser) => {
    const suspending = !user.isSuspended;
    const reason = suspending
      ? window.prompt('Reason for suspending this account (recorded in the audit log):')
      : undefined;

    if (suspending && reason === null) return;

    setBusyId(user.id);
    setError(null);
    try {
      await setUserSuspended(user.id, suspending, reason ?? undefined);
      list.reload();
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
          <h1>Users</h1>
          <p>
            Every account on the platform. Suspending a partner also deactivates their shop, so they
            stop receiving orders rather than merely losing sign-in.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="toolbar">
        <select value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      {list.loading ? (
        <Loading label="Loading users" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data!.users.length === 0 ? (
        <EmptyState title="No users match that filter" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Joined</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data!.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{displayName(user)}</strong>
                    {user.doctor?.specialty ? (
                      <span className="sub">{user.doctor.specialty}</span>
                    ) : null}
                  </td>
                  <td className="mono">{user.phoneNumber}</td>
                  <td>
                    <Badge label={user.role} />
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    {user.isSuspended ? (
                      <Badge label="SUSPENDED" tone="danger" />
                    ) : (
                      <Badge label="ACTIVE" tone="success" />
                    )}
                    {user.pharmacy && !user.pharmacy.isActive ? (
                      <>
                        {' '}
                        <Badge label="SHOP OFF" tone="neutral" />
                      </>
                    ) : null}
                  </td>
                  <td>
                    {/* Self-suspension is blocked server-side too — an admin
                        locking themselves out may have no one to undo it. */}
                    {user.id === me?.id ? (
                      <span style={{ color: 'var(--caption)', fontSize: 12 }}>You</span>
                    ) : (
                      <button
                        className={`btn sm ${user.isSuspended ? 'outline' : 'danger'}`}
                        onClick={() => void toggleSuspension(user)}
                        disabled={busyId === user.id}
                      >
                        {user.isSuspended ? 'Restore' : 'Suspend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

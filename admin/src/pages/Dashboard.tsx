import React from 'react';
import { Link } from 'react-router-dom';
import { fetchApplications, fetchExpiringLicences, fetchStats } from '../api/endpoints';
import { Badge, ErrorState, Loading, formatDate, formatDateTime, useAsync } from '../components/ui';

export const Dashboard: React.FC = () => {
  const stats = useAsync(fetchStats, []);
  const pending = useAsync(() => fetchApplications({ status: 'SUBMITTED', limit: 5 }), []);
  const licences = useAsync(() => fetchExpiringLicences(60), []);

  if (stats.loading) return <Loading label="Loading platform metrics" />;
  if (stats.error) return <ErrorState message={stats.error} onRetry={stats.reload} />;

  const s = stats.data!;
  const expiring = [
    ...(licences.data?.pharmacies ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      kind: 'Pharmacy',
      number: p.drugLicenceNumber,
      expiry: p.drugLicenceExpiry,
      expired: p.expired,
      isActive: p.isActive,
    })),
    ...(licences.data?.labs ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      kind: 'Lab',
      number: l.nablCertNumber,
      expiry: l.nablExpiry,
      expired: l.expired,
      isActive: l.isActive,
    })),
  ].sort((a, b) => (a.expiry ?? '').localeCompare(b.expiry ?? ''));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Live counts from the database, generated {formatDateTime(s.generatedAt)}.</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat accent">
          <div className="value">{pending.data?.total ?? 0}</div>
          <div className="label">Awaiting verification</div>
        </div>
        <div className="stat">
          <div className="value">{s.totalPatients}</div>
          <div className="label">Patients</div>
        </div>
        <div className="stat">
          <div className="value">{s.totalDoctors}</div>
          <div className="label">Doctors</div>
        </div>
        <div className="stat">
          <div className="value">{s.totalPharmacies}</div>
          <div className="label">Pharmacies</div>
        </div>
        <div className="stat">
          <div className="value">{s.totalLabs}</div>
          <div className="label">Labs</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{s.appointmentsToday}</div>
          <div className="label">Appointments today</div>
        </div>
        <div className="stat">
          <div className="value">{s.completedThisMonth}</div>
          <div className="label">Completed this month</div>
        </div>
        <div className="stat">
          <div className="value">{s.pendingMedicineOrders}</div>
          <div className="label">Open medicine orders</div>
        </div>
        <div className="stat">
          <div className="value">{s.pendingLabOrders}</div>
          <div className="label">Open lab bookings</div>
        </div>
        <div className="stat">
          <div className="value">₹{s.medicineRevenue.toLocaleString('en-IN')}</div>
          <div className="label">Medicine order value</div>
        </div>
      </div>

      {s.activeEmergencies > 0 ? (
        <div className="banner error">
          {s.activeEmergencies} unresolved emergency SOS request(s) on the platform right now.
        </div>
      ) : null}

      <h2 className="section-title">Waiting for review</h2>
      {pending.loading ? (
        <Loading />
      ) : (pending.data?.applications.length ?? 0) === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--caption)' }}>The verification queue is clear.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Type</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.data!.applications.map((app) => (
                <tr key={app.id}>
                  <td>
                    <strong>{app.displayName}</strong>
                    <span className="sub">{app.user?.phoneNumber}</span>
                  </td>
                  <td>
                    <Badge label={app.type} />
                  </td>
                  <td>{formatDateTime(app.submittedAt)}</td>
                  <td>
                    <Link className="btn sm outline" to={`/applications/${app.id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Surfaced on the landing page because an expired licence means the
        partner is no longer legally permitted to operate — pharmacies are
        suspended automatically, so this is the warning that precedes it.
      */}
      <h2 className="section-title">Licences expiring within 60 days</h2>
      {licences.loading ? (
        <Loading />
      ) : expiring.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--caption)' }}>No licences lapse in the next 60 days.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Kind</th>
                <th>Number</th>
                <th>Expires</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.kind}</td>
                  <td className="mono">{row.number ?? '—'}</td>
                  <td>{formatDate(row.expiry)}</td>
                  <td>
                    {row.expired ? (
                      <Badge label="EXPIRED" tone="danger" />
                    ) : (
                      <Badge label="EXPIRING" tone="warning" />
                    )}{' '}
                    {!row.isActive ? <Badge label="SUSPENDED" tone="neutral" /> : null}
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

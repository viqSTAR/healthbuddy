import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchApplications,
  type ApplicationStatus,
  type ApplicationType,
} from '../api/endpoints';
import { Badge, EmptyState, ErrorState, Loading, formatDateTime, useAsync } from '../components/ui';

const STATUSES: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];
const TYPES: ApplicationType[] = ['DOCTOR', 'PHARMACY', 'LAB'];

export const Applications: React.FC = () => {
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [type, setType] = useState<ApplicationType | ''>('');

  const queue = useAsync(
    () =>
      fetchApplications({
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        limit: 50,
      }),
    [status, type]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Verification queue</h1>
          <p>
            Every provider on the platform passes through here. Approving an application is what
            creates their profile and grants their role — submitting one grants nothing.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}>
          <option value="">All statuses (excluding drafts)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select value={type} onChange={(e) => setType(e.target.value as ApplicationType | '')}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <button className="btn outline" onClick={queue.reload}>
          Refresh
        </button>
      </div>

      {queue.loading ? (
        <Loading label="Loading applications" />
      ) : queue.error ? (
        <ErrorState message={queue.error} onRetry={queue.reload} />
      ) : queue.data!.applications.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          message="New partner and practitioner applications will appear here."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Type</th>
                <th>Status</th>
                <th>Licence / registration</th>
                <th>Docs</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.data!.applications.map((app) => (
                <tr key={app.id}>
                  <td>
                    <strong>{app.displayName}</strong>
                    <span className="sub">{app.user?.phoneNumber ?? '—'}</span>
                  </td>
                  <td>
                    <Badge label={app.type} />
                  </td>
                  <td>
                    <Badge label={app.status} />
                  </td>
                  <td className="mono">
                    {app.councilRegistrationNumber ??
                      app.drugLicenceNumber ??
                      app.labRegistrationNumber ??
                      '—'}
                  </td>
                  <td>{app.documents.length}</td>
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
    </>
  );
};

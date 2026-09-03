import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchDoctor,
  fetchAppointments,
  documentUrl,
  type AppointmentRow,
} from '../api/endpoints';
import {
  Badge,
  EmptyState,
  ErrorState,
  Facts,
  Loading,
  Pager,
  Stat,
  Status,
  Tabs,
  formatDate,
  formatDateTime,
  money,
  useAsync,
} from '../components/ui';

/**
 * One doctor, everything about them.
 *
 * The detail behind a provider used to live in a slide-out drawer over the
 * list. A drawer is right for a quick edit and wrong for a review: it cannot be
 * linked to, cannot be opened in a second tab beside the application it came
 * from, and gives a registration certificate a third of the screen. Deciding
 * whether someone may prescribe deserves a page.
 *
 * The two things an operator comes here for are the credentials — is this
 * person who they say they are — and the consultation history, which is where
 * a complaint gets checked. Both are first-class tabs rather than something to
 * scroll past.
 */

const KIND_LABEL: Record<string, string> = {
  DOCTOR_REGISTRATION_CERT: 'Council registration',
  DOCTOR_QUALIFICATION: 'Qualification',
  ID_PROOF: 'Identity proof',
  PROFILE_PHOTO: 'Profile photo',
  GST_CERTIFICATE: 'GST certificate',
  SHOP_ESTABLISHMENT: 'Shop establishment',
};

/**
 * A document thumbnail.
 *
 * The URL is minted per document and is short-lived — the bytes are health-
 * adjacent and authorised per request, so there is no persistent link to hold.
 */
const DocumentTile: React.FC<{
  doc: { id: string; kind: string; fileName: string; mimeType: string; sizeBytes: number };
  onOpen: (preview: { url: string; mimeType: string }) => void;
}> = ({ doc, onOpen }) => {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = doc.mimeType.startsWith('image/');

  useEffect(() => {
    let active = true;
    documentUrl(doc.id)
      .then((resolved) => {
        if (active) setUrl(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [doc.id]);

  return (
    <button
      className="doc-tile"
      onClick={() => url && onOpen({ url, mimeType: doc.mimeType })}
      disabled={!url}
      title={doc.fileName}
    >
      {isImage && url ? (
        <img src={url} alt={doc.fileName} />
      ) : (
        <div className="placeholder">{isImage ? 'Loading…' : 'PDF'}</div>
      )}
      <div className="meta">
        <strong>{KIND_LABEL[doc.kind] ?? doc.kind}</strong>
        <span>{Math.max(1, Math.round(doc.sizeBytes / 1024))} KB</span>
      </div>
    </button>
  );
};

/** Every consultation this doctor has held — not just the recent handful. */
const AppointmentsTab: React.FC<{ doctorId: string }> = ({ doctorId }) => {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const list = useAsync(
    () =>
      fetchAppointments({
        doctorId,
        ...(status ? { status } : {}),
        page,
        limit: 50,
      }),
    [doctorId, status, page]
  );

  return (
    <>
      <div className="toolbar">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Every consultation</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      {list.loading ? (
        <Loading label="Loading consultations" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data!.appointments.length === 0 ? (
        <EmptyState
          title="No consultations"
          message="This doctor has not held a consultation matching that filter."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Patient</th>
                <th>Type</th>
                <th>Status</th>
                <th>Booked</th>
              </tr>
            </thead>
            <tbody>
              {list.data!.appointments.map((a: AppointmentRow) => (
                <tr key={a.id}>
                  <td>
                    {a.slot ? (
                      <>
                        <strong>{a.slot.date}</strong>
                        <span className="sub">{a.slot.startTime}</span>
                      </>
                    ) : (
                      <span className="sub">—</span>
                    )}
                  </td>
                  <td>{a.patient?.fullName ?? <span className="sub">—</span>}</td>
                  <td>
                    <Badge label={a.type} tone={a.type === 'VIDEO' ? 'info' : 'neutral'} />
                  </td>
                  <td>
                    <Status value={a.status} />
                  </td>
                  <td>{formatDateTime(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} total={list.data?.total ?? 0} limit={50} onPage={setPage} />
    </>
  );
};

export const DoctorDetail: React.FC = () => {
  const { id = '' } = useParams();
  const [tab, setTab] = useState('credentials');
  const [preview, setPreview] = useState<{ url: string; mimeType: string } | null>(null);

  const state = useAsync(() => fetchDoctor(id), [id]);

  if (state.loading) return <Loading label="Loading doctor" />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;

  const { doctor, application, documents, upcomingSlots, appointmentsByStatus, earnings } =
    state.data!;

  const totalConsults = Object.values(appointmentsByStatus).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{doctor.name}</h1>
          <p>
            <Link to="/doctors">← All doctors</Link> · {doctor.specialty}
            {doctor.verifiedAt ? null : ' · unverified'}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="Consultations" value={String(totalConsults)} />
        <Stat label="Completed" value={String(appointmentsByStatus.COMPLETED ?? 0)} />
        <Stat
          label="Open slots"
          value={String(upcomingSlots)}
          tone={upcomingSlots === 0 ? 'warning' : undefined}
          hint={upcomingSlots === 0 ? 'Nothing bookable' : undefined}
        />
        <Stat label="Earned" value={money(earnings.total)} hint={`${earnings.legs} legs`} />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'credentials', label: 'Credentials', count: documents.length },
          { key: 'appointments', label: 'Consultations', count: totalConsults },
          { key: 'profile', label: 'Profile' },
        ]}
      />

      {tab === 'credentials' ? (
        <>
          <Facts
            rows={[
              ['Council registration', doctor.councilRegistrationNumber ?? '—'],
              ['Council', doctor.councilName ?? '—'],
              ['HPR id', doctor.hprId ?? '—'],
              ['Verified', doctor.verifiedAt ? formatDate(doctor.verifiedAt) : 'Not verified'],
              [
                'Application',
                application ? (
                  <Link to={`/applications/${application.id}`}>
                    {application.status} · submitted {formatDate(application.submittedAt)}
                  </Link>
                ) : (
                  'None on file'
                ),
              ],
            ]}
          />

          <h3>Documents ({documents.length})</h3>
          {documents.length === 0 ? (
            <EmptyState
              title="No documents"
              message="Nothing was uploaded, or it was attached to an application that has since been removed."
            />
          ) : (
            <div className="doc-grid">
              {documents.map((doc) => (
                <DocumentTile key={doc.id} doc={doc} onOpen={setPreview} />
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === 'appointments' ? <AppointmentsTab doctorId={id} /> : null}

      {tab === 'profile' ? (
        <Facts
          rows={[
            ['Specialty', doctor.specialty],
            ['Qualification', doctor.qualification ?? '—'],
            ['Experience', doctor.experienceYears ? `${doctor.experienceYears} years` : '—'],
            ['Consultation fee', money(doctor.consultationFee)],
            ['Clinic', doctor.clinicAddress ?? '—'],
            ['Accepting patients', doctor.isAvailable ? 'Yes' : 'No'],
            ['About', doctor.about ?? '—'],
          ]}
        />
      ) : null}

      {preview ? (
        <div className="lightbox" onClick={() => setPreview(null)} role="presentation">
          {preview.mimeType.startsWith('image/') ? (
            <img src={preview.url} alt="Document" />
          ) : (
            <iframe src={preview.url} title="Document" />
          )}
        </div>
      ) : null}
    </>
  );
};

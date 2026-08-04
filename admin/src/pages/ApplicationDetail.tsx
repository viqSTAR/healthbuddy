import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import {
  claimApplication,
  documentUrl,
  fetchApplication,
  reviewApplication,
  type DocumentRef,
  type ProviderApplication,
} from '../api/endpoints';
import { Badge, ErrorState, Loading, formatDate, formatDateTime, useAsync } from '../components/ui';

const KIND_LABEL: Record<string, string> = {
  DOCTOR_REGISTRATION_CERT: 'Council registration',
  DOCTOR_QUALIFICATION: 'Degree certificate',
  DRUG_LICENCE: 'Drug licence',
  PHARMACIST_CERT: 'Pharmacist certificate',
  LAB_REGISTRATION: 'Lab registration',
  NABL_CERTIFICATE: 'NABL certificate',
  GST_CERTIFICATE: 'GST certificate',
  SHOP_ESTABLISHMENT: 'Shop establishment',
  ID_PROOF: 'Photo ID',
  PREMISES_PHOTO: 'Premises photo',
};

/** Documents that must be present for the application to be approvable. */
const REQUIRED: Record<ProviderApplication['type'], string[]> = {
  DOCTOR: ['DOCTOR_REGISTRATION_CERT'],
  PHARMACY: ['DRUG_LICENCE'],
  LAB: ['LAB_REGISTRATION'],
};

/**
 * Review one application.
 *
 * This is the screen the whole panel exists for: a human looks at the uploaded
 * licence, checks it against the number typed into the form, and approves or
 * rejects. Approving is what creates the provider profile and grants the role —
 * nothing the applicant did could do that.
 */
export const ApplicationDetail: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const application = useAsync(() => fetchApplication(id), [id]);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; mimeType: string } | null>(null);

  if (application.loading) return <Loading label="Loading application" />;
  if (application.error) {
    return <ErrorState message={application.error} onRetry={application.reload} />;
  }

  const app = application.data!;
  const held = new Set(app.documents.map((d) => d.kind));
  const missing = REQUIRED[app.type].filter((kind) => !held.has(kind));
  const decided = app.status === 'APPROVED' || app.status === 'REJECTED';

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await claimApplication(app.id);
      application.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && reason.trim().length < 3) {
      setError('Give the applicant a reason they can act on.');
      return;
    }
    if (decision === 'APPROVE' && missing.length > 0) {
      setError(`Missing required document: ${missing.map((k) => KIND_LABEL[k] ?? k).join(', ')}.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await reviewApplication(app.id, decision, reason.trim() || undefined);
      navigate('/applications');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{app.displayName}</h1>
          <p>
            <Badge label={app.type} /> <Badge label={app.status} /> · applied{' '}
            {formatDateTime(app.submittedAt ?? app.createdAt)}
          </p>
        </div>
        <button className="btn outline" onClick={() => navigate('/applications')}>
          Back to queue
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {missing.length > 0 && !decided ? (
        <div className="banner warning">
          Required document not attached: {missing.map((k) => KIND_LABEL[k] ?? k).join(', ')}. Reject
          with a note asking for it.
        </div>
      ) : null}

      {app.status === 'REJECTED' && app.rejectionReason ? (
        <div className="banner error">Rejected: {app.rejectionReason}</div>
      ) : null}

      <div className="review-grid">
        <div>
          <div className="card">
            <h2>Submitted details</h2>
            <dl className="detail-list" style={{ marginTop: 14 }}>
              <dt>Contact</dt>
              <dd>
                {app.user?.phoneNumber ?? '—'}
                {app.contactEmail ? ` · ${app.contactEmail}` : ''}
              </dd>

              <dt>Address</dt>
              <dd>
                {app.address}
                {app.city ? `, ${app.city}` : ''}
                {app.state ? `, ${app.state}` : ''}
                {app.pincode ? ` ${app.pincode}` : ''}
              </dd>

              {app.type === 'DOCTOR' ? (
                <>
                  <dt>Council registration</dt>
                  <dd className="mono">{app.councilRegistrationNumber ?? '—'}</dd>
                  <dt>Issuing council</dt>
                  <dd>{app.councilName ?? '—'}</dd>
                  <dt>Qualification</dt>
                  <dd>{app.qualification ?? '—'}</dd>
                  <dt>Specialty</dt>
                  <dd>{app.specialty ?? '—'}</dd>
                  <dt>Experience</dt>
                  <dd>{app.experienceYears != null ? `${app.experienceYears} years` : '—'}</dd>
                  <dt>Consultation fee</dt>
                  <dd>{app.consultationFee != null ? `₹${app.consultationFee}` : '—'}</dd>
                  <dt>HPR ID</dt>
                  <dd className="mono">{app.hprId ?? 'not provided'}</dd>
                </>
              ) : null}

              {app.type === 'PHARMACY' ? (
                <>
                  <dt>Drug licence</dt>
                  <dd className="mono">{app.drugLicenceNumber ?? '—'}</dd>
                  <dt>Licence expiry</dt>
                  <dd>{formatDate(app.drugLicenceExpiry)}</dd>
                  <dt>GSTIN</dt>
                  <dd className="mono">{app.gstin ?? '—'}</dd>
                  <dt>Pharmacist</dt>
                  <dd>
                    {app.pharmacistName ?? '—'}
                    {app.pharmacistRegNumber ? ` (${app.pharmacistRegNumber})` : ''}
                  </dd>
                  <dt>HFR ID</dt>
                  <dd className="mono">{app.hfrId ?? 'not provided'}</dd>
                </>
              ) : null}

              {app.type === 'LAB' ? (
                <>
                  <dt>Lab registration</dt>
                  <dd className="mono">{app.labRegistrationNumber ?? '—'}</dd>
                  <dt>NABL accredited</dt>
                  <dd>
                    {app.nablAccredited
                      ? `Yes — ${app.nablCertNumber ?? 'no cert number'} (expires ${formatDate(app.nablExpiry)})`
                      : 'No'}
                  </dd>
                  <dt>Home collection</dt>
                  <dd>{app.homeCollection ? 'Offered' : 'Not offered'}</dd>
                  <dt>HFR ID</dt>
                  <dd className="mono">{app.hfrId ?? 'not provided'}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <h2 className="section-title">Documents ({app.documents.length})</h2>
          <div className="card">
            {app.documents.length === 0 ? (
              <p style={{ color: 'var(--caption)', margin: 0 }}>No documents attached.</p>
            ) : (
              <div className="doc-grid">
                {app.documents.map((doc) => (
                  <DocumentTile key={doc.id} doc={doc} onOpen={setPreview} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Decision</h2>

          {decided ? (
            <p style={{ color: 'var(--caption)' }}>
              Reviewed {formatDateTime(app.reviewedAt)}. No further action available.
            </p>
          ) : (
            <>
              {app.status === 'SUBMITTED' ? (
                <>
                  <p style={{ color: 'var(--caption)', marginTop: 8 }}>
                    Claim this application so another admin does not review it at the same time.
                  </p>
                  <button className="btn" onClick={claim} disabled={busy} style={{ width: '100%' }}>
                    Start review
                  </button>
                </>
              ) : (
                <>
                  <div className="field" style={{ marginTop: 14 }}>
                    <label htmlFor="reason">Note to applicant</label>
                    <textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Required when rejecting — the applicant sees this and acts on it."
                    />
                  </div>

                  <div className="row-actions">
                    <button
                      className="btn"
                      onClick={() => decide('APPROVE')}
                      disabled={busy || missing.length > 0}
                      style={{ flex: 1 }}
                    >
                      Approve &amp; grant role
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => decide('REJECT')}
                      disabled={busy}
                      style={{ flex: 1 }}
                    >
                      Reject
                    </button>
                  </div>

                  <p style={{ fontSize: 12, color: 'var(--caption)', marginTop: 14 }}>
                    Approving creates the provider profile and grants the{' '}
                    {app.type === 'LAB' ? 'LAB_PARTNER' : app.type} role. This is recorded in the
                    audit log against your account.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {preview ? (
        <div className="lightbox" onClick={() => setPreview(null)}>
          <button className="btn outline close" onClick={() => setPreview(null)}>
            Close
          </button>
          {preview.mimeType === 'application/pdf' ? (
            <iframe title="Document preview" src={preview.url} onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={preview.url} alt="Document" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      ) : null}
    </>
  );
};

/**
 * Thumbnails need a URL an <img> can load, so a short-lived signed link is
 * minted per document. The link expires in minutes — these are licence
 * documents, not public assets.
 */
const DocumentTile: React.FC<{
  doc: DocumentRef;
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

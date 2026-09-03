import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { fetchDoctors, fetchDoctor, updateDoctor, type DoctorRow } from '../api/endpoints';
import {
  Drawer,
  ErrorState,
  Facts,
  Loading,
  PageHead,
  Pager,
  Resource,
  SearchBox,
  Status,
  Tabs,
  formatDate,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * The doctor roster.
 *
 * What an admin can change here is deliberately narrow: whether the doctor is
 * listed, what they charge, their commission and their payout account. The
 * admin cannot alter a qualification, a specialty or a council number — those
 * came from documents that were reviewed, and quietly editing them would leave
 * an approved application saying one thing and the live profile another.
 */

const VerifiedFlag: React.FC<{ at: string | null }> = ({ at }) =>
  at ? (
    <Status value="VERIFIED" tone="success" />
  ) : (
    <Status value="UNVERIFIED" tone="warning" />
  );

const DoctorDrawer: React.FC<{ id: string; onClose: () => void; onSaved: () => void }> = ({
  id,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync(() => fetchDoctor(id), [id]);

  const [fee, setFee] = useState<string>('');
  const [commission, setCommission] = useState<string>('');
  const [payout, setPayout] = useState<string>('');
  const [seeded, setSeeded] = useState(false);

  // Seed the form once the record lands, then leave it alone so a reload does
  // not wipe what the operator has typed.
  if (state.data && !seeded) {
    setFee(String(state.data.doctor.consultationFee));
    setCommission(state.data.doctor.commissionPercent?.toString() ?? '');
    setPayout(state.data.doctor.payoutAccountId ?? '');
    setSeeded(true);
  }

  const save = async (patch: Parameters<typeof updateDoctor>[1]) => {
    setBusy(true);
    setError(null);
    try {
      await updateDoctor(id, patch);
      state.reload();
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const d = state.data?.doctor;

  return (
    <Drawer
      open
      title={d?.name ?? 'Doctor'}
      subtitle={d ? `${d.specialty} · ${d.user.phoneNumber}` : undefined}
      onClose={onClose}
      footer={
        d ? (
          <>
            <button
              className={`btn sm ${d.isAvailable ? 'outline' : ''}`}
              disabled={busy}
              onClick={() => void save({ isAvailable: !d.isAvailable })}
            >
              {d.isAvailable ? 'Take offline' : 'List as available'}
            </button>
            <button
              className={`btn sm ${d.verifiedAt ? 'outline' : ''}`}
              disabled={busy}
              onClick={() => void save({ verified: !d.verifiedAt })}
            >
              {d.verifiedAt ? 'Clear verification' : 'Mark verified'}
            </button>
          </>
        ) : null
      }
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || !d ? null : (
        <>
          {error ? <div className="banner error">{error}</div> : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'profile', label: 'Profile' },
              { key: 'terms', label: 'Listing & terms' },
              { key: 'activity', label: 'Activity', count: state.data.recentAppointments.length },
            ]}
          />

          {tab === 'profile' ? (
            <>
              <Facts
                rows={[
                  ['Phone', <span className="mono">{d.user.phoneNumber}</span>],
                  ['Specialty', d.specialty],
                  ['Qualification', d.qualification],
                  ['Experience', `${d.experienceYears} years`],
                  ['Council number', <span className="mono">{d.councilRegistrationNumber}</span>],
                  ['Council', d.councilName],
                  ['HPR id', d.hprId],
                  ['Verification', <VerifiedFlag at={d.verifiedAt} />],
                  ['Clinic', d.clinicAddress],
                  ['Joined', formatDate(d.createdAt)],
                  [
                    'Application',
                    state.data.application ? (
                      <>
                        <Status value={state.data.application.status} />{' '}
                        <span className="sub">
                          reviewed {formatDate(state.data.application.reviewedAt)}
                        </span>
                      </>
                    ) : null,
                  ],
                ]}
              />
              <p className="inline-note">
                Qualification, specialty and council number came from the reviewed application and
                are not editable here — changing them would leave the approved documents describing
                a different doctor.
              </p>
            </>
          ) : null}

          {tab === 'terms' ? (
            <>
              <div className="card">
                <h3>Consultation fee</h3>
                <div className="form-row">
                  <label>
                    Fee (₹)
                    <input
                      type="number"
                      min={0}
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                    />
                  </label>
                  <label>
                    Commission override (%)
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={commission}
                      placeholder="Platform default"
                      onChange={(e) => setCommission(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      consultationFee: Number(fee),
                      commissionPercent: commission === '' ? null : Number(commission),
                    })
                  }
                >
                  Save
                </button>
              </div>

              <div className="card">
                <h3>Payout account</h3>
                <p className="inline-note">
                  The doctor's linked account at the payment aggregator. Until this is set their
                  share cannot be split out at settlement and is held for manual payment — the
                  platform never takes custody of it.
                </p>
                <div className="form-row">
                  <label>
                    Linked account id
                    <input
                      value={payout}
                      placeholder="acc_…"
                      onChange={(e) => setPayout(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() => void save({ payoutAccountId: payout.trim() || null })}
                >
                  Save
                </button>
              </div>

              <Facts
                rows={[
                  ['Earnings settled', money(state.data.earnings.total)],
                  ['Settlement legs', state.data.earnings.legs],
                  ['Upcoming free slots', state.data.upcomingSlots],
                ]}
              />
            </>
          ) : null}

          {tab === 'activity' ? (
            <>
              <div className="stat-grid">
                {Object.entries(state.data.appointmentsByStatus).map(([status, count]) => (
                  <div className="stat" key={status}>
                    <div className="value">{count}</div>
                    <div className="label">{status.replace(/_/g, ' ').toLowerCase()}</div>
                  </div>
                ))}
              </div>

              {state.data.recentAppointments.length === 0 ? (
                <p className="inline-note">No consultations yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Slot</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.recentAppointments.map((a) => (
                        <tr key={a.id}>
                          <td>{a.patient.fullName}</td>
                          <td>
                            {a.slot.date}
                            <span className="sub">{a.slot.startTime}</span>
                          </td>
                          <td>{a.type === 'VIDEO' ? 'Video' : 'In person'}</td>
                          <td>
                            <Status value={a.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
};

export const Doctors: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'' | 'AVAILABLE' | 'OFFLINE' | 'SUSPENDED' | 'UNVERIFIED'>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchDoctors({
        ...(term ? { search: term } : {}),
        ...(filter ? { state: filter } : {}),
        page,
        limit: 25,
      }),
    [term, filter, page]
  );

  const licenceNote = (d: DoctorRow) =>
    d.user.isSuspended ? (
      <Status value="SUSPENDED" tone="danger" />
    ) : d.isAvailable ? (
      <Status value="AVAILABLE" tone="success" />
    ) : (
      <Status value="OFFLINE" tone="neutral" />
    );

  return (
    <>
      <PageHead
        title="Doctors"
        lead="The consulting roster. Listing, fee and commission are set here; anything that came from a reviewed document is not."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name, specialty, council no. or phone"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
        >
          <option value="">All doctors</option>
          <option value="AVAILABLE">Listed and available</option>
          <option value="OFFLINE">Taken offline</option>
          <option value="UNVERIFIED">Not verified</option>
          <option value="SUSPENDED">Suspended account</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.doctors.length === 0}
        emptyTitle="No doctors match those filters"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Council no.</th>
                    <th className="num">Fee</th>
                    <th className="num">Commission</th>
                    <th className="num">Consults</th>
                    <th>Payouts</th>
                    <th>Verification</th>
                    <th>Listing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.doctors.map((d) => (
                    <tr key={d.id} onClick={() => setOpenId(d.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        {/* The row opens the drawer for a quick edit; the name
                            goes to the doctor's own page, where the credentials
                            and the full consultation history live. */}
                        <Link
                          to={`/doctors/${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="link-btn"
                        >
                          {d.name}
                        </Link>
                        <span className="sub">
                          {d.specialty} · {d.experienceYears}y
                        </span>
                      </td>
                      <td className="mono">{d.councilRegistrationNumber ?? '—'}</td>
                      <td className="num">{money(d.consultationFee)}</td>
                      <td className="num">
                        {d.commissionPercent === null ? (
                          <span className="sub">default</span>
                        ) : (
                          `${d.commissionPercent}%`
                        )}
                      </td>
                      <td className="num">{d._count.appointments}</td>
                      <td>
                        {d.payoutAccountId ? (
                          <Status value="LINKED" tone="success" />
                        ) : (
                          <Status value="NOT LINKED" tone="warning" />
                        )}
                      </td>
                      <td>
                        <VerifiedFlag at={d.verifiedAt} />
                      </td>
                      <td>{licenceNote(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Resource>

      {openId ? (
        <DoctorDrawer id={openId} onClose={() => setOpenId(null)} onSaved={list.reload} />
      ) : null}
    </>
  );
};

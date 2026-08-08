import React, { useState } from 'react';
import { fetchPatients, fetchPatient, type PatientRow } from '../api/endpoints';
import {
  Drawer,
  Facts,
  Loading,
  PageHead,
  Pager,
  Resource,
  SearchBox,
  Status,
  Tabs,
  ErrorState,
  formatDate,
  formatDateTime,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * The patient directory.
 *
 * A support agent's entry point is almost always a phone number, so search
 * covers it alongside the name. The detail drawer shows what the patient has
 * *done* — consults, orders, payments — and deliberately not what was found
 * wrong with them. Diagnoses and prescriptions are not on this screen and are
 * not fetched by the endpoint behind it.
 */

const PatientDrawer: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [tab, setTab] = useState('overview');
  const state = useAsync(() => fetchPatient(id), [id]);

  return (
    <Drawer
      open
      title={state.data?.patient.fullName ?? 'Patient'}
      subtitle={state.data ? state.data.patient.user.phoneNumber : undefined}
      onClose={onClose}
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data ? null : (
        <>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'consults', label: 'Consults', count: state.data.appointments.length },
              { key: 'orders', label: 'Orders', count: state.data.medicineOrders.length },
              { key: 'labs', label: 'Lab tests', count: state.data.labOrders.length },
              { key: 'payments', label: 'Payments', count: state.data.payments.length },
            ]}
          />

          {tab === 'overview' ? (
            <>
              <Facts
                rows={[
                  ['Phone', <span className="mono">{state.data.patient.user.phoneNumber}</span>],
                  ['Email', state.data.patient.email],
                  ['Age', state.data.patient.age],
                  ['Gender', state.data.patient.gender],
                  ['Blood group', state.data.patient.bloodGroup],
                  ['Emergency contact', state.data.patient.emergencyContact],
                  ['Address', state.data.patient.address],
                  ['Joined', formatDate(state.data.patient.createdAt)],
                  [
                    'Account',
                    <Status
                      value={state.data.patient.user.isSuspended ? 'SUSPENDED' : 'ACTIVE'}
                      tone={state.data.patient.user.isSuspended ? 'danger' : 'success'}
                    />,
                  ],
                  ['Lifetime value', money(state.data.totals.lifetimeValue)],
                ]}
              />

              {state.data.emergencies.length > 0 ? (
                <div className="card">
                  <h3>Emergency calls</h3>
                  <table>
                    <tbody>
                      {state.data.emergencies.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <Status value={e.status} />
                          </td>
                          <td>{e.note ?? '—'}</td>
                          <td className="sub">{formatDateTime(e.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <p className="inline-note">
                Clinical records — diagnoses, prescriptions and lab results — are not shown here and
                are not read by this screen. Operating the platform does not require them.
              </p>
            </>
          ) : null}

          {tab === 'consults' ? (
            state.data.appointments.length === 0 ? (
              <p className="inline-note">No consultations yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>When</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.appointments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.doctor.name}</strong>
                          <span className="sub">{a.doctor.specialty}</span>
                        </td>
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
            )
          ) : null}

          {tab === 'orders' ? (
            state.data.medicineOrders.length === 0 ? (
              <p className="inline-note">No medicine orders yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pharmacy</th>
                      <th>Placed</th>
                      <th className="num">Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.medicineOrders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.pharmacy?.name ?? <span className="sub">Unassigned</span>}</td>
                        <td>{formatDate(o.createdAt)}</td>
                        <td className="num">{money(o.totalAmount)}</td>
                        <td>
                          <Status value={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === 'labs' ? (
            state.data.labOrders.length === 0 ? (
              <p className="inline-note">No lab bookings yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Lab</th>
                      <th className="num">Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.labOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.testName}</strong>
                          <span className="sub">{formatDate(o.createdAt)}</span>
                        </td>
                        <td>{o.labPartner?.name ?? <span className="sub">Unassigned</span>}</td>
                        <td className="num">{money(o.price)}</td>
                        <td>
                          <Status value={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === 'payments' ? (
            state.data.payments.length === 0 ? (
              <p className="inline-note">No payments yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>For</th>
                      <th>Method</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.purpose.replace(/_/g, ' ').toLowerCase()}
                          <span className="sub">{formatDate(p.createdAt)}</span>
                        </td>
                        <td>{p.method}</td>
                        <td className="num">
                          {money(p.amount)}
                          {p.refundedAmount > 0 ? (
                            <span className="sub">−{money(p.refundedAmount)} refunded</span>
                          ) : null}
                        </td>
                        <td>
                          <Status value={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </>
      )}
    </Drawer>
  );
};

export const Patients: React.FC = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const list = useAsync(
    () => fetchPatients({ ...(term ? { search: term } : {}), page, limit: 25 }),
    [term, page]
  );

  const open = (p: PatientRow) => setOpenId(p.id);

  return (
    <>
      <PageHead
        title="Patients"
        lead="Everyone who uses the app. Search by name, email or phone number — the phone number is usually all a caller can give you."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name, email or phone"
        />
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.patients.length === 0}
        emptyTitle="No patients match that search"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Age / blood</th>
                    <th className="num">Consults</th>
                    <th className="num">Orders</th>
                    <th className="num">Lab tests</th>
                    <th>Joined</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patients.map((p) => (
                    <tr key={p.id} onClick={() => open(p)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn">{p.fullName}</button>
                        {p.address ? <span className="sub">{p.address}</span> : null}
                      </td>
                      <td className="mono">{p.user.phoneNumber}</td>
                      <td>
                        {p.age ?? '—'}
                        {p.bloodGroup ? <span className="sub">{p.bloodGroup}</span> : null}
                      </td>
                      <td className="num">{p._count.appointments}</td>
                      <td className="num">{p._count.medicineOrders}</td>
                      <td className="num">{p._count.labOrders}</td>
                      <td>{formatDate(p.createdAt)}</td>
                      <td>
                        <Status
                          value={p.user.isSuspended ? 'SUSPENDED' : 'ACTIVE'}
                          tone={p.user.isSuspended ? 'danger' : 'success'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Resource>

      {openId ? <PatientDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
};

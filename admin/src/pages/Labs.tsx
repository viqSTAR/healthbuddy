import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchLabs, fetchLab, updateLab, setLabOffering, type LabRow } from '../api/endpoints';
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
  daysUntil,
  formatDate,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * Diagnostic labs.
 *
 * A lab's *capabilities* are its own — it adds and removes tests as its
 * equipment changes. Its *prices* are not: one price per test per area, set on
 * the Lab pricing screen. A patient cannot judge sample handling the way they
 * judge a restaurant, so price competition between labs selects for the
 * cheapest handling rather than the best. All an admin does here is suspend an
 * offering when a machine or an accreditation is down.
 */

const NablCell: React.FC<{ accredited: boolean; expiry: string | null }> = ({
  accredited,
  expiry,
}) => {
  if (!accredited) return <span className="sub">Not accredited</span>;
  const days = daysUntil(expiry);
  if (days === null) return <Status value="NABL" tone="success" />;
  if (days < 0) return <Status value="NABL EXPIRED" tone="danger" />;
  if (days <= 60) return <Status value={`NABL ${days}d`} tone="warning" />;
  return (
    <>
      <Status value="NABL" tone="success" />
      <span className="sub">to {formatDate(expiry)}</span>
    </>
  );
};

const LabDrawer: React.FC<{ id: string; onClose: () => void; onSaved: () => void }> = ({
  id,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync(() => fetchLab(id), [id]);

  const [cert, setCert] = useState('');
  const [expiry, setExpiry] = useState('');
  const [commission, setCommission] = useState('');
  const [payout, setPayout] = useState('');
  const [seeded, setSeeded] = useState(false);

  if (state.data && !seeded) {
    const l = state.data.lab;
    setCert(l.nablCertNumber ?? '');
    setExpiry(l.nablExpiry ? l.nablExpiry.slice(0, 10) : '');
    setCommission(l.commissionPercent?.toString() ?? '');
    setPayout(l.payoutAccountId ?? '');
    setSeeded(true);
  }

  const save = async (patch: Parameters<typeof updateLab>[1]) => {
    setBusy(true);
    setError(null);
    try {
      await updateLab(id, patch);
      state.reload();
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleOffering = async (offeringId: string, isActive: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setLabOffering(offeringId, isActive);
      state.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const l = state.data?.lab;

  return (
    <Drawer
      open
      title={l?.name ?? 'Lab'}
      subtitle={l ? `${l.city ?? l.location} · ${l.user.phoneNumber}` : undefined}
      onClose={onClose}
      footer={
        l ? (
          <>
            <button
              className={`btn sm ${l.isActive ? 'danger' : ''}`}
              disabled={busy}
              onClick={() => void save({ isActive: !l.isActive })}
            >
              {l.isActive ? 'Stop taking bookings' : 'Resume bookings'}
            </button>
            <button
              className={`btn sm ${l.verifiedAt ? 'outline' : ''}`}
              disabled={busy}
              onClick={() => void save({ verified: !l.verifiedAt })}
            >
              {l.verifiedAt ? 'Clear verification' : 'Mark verified'}
            </button>
          </>
        ) : null
      }
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || !l ? null : (
        <>
          {error ? <div className="banner error">{error}</div> : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'profile', label: 'Profile' },
              { key: 'accreditation', label: 'Accreditation & terms' },
              { key: 'tests', label: 'Tests offered', count: state.data.offerings.length },
              { key: 'orders', label: 'Bookings', count: l._count.labOrders },
            ]}
          />

          {tab === 'profile' ? (
            <>
              <Facts
                rows={[
                  ['Phone', <span className="mono">{l.user.phoneNumber}</span>],
                  ['Location', l.location],
                  ['Address', l.address],
                  ['City', [l.city, l.state, l.pincode].filter(Boolean).join(', ')],
                  ['Registration no.', <span className="mono">{l.labRegistrationNumber}</span>],
                  ['HFR id', l.hfrId],
                  [
                    'Home collection',
                    <Status
                      value={l.homeCollection ? 'OFFERED' : 'NOT OFFERED'}
                      tone={l.homeCollection ? 'success' : 'neutral'}
                    />,
                  ],
                  ['Accreditation', <NablCell accredited={l.nablAccredited} expiry={l.nablExpiry} />],
                  ['Joined', formatDate(l.createdAt)],
                ]}
              />

              <div className="stat-grid">
                <div className="stat">
                  <div className="value">{money(state.data.lifetimeRevenue)}</div>
                  <div className="label">Completed test value</div>
                </div>
                <div className="stat">
                  <div className="value">{money(state.data.earnings.total)}</div>
                  <div className="label">Settled to this lab</div>
                </div>
                <div className="stat">
                  <div className="value">{state.data.offerings.filter((o) => o.isActive).length}</div>
                  <div className="label">Tests currently offered</div>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'accreditation' ? (
            <>
              <div className="card">
                <h3>NABL accreditation</h3>
                <div className="checkbox">
                  <input
                    type="checkbox"
                    checked={l.nablAccredited}
                    disabled={busy}
                    onChange={(e) => void save({ nablAccredited: e.target.checked })}
                  />
                  <span>Accredited by NABL</span>
                </div>
                <div className="form-row">
                  <label>
                    Certificate number
                    <input value={cert} onChange={(e) => setCert(e.target.value)} />
                  </label>
                  <label>
                    Expires
                    <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                  </label>
                </div>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      nablCertNumber: cert.trim() || null,
                      nablExpiry: expiry ? new Date(`${expiry}T12:00:00Z`).toISOString() : null,
                    })
                  }
                >
                  Save accreditation
                </button>
              </div>

              <div className="card">
                <h3>Service & terms</h3>
                <div className="checkbox">
                  <input
                    type="checkbox"
                    checked={l.homeCollection}
                    disabled={busy}
                    onChange={(e) => void save({ homeCollection: e.target.checked })}
                  />
                  <span>Offers home sample collection</span>
                </div>
                <div className="form-row">
                  <label>
                    Commission override (%)
                    <input
                      type="number"
                      min={0}
                      max={60}
                      placeholder="Platform default"
                      value={commission}
                      onChange={(e) => setCommission(e.target.value)}
                    />
                  </label>
                  <label>
                    Payout account id
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
                  onClick={() =>
                    void save({
                      commissionPercent: commission === '' ? null : Number(commission),
                      payoutAccountId: payout.trim() || null,
                    })
                  }
                >
                  Save terms
                </button>
              </div>
            </>
          ) : null}

          {tab === 'tests' ? (
            <>
              <p className="inline-note">
                What this lab can run. Prices are not set here — one price per test per area lives on
                the Lab pricing screen, so labs compete on turnaround and accreditation rather than
                on how cheaply they can handle a sample.
              </p>
              {state.data.offerings.length === 0 ? (
                <p className="inline-note">This lab has not added any tests yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Sample</th>
                        <th className="num">Turnaround</th>
                        <th>State</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.offerings.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>{o.labPackage.testName}</strong>
                            <span className="sub">{o.labPackage.category}</span>
                          </td>
                          <td>{o.labPackage.sampleType}</td>
                          <td className="num">{o.turnaroundHours}h</td>
                          <td>
                            <Status
                              value={o.isActive ? 'OFFERED' : 'SUSPENDED'}
                              tone={o.isActive ? 'success' : 'neutral'}
                            />
                          </td>
                          <td>
                            <button
                              className="btn outline sm"
                              disabled={busy}
                              onClick={() => void toggleOffering(o.id, !o.isActive)}
                            >
                              {o.isActive ? 'Suspend' : 'Restore'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}

          {tab === 'orders' ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th className="num">Bookings</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.ordersByStatus.map((r) => (
                      <tr key={r.status}>
                        <td>
                          <Status value={r.status} />
                        </td>
                        <td className="num">{r.count}</td>
                        <td className="num">{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {state.data.recentOrders.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Patient</th>
                        <th className="num">Price</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.recentOrders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>{o.testName}</strong>
                            <span className="sub">{formatDate(o.createdAt)}</span>
                          </td>
                          <td>{o.patient.fullName}</td>
                          <td className="num">{money(o.price)}</td>
                          <td>
                            <Status value={o.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
};

export const Labs: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'' | 'ACTIVE' | 'INACTIVE' | 'NABL' | 'UNVERIFIED'>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchLabs({
        ...(term ? { search: term } : {}),
        ...(filter ? { state: filter } : {}),
        page,
        limit: 25,
      }),
    [term, filter, page]
  );

  const status = (l: LabRow) =>
    l.user.isSuspended ? (
      <Status value="SUSPENDED" tone="danger" />
    ) : l.isActive ? (
      <Status value="ACTIVE" tone="success" />
    ) : (
      <Status value="PAUSED" tone="neutral" />
    );

  return (
    <>
      <PageHead
        title="Labs"
        lead="Diagnostic partners. They choose which tests they can run; the platform sets what each test costs in each area."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name, city, registration no. or phone"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
        >
          <option value="">All labs</option>
          <option value="ACTIVE">Taking bookings</option>
          <option value="INACTIVE">Paused</option>
          <option value="NABL">NABL accredited</option>
          <option value="UNVERIFIED">Not verified</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.labs.length === 0}
        emptyTitle="No labs match those filters"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Lab</th>
                    <th>Registration</th>
                    <th>Accreditation</th>
                    <th className="num">Tests</th>
                    <th className="num">Bookings</th>
                    <th>Home visit</th>
                    <th>Payouts</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.labs.map((l) => (
                    <tr key={l.id} onClick={() => setOpenId(l.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn">{l.name}</button>
                        <span className="sub">
                          {[l.city, l.pincode].filter(Boolean).join(' · ') || l.location}
                        </span>
                      </td>
                      <td className="mono">{l.labRegistrationNumber ?? '—'}</td>
                      <td>
                        <NablCell accredited={l.nablAccredited} expiry={l.nablExpiry} />
                      </td>
                      <td className="num">{l._count.offerings}</td>
                      <td className="num">{l._count.labOrders}</td>
                      <td>{l.homeCollection ? 'Yes' : 'No'}</td>
                      <td>
                        {l.payoutAccountId ? (
                          <Status value="LINKED" tone="success" />
                        ) : (
                          <Status value="NOT LINKED" tone="warning" />
                        )}
                      </td>
                      <td>{status(l)}</td>
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
        <LabDrawer id={openId} onClose={() => setOpenId(null)} onSaved={list.reload} />
      ) : null}
    </>
  );
};

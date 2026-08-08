import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import {
  fetchPharmacies,
  fetchPharmacy,
  fetchPharmacyInventory,
  updatePharmacy,
  type PharmacyRow,
} from '../api/endpoints';
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
 * Medical shops.
 *
 * The licence is the thing that matters here. The platform is a marketplace —
 * the partner holds the retail drug licence, not us — so an expired one is not
 * a cosmetic warning, it means the shop must stop trading. The list surfaces
 * the expiry date with days remaining rather than a date the eye has to
 * subtract from today.
 */

const LicenceCell: React.FC<{ expiry: string | null }> = ({ expiry }) => {
  const days = daysUntil(expiry);
  if (days === null) return <span className="sub">Not recorded</span>;
  if (days < 0) return <Status value="EXPIRED" tone="danger" />;
  if (days <= 60)
    return (
      <>
        <Status value={`${days}d LEFT`} tone="warning" />
        <span className="sub">{formatDate(expiry)}</span>
      </>
    );
  return <span>{formatDate(expiry)}</span>;
};

const InventoryTab: React.FC<{ pharmacyId: string }> = ({ pharmacyId }) => {
  const [only, setOnly] = useState<'' | 'LOW' | 'EXPIRING' | 'OUT'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchPharmacyInventory(pharmacyId, {
        ...(term ? { search: term } : {}),
        ...(only ? { only } : {}),
        page,
        limit: 20,
      }),
    [pharmacyId, term, only, page]
  );

  return (
    <>
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Medicine name" />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
          <option value="">All lines</option>
          <option value="LOW">At or below reorder level</option>
          <option value="EXPIRING">Expiring within 60 days</option>
          <option value="OUT">Out of stock</option>
        </select>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.lines.length === 0}
        emptyTitle="No stock lines match"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th className="num">Price</th>
                    <th className="num">On shelf</th>
                    <th className="num">Reserved</th>
                    <th className="num">Sellable</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.medicine.name}</strong>
                        <span className="sub">
                          {l.medicine.category}
                          {l.medicine.requiresPrescription ? ' · Rx only' : ''}
                        </span>
                      </td>
                      <td className="num">{money(l.price)}</td>
                      <td className="num">{l.stock}</td>
                      <td className="num">{l.reserved}</td>
                      <td className="num">
                        {l.available <= l.reorderLevel ? (
                          <Status value={String(l.available)} tone="warning" />
                        ) : (
                          l.available
                        )}
                      </td>
                      <td>
                        <LicenceCell expiry={l.expiryDate} />
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

      <p className="inline-note">
        Read-only. Stock is the running total of the movement ledger, so it only changes through a
        recorded reason — editing the number here would break the one thing that makes a shortfall
        explainable.
      </p>
    </>
  );
};

const PharmacyDrawer: React.FC<{ id: string; onClose: () => void; onSaved: () => void }> = ({
  id,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync(() => fetchPharmacy(id), [id]);

  const [licence, setLicence] = useState('');
  const [expiry, setExpiry] = useState('');
  const [radius, setRadius] = useState('');
  const [commission, setCommission] = useState('');
  const [payout, setPayout] = useState('');
  const [seeded, setSeeded] = useState(false);

  if (state.data && !seeded) {
    const p = state.data.pharmacy;
    setLicence(p.drugLicenceNumber ?? '');
    setExpiry(p.drugLicenceExpiry ? p.drugLicenceExpiry.slice(0, 10) : '');
    setRadius(String(p.deliveryRadiusKm));
    setCommission(p.commissionPercent?.toString() ?? '');
    setPayout(p.payoutAccountId ?? '');
    setSeeded(true);
  }

  const save = async (patch: Parameters<typeof updatePharmacy>[1]) => {
    setBusy(true);
    setError(null);
    try {
      await updatePharmacy(id, patch);
      state.reload();
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const p = state.data?.pharmacy;

  return (
    <Drawer
      open
      title={p?.name ?? 'Pharmacy'}
      subtitle={p ? `${p.city ?? p.address} · ${p.user.phoneNumber}` : undefined}
      onClose={onClose}
      footer={
        p ? (
          <>
            <button
              className={`btn sm ${p.isActive ? 'danger' : ''}`}
              disabled={busy}
              onClick={() => void save({ isActive: !p.isActive })}
            >
              {p.isActive ? 'Stop taking orders' : 'Resume taking orders'}
            </button>
            <button
              className={`btn sm ${p.verifiedAt ? 'outline' : ''}`}
              disabled={busy}
              onClick={() => void save({ verified: !p.verifiedAt })}
            >
              {p.verifiedAt ? 'Clear verification' : 'Mark verified'}
            </button>
          </>
        ) : null
      }
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || !p ? null : (
        <>
          {error ? <div className="banner error">{error}</div> : null}
          {daysUntil(p.drugLicenceExpiry) !== null && daysUntil(p.drugLicenceExpiry)! < 0 ? (
            <div className="banner error">
              This shop's drug licence has expired. It must not dispense until a current licence is
              on file.
            </div>
          ) : null}

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'profile', label: 'Profile' },
              { key: 'licence', label: 'Licence & terms' },
              { key: 'inventory', label: 'Stock', count: p._count.inventory },
              { key: 'orders', label: 'Orders', count: p._count.orders },
            ]}
          />

          {tab === 'profile' ? (
            <>
              <Facts
                rows={[
                  ['Phone', <span className="mono">{p.user.phoneNumber}</span>],
                  ['Address', p.address],
                  ['City', [p.city, p.state, p.pincode].filter(Boolean).join(', ')],
                  ['Pharmacist', p.pharmacistName],
                  ['GSTIN', <span className="mono">{p.gstin}</span>],
                  ['HFR id', p.hfrId],
                  ['Delivery radius', `${p.deliveryRadiusKm} km`],
                  ['Joined', formatDate(p.createdAt)],
                  [
                    'Taking orders',
                    <Status
                      value={p.isActive ? 'ACTIVE' : 'PAUSED'}
                      tone={p.isActive ? 'success' : 'neutral'}
                    />,
                  ],
                ]}
              />

              <div className="stat-grid">
                <div className="stat">
                  <div className="value">{money(state.data.lifetimeRevenue)}</div>
                  <div className="label">Delivered order value</div>
                </div>
                <div className="stat">
                  <div className="value">{money(state.data.earnings.total)}</div>
                  <div className="label">Settled to this shop</div>
                </div>
                <div className="stat">
                  <div className="value">{state.data.inventory.lowStockLines}</div>
                  <div className="label">Lines below reorder level</div>
                </div>
                <div className="stat">
                  <div className="value">{state.data.inventory.expiringLines}</div>
                  <div className="label">Lines expiring in 60 days</div>
                </div>
              </div>

              {state.data.writeOffs.length > 0 ? (
                <div className="card">
                  <h3>Stock written off</h3>
                  <p className="inline-note">
                    Expiry, damage, recounts and over-the-counter sales — the movements a shop has
                    the most reason to under-report, which is why they get their own summary.
                  </p>
                  <table>
                    <tbody>
                      {state.data.writeOffs.map((w) => (
                        <tr key={w.reason}>
                          <td>
                            <Status value={w.reason} tone="neutral" />
                          </td>
                          <td className="num">{w.count} movements</td>
                          <td className="num">{w.units} units</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'licence' ? (
            <>
              <div className="card">
                <h3>Retail drug licence</h3>
                <div className="form-row">
                  <label>
                    Licence number
                    <input value={licence} onChange={(e) => setLicence(e.target.value)} />
                  </label>
                  <label>
                    Expires
                    <input
                      type="date"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      drugLicenceNumber: licence.trim() || null,
                      // The column is a timestamp; a date input gives a bare
                      // day, so it is pinned to midday UTC rather than midnight
                      // to survive a timezone shift either way.
                      drugLicenceExpiry: expiry ? new Date(`${expiry}T12:00:00Z`).toISOString() : null,
                    })
                  }
                >
                  Save licence
                </button>
              </div>

              <div className="card">
                <h3>Commercial terms</h3>
                <div className="form-row">
                  <label>
                    Delivery radius (km)
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                    />
                  </label>
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
                </div>
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Payout account id</span>
                  <input
                    value={payout}
                    placeholder="acc_…"
                    onChange={(e) => setPayout(e.target.value)}
                  />
                </label>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      deliveryRadiusKm: Number(radius),
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

          {tab === 'inventory' ? <InventoryTab pharmacyId={id} /> : null}

          {tab === 'orders' ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th className="num">Orders</th>
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
                        <th>Patient</th>
                        <th>Placed</th>
                        <th className="num">Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.recentOrders.map((o) => (
                        <tr key={o.id}>
                          <td>{o.patient.fullName}</td>
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
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
};

export const Pharmacies: React.FC = () => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<
    '' | 'ACTIVE' | 'INACTIVE' | 'LICENCE_EXPIRING' | 'UNVERIFIED'
  >('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchPharmacies({
        ...(term ? { search: term } : {}),
        ...(filter ? { state: filter } : {}),
        page,
        limit: 25,
      }),
    [term, filter, page]
  );

  const status = (p: PharmacyRow) =>
    p.user.isSuspended ? (
      <Status value="SUSPENDED" tone="danger" />
    ) : p.isActive ? (
      <Status value="ACTIVE" tone="success" />
    ) : (
      <Status value="PAUSED" tone="neutral" />
    );

  return (
    <>
      <PageHead
        title="Pharmacies"
        lead="Partner medical shops. The drug licence is theirs, not the platform's — an expired one means the shop must stop dispensing."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Name, city, pincode, licence or phone"
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setPage(1);
          }}
        >
          <option value="">All pharmacies</option>
          <option value="ACTIVE">Taking orders</option>
          <option value="INACTIVE">Paused</option>
          <option value="LICENCE_EXPIRING">Licence expiring or expired</option>
          <option value="UNVERIFIED">Not verified</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.pharmacies.length === 0}
        emptyTitle="No pharmacies match those filters"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>Licence</th>
                    <th>Expiry</th>
                    <th className="num">Orders</th>
                    <th className="num">Stock lines</th>
                    <th className="num">Radius</th>
                    <th>Payouts</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pharmacies.map((p) => (
                    <tr key={p.id} onClick={() => setOpenId(p.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn">{p.name}</button>
                        <span className="sub">
                          {[p.city, p.pincode].filter(Boolean).join(' · ') || p.address}
                        </span>
                      </td>
                      <td className="mono">{p.drugLicenceNumber ?? '—'}</td>
                      <td>
                        <LicenceCell expiry={p.drugLicenceExpiry} />
                      </td>
                      <td className="num">{p._count.orders}</td>
                      <td className="num">{p._count.inventory}</td>
                      <td className="num">{p.deliveryRadiusKm} km</td>
                      <td>
                        {p.payoutAccountId ? (
                          <Status value="LINKED" tone="success" />
                        ) : (
                          <Status value="NOT LINKED" tone="warning" />
                        )}
                      </td>
                      <td>{status(p)}</td>
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
        <PharmacyDrawer id={openId} onClose={() => setOpenId(null)} onSaved={list.reload} />
      ) : null}
    </>
  );
};

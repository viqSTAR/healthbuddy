import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import {
  fetchPharmacy,
  fetchPharmacyInventory,
  fetchStockMovements,
  adminUpsertInventory,
  adminRecordStockMovement,
  adminSetStockCount,
  adminRemoveInventory,
  fetchMedicines,
  type InventoryLine,
  type StockMovementReason,
} from '../api/endpoints';
import {
  Badge,
  EmptyState,
  ErrorState,
  Facts,
  Loading,
  Pager,
  SearchBox,
  Stat,
  Status,
  Tabs,
  daysUntil,
  formatDate,
  formatDateTime,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * One pharmacy, with its shelf.
 *
 * Stock used to live in a single platform-wide ledger — every movement from
 * every shop in one list. That answers "how much shrinkage is there overall"
 * and nothing else. The question an operator actually arrives with is about a
 * *particular* shop: this one has not dispatched in two days, or is showing out
 * of stock on a medicine a patient has already paid for. That is a question
 * about one shelf, and it needs a page about one shelf.
 *
 * Editing here is deliberate but not casual. A partner runs their own
 * inventory; the platform reaches in for recalls, for a shop gone dark
 * mid-order, for a recount after a dispute. Every write goes through the same
 * services the partner app uses — so the ledger and the reservation arithmetic
 * cannot diverge — and every one is audited against the administrator who did
 * it.
 */

/**
 * What can be entered as a movement.
 *
 * `CORRECTION` is deliberately absent: a recount is not a movement somebody
 * sizes by hand, it is a counted total the ledger works the difference from.
 * It has its own control below, and the movement route refuses the reason
 * outright — so offering it here would produce nothing but an error.
 */
const MANUAL_REASONS: { value: StockMovementReason; label: string; hint: string }[] = [
  { value: 'PURCHASE', label: 'Stock received', hint: 'Adds units' },
  { value: 'RETURN', label: 'Customer return', hint: 'Adds units' },
  { value: 'SALE_OFFLINE', label: 'Sold at the counter', hint: 'Removes units' },
  { value: 'EXPIRED', label: 'Expired', hint: 'Removes units' },
  { value: 'DAMAGED', label: 'Damaged', hint: 'Removes units' },
];

/** Never sellable online — the Drugs and Cosmetics Act, enforced server-side too. */
const BLOCKED_SCHEDULES = ['SCHEDULE_X', 'NARCOTIC'];

const REASON_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  PURCHASE: 'success',
  RETURN: 'success',
  SALE_ONLINE: 'info',
  SALE_OFFLINE: 'info',
  CORRECTION: 'warning',
  EXPIRED: 'danger',
  DAMAGED: 'danger',
  ORDER_CANCELLED: 'neutral',
};

const readable = (value: string) =>
  value
    .split('_')
    .map((w) => w[0]! + w.slice(1).toLowerCase())
    .join(' ');

/* ------------------------------------------------------------------ */

/** Records a movement against one line. Positive quantity; the reason signs it. */
const MovementForm: React.FC<{
  pharmacyId: string;
  line: InventoryLine;
  onDone: () => void;
  onCancel: () => void;
}> = ({ pharmacyId, line, onDone, onCancel }) => {
  const [mode, setMode] = useState<'move' | 'recount'>('move');
  const [reason, setReason] = useState<StockMovementReason>('EXPIRED');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const qty = Number(quantity);
    const floor = mode === 'recount' ? 0 : 1;

    if (!Number.isInteger(qty) || qty < floor) {
      setError(
        mode === 'recount'
          ? 'Enter the counted total, as a whole number.'
          : 'Enter how many units, as a whole number above zero.'
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === 'recount') {
        await adminSetStockCount(pharmacyId, {
          medicineId: line.medicine.id,
          countedQuantity: qty,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      } else {
        await adminRecordStockMovement(pharmacyId, {
          medicineId: line.medicine.id,
          quantity: qty,
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const chosen = MANUAL_REASONS.find((r) => r.value === reason);

  return (
    <tr>
      <td colSpan={7}>
        <div className="inline-form">
          <strong>{line.medicine.name}</strong>
          <span className="sub">on the shelf: {line.stock}</span>

          <select
            value={mode === 'recount' ? 'RECOUNT' : reason}
            onChange={(e) => {
              if (e.target.value === 'RECOUNT') {
                setMode('recount');
              } else {
                setMode('move');
                setReason(e.target.value as StockMovementReason);
              }
            }}
          >
            {MANUAL_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
            <option value="RECOUNT">Recount (set exact count)</option>
          </select>
          <span className="sub">
            {mode === 'recount' ? 'The difference is worked out for you' : chosen?.hint}
          </span>

          <input
            type="number"
            min={mode === 'recount' ? 0 : 1}
            placeholder={mode === 'recount' ? 'Counted total' : 'Units'}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{ width: 130 }}
          />
          <input
            placeholder="Why (recorded in the ledger)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />

          <button className="btn sm" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Recording…' : 'Record'}
          </button>
          <button className="btn sm outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
        {error ? <div className="banner error">{error}</div> : null}
      </td>
    </tr>
  );
};

/** Lists a medicine this shop does not carry yet. */
const AddLineForm: React.FC<{ pharmacyId: string; onDone: () => void }> = ({
  pharmacyId,
  onDone,
}) => {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [medicineId, setMedicineId] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [reorder, setReorder] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useAsync(
    () => fetchMedicines({ ...(debounced ? { search: debounced } : {}), limit: 25 }),
    [debounced]
  );

  const submit = async () => {
    if (!medicineId) {
      setError('Pick a medicine first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminUpsertInventory(pharmacyId, {
        medicineId,
        price: Number(price),
        ...(stock ? { stock: Number(stock) } : {}),
        ...(reorder ? { reorderLevel: Number(reorder) } : {}),
        ...(expiry ? { expiryDate: expiry } : {}),
      });
      setMedicineId('');
      setPrice('');
      setStock('');
      setReorder('');
      setExpiry('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>List a medicine on this shelf</h3>
      <p className="sub">
        Opening stock applies only the first time a medicine is listed. After that the count
        moves through the ledger, with a reason attached to every change.
      </p>

      <div className="inline-form">
        <SearchBox value={search} onChange={setSearch} placeholder="Find a medicine" />
        <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)}>
          <option value="">Select…</option>
          {/* Schedule X and narcotics may never be sold online. The service
              refuses them, so offering them here is a dropdown entry whose only
              possible outcome is an error message. */}
          {(options.data?.medicines ?? [])
            .filter((m) => !BLOCKED_SCHEDULES.includes(m.schedule))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.schedule}
              </option>
            ))}
        </select>
        <input
          type="number"
          step="0.01"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{ width: 110 }}
        />
        <input
          type="number"
          placeholder="Opening stock"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          style={{ width: 130 }}
        />
        <input
          type="number"
          placeholder="Reorder at"
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
          style={{ width: 110 }}
        />
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          title="Batch expiry"
        />
        <button className="btn sm" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Listing…' : 'List it'}
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
    </div>
  );
};

/* ------------------------------------------------------------------ */

const StockTab: React.FC<{ pharmacyId: string }> = ({ pharmacyId }) => {
  const [only, setOnly] = useState<'' | 'LOW' | 'EXPIRING' | 'OUT'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [movingLine, setMovingLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search);

  const inventory = useAsync(
    () =>
      fetchPharmacyInventory(pharmacyId, {
        ...(only ? { only } : {}),
        ...(debounced ? { search: debounced } : {}),
        page,
        limit: 50,
      }),
    [pharmacyId, only, debounced, page]
  );

  const delist = async (line: InventoryLine) => {
    if (
      window.prompt(
        `Delist ${line.medicine.name} from this shop?\n\n` +
          'It disappears from the patient catalogue immediately. Refused if any of it is ' +
          'reserved against an order somebody has already paid for.\n\n' +
          'Type DELIST to confirm:'
      ) !== 'DELIST'
    ) {
      return;
    }
    setError(null);
    try {
      await adminRemoveInventory(pharmacyId, line.medicine.id);
      inventory.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      {error ? <div className="banner error">{error}</div> : null}

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Medicine name" />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
          <option value="">Everything on the shelf</option>
          <option value="LOW">Running low</option>
          <option value="OUT">Out of stock</option>
          <option value="EXPIRING">Expiring within 60 days</option>
        </select>
        <button className="btn outline" onClick={inventory.reload}>
          Refresh
        </button>
      </div>

      {inventory.loading ? (
        <Loading label="Reading the shelf" />
      ) : inventory.error ? (
        <ErrorState message={inventory.error} onRetry={inventory.reload} />
      ) : inventory.data!.lines.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          message="This shop carries no medicine matching that filter."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Price</th>
                <th>On shelf</th>
                <th>Reserved</th>
                <th>Sellable</th>
                <th>Expiry</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inventory.data!.lines.map((line) => {
                const days = daysUntil(line.expiryDate);
                const low = line.available <= line.reorderLevel;

                return (
                  <React.Fragment key={line.id}>
                    <tr>
                      <td>
                        <strong>{line.medicine.name}</strong>
                        <span className="sub">
                          {line.medicine.category} · {line.medicine.schedule}
                          {line.medicine.requiresPrescription ? ' · prescription only' : ''}
                        </span>
                        {!line.isActive ? <Badge label="DELISTED" tone="neutral" /> : null}
                      </td>
                      <td className="mono">{money(line.price)}</td>
                      <td className="mono">{line.stock}</td>
                      <td className="mono">{line.reserved || '—'}</td>
                      <td className="mono">
                        {line.available}{' '}
                        {line.available === 0 ? (
                          <Badge label="OUT" tone="danger" />
                        ) : low ? (
                          <Badge label="LOW" tone="warning" />
                        ) : null}
                      </td>
                      <td>
                        {line.expiryDate ? (
                          <>
                            {formatDate(line.expiryDate)}
                            {days !== null && days <= 60 ? (
                              <Badge
                                label={days < 0 ? 'EXPIRED' : `${days}d`}
                                tone={days < 0 ? 'danger' : 'warning'}
                              />
                            ) : null}
                          </>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            className="btn sm outline"
                            onClick={() =>
                              setMovingLine(movingLine === line.id ? null : line.id)
                            }
                          >
                            Adjust
                          </button>
                          <button className="btn sm outline" onClick={() => void delist(line)}>
                            Delist
                          </button>
                        </div>
                      </td>
                    </tr>

                    {movingLine === line.id ? (
                      <MovementForm
                        pharmacyId={pharmacyId}
                        line={line}
                        onCancel={() => setMovingLine(null)}
                        onDone={() => {
                          setMovingLine(null);
                          inventory.reload();
                        }}
                      />
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        page={page}
        total={inventory.data?.total ?? 0}
        limit={50}
        onPage={setPage}
      />

      <AddLineForm pharmacyId={pharmacyId} onDone={inventory.reload} />
    </>
  );
};

/* ------------------------------------------------------------------ */

const LedgerTab: React.FC<{ pharmacyId: string }> = ({ pharmacyId }) => {
  const [reason, setReason] = useState<StockMovementReason | ''>('');
  const [page, setPage] = useState(1);

  const movements = useAsync(
    () =>
      fetchStockMovements({
        pharmacyId,
        ...(reason ? { reason } : {}),
        page,
        limit: 50,
      }),
    [pharmacyId, reason, page]
  );

  const rows = movements.data?.movements ?? [];
  const writtenOff = rows
    .filter((m) => m.reason === 'EXPIRED' || m.reason === 'DAMAGED')
    .reduce((sum, m) => sum + Math.abs(m.delta), 0);

  return (
    <>
      <div className="toolbar">
        <select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as StockMovementReason | '');
            setPage(1);
          }}
        >
          <option value="">Every movement</option>
          <option value="EXPIRED">Expired</option>
          <option value="DAMAGED">Damaged</option>
          <option value="CORRECTION">Recount correction</option>
          <option value="PURCHASE">Stock received</option>
          <option value="SALE_OFFLINE">Sold at the counter</option>
          <option value="SALE_ONLINE">Dispatched on an order</option>
          <option value="RETURN">Customer return</option>
          <option value="ORDER_CANCELLED">Reservation released</option>
        </select>
        {writtenOff > 0 ? (
          <span className="sub">
            {writtenOff} unit(s) written off on this page — expired or damaged.
          </span>
        ) : null}
      </div>

      {movements.loading ? (
        <Loading label="Reading the ledger" />
      ) : movements.error ? (
        <ErrorState message={movements.error} onRetry={movements.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          message="No stock has moved in this shop under that filter."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Medicine</th>
                <th>Change</th>
                <th>Balance after</th>
                <th>Reason</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.createdAt)}</td>
                  <td>{m.medicineName}</td>
                  <td className="mono" style={{ color: m.delta < 0 ? 'var(--danger)' : undefined }}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td className="mono">{m.balanceAfter}</td>
                  <td>
                    <Badge label={readable(m.reason)} tone={REASON_TONE[m.reason] ?? 'neutral'} />
                  </td>
                  <td>
                    <span className="sub">{m.note ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} total={movements.data?.total ?? 0} limit={50} onPage={setPage} />
    </>
  );
};

/* ------------------------------------------------------------------ */

export const PharmacyDetail: React.FC = () => {
  const { id = '' } = useParams();
  const [tab, setTab] = useState('stock');
  const state = useAsync(() => fetchPharmacy(id), [id]);

  if (state.loading) return <Loading label="Loading pharmacy" />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;

  const { pharmacy, lifetimeRevenue, earnings, inventory, recentOrders, writeOffs } = state.data!;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{pharmacy.name}</h1>
          <p>
            <Link to="/pharmacies">← All pharmacies</Link> · {pharmacy.address}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="Lifetime revenue" value={money(lifetimeRevenue)} />
        <Stat label="Owed to this shop" value={money(earnings.total)} hint={`${earnings.legs} legs`} />
        <Stat
          label="Running low"
          value={String(inventory.lowStockLines)}
          tone={inventory.lowStockLines > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Expiring soon"
          value={String(inventory.expiringLines)}
          tone={inventory.expiringLines > 0 ? 'warning' : undefined}
        />
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'stock', label: 'Stock control' },
          { key: 'ledger', label: 'Ledger' },
          { key: 'orders', label: 'Orders', count: recentOrders.length },
          { key: 'profile', label: 'Profile' },
        ]}
      />

      {tab === 'stock' ? <StockTab pharmacyId={id} /> : null}
      {tab === 'ledger' ? <LedgerTab pharmacyId={id} /> : null}

      {tab === 'orders' ? (
        recentOrders.length === 0 ? (
          <EmptyState title="No orders yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Placed</th>
                  <th>Patient</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>{formatDateTime(o.createdAt)}</td>
                    <td>{o.patient.fullName}</td>
                    <td>
                      <Status value={o.status} />
                    </td>
                    <td className="mono">{money(o.totalAmount)}</td>
                    <td>{o.deliveredAt ? formatDateTime(o.deliveredAt) : <span className="sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'profile' ? (
        <>
          <Facts
            rows={[
              ['Licence', pharmacy.drugLicenceNumber ?? '—'],
              ['Licence expiry', formatDate(pharmacy.drugLicenceExpiry)],
              ['Pharmacist', pharmacy.pharmacistName ?? '—'],
              ['Address', pharmacy.address],
              ['Active', pharmacy.isActive ? 'Yes' : 'No'],
              ['Verified', formatDate(pharmacy.verifiedAt)],
            ]}
          />

          {writeOffs.length > 0 ? (
            <>
              <h3>Write-offs</h3>
              <p className="sub">
                Where shrinkage hides. A shop writing off steadily is either running a bad cold
                chain or is not really writing them off.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th>Movements</th>
                      <th>Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {writeOffs.map((w) => (
                      <tr key={w.reason}>
                        <td>
                          <Badge label={readable(w.reason)} tone={REASON_TONE[w.reason] ?? 'neutral'} />
                        </td>
                        <td className="mono">{w.count}</td>
                        <td className="mono">{w.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
};

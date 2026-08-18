import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import {
  cancelOrder,
  fetchOrder,
  fetchOrders,
  type OrderRow,
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
  formatDateTime,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * Medicine orders across every pharmacy.
 *
 * The payment column is the one worth getting right: a basket paid for as one
 * approved prescription attaches its payment to the fulfilment rather than to
 * each order, so reading the order's own payment alone shows a paid customer as
 * unpaid. The server flattens that for us — this screen just has to display it.
 */

const STATUSES = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PROCESSING',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
];

const PaymentCell: React.FC<{ order: OrderRow }> = ({ order }) => {
  if (!order.payment) return <span className="sub">No payment record</span>;
  return (
    <>
      <Status value={order.payment.status} />
      <span className="sub">
        {order.payment.method} · {money(order.payment.amount)}
      </span>
    </>
  );
};

const OrderDrawer: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({
  id,
  onClose,
  onChanged,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync(() => fetchOrder(id), [id]);

  const doCancel = async () => {
    const reason = window.prompt(
      'Why is this order being cancelled? This refunds the customer, releases the reserved stock and is recorded against your account.'
    );
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    setError(null);
    try {
      await cancelOrder(id, reason.trim());
      state.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const o = state.data?.order;
  const closed = o?.status === 'DELIVERED' || o?.status === 'CANCELLED';

  return (
    <Drawer
      open
      title={o ? `Order ${o.id.slice(0, 8)}` : 'Order'}
      subtitle={o ? `${o.patient.fullName} · ${o.patient.user.phoneNumber}` : undefined}
      onClose={onClose}
      footer={
        o && !closed ? (
          <button className="btn danger sm" disabled={busy} onClick={() => void doCancel()}>
            Cancel and refund
          </button>
        ) : null
      }
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data || !o ? null : (
        <>
          {error ? <div className="banner error">{error}</div> : null}

          <Facts
            rows={[
              ['Status', <Status value={o.status} />],
              ['Pharmacy', o.pharmacy?.name ?? 'Not assigned to a shop yet'],
              ['Delivery address', o.address],
              [
                'Carried by',
                o.riders.length === 0 ? (
                  'Nobody yet'
                ) : (
                  <>
                    {o.riders.map((r) => (
                      <span key={r.id}>
                        {r.name ?? 'Unnamed'}
                        <span className="sub mono">
                          {r.phoneNumber}
                          {o.shipments.length > 1 ? ` · ${r.parcels} parcel(s)` : ''}
                        </span>
                      </span>
                    ))}
                  </>
                ),
              ],
              ['Placed', formatDateTime(o.createdAt)],
              ['Accepted', formatDateTime(o.acceptedAt)],
              ['Dispatched', formatDateTime(o.dispatchedAt)],
              ['Delivered', formatDateTime(o.deliveredAt)],
              ['Cancel reason', o.cancelReason],
              ['Prescription', o.prescriptionId ? 'Attached' : 'None'],
            ]}
          />

          <div className="card">
            <h3>Items</h3>
            <table>
              <tbody>
                {(o.items ?? []).map((item, i) => (
                  <tr key={i}>
                    <td>{item.name ?? item.medicineId ?? 'Item'}</td>
                    <td className="num">× {item.quantity}</td>
                    <td className="num">{item.price !== undefined ? money(item.price) : '—'}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Delivery</strong>
                  </td>
                  <td />
                  <td className="num">{money(o.deliveryFee)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td />
                  <td className="num">
                    <strong>{money(o.totalAmount)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Payment</h3>
            {!o.payment ? (
              <p className="inline-note">No payment record is linked to this order.</p>
            ) : (
              <>
                <Facts
                  rows={[
                    ['Status', <Status value={o.payment.status} />],
                    ['Method', o.payment.method],
                    ['Charged', money(o.payment.amount)],
                    ['Platform fee', money(o.payment.platformFee)],
                    ['Refunded', o.payment.refundedAmount > 0 ? money(o.payment.refundedAmount) : '—'],
                    ['Refund reason', o.payment.refundReason],
                    ['Gateway', o.payment.gateway],
                    ['Paid at', formatDateTime(o.payment.paidAt)],
                  ]}
                />
                {o.payment.splits.length > 0 ? (
                  <table style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>Payee</th>
                        <th className="num">Amount</th>
                        <th>Settlement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.payment.splits.map((s) => (
                        <tr key={s.id}>
                          <td>{s.payeeType}</td>
                          <td className="num">{money(s.amount)}</td>
                          <td>
                            <Status value={s.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </>
            )}
          </div>

          <div className="card">
            <h3>Stock movements</h3>
            {state.data.stockMovements.length === 0 ? (
              <p className="inline-note">
                Nothing has moved off a shelf for this order yet. Units are reserved at payment and
                deducted at dispatch.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th className="num">Change</th>
                    <th className="num">Balance after</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.stockMovements.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Status value={m.reason} tone="neutral" />
                      </td>
                      <td className="num">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                      <td className="num">{m.balanceAfter}</td>
                      <td className="sub">{formatDateTime(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
};

export const Orders: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const status = params.get('status') ?? '';
  const unassigned = params.get('unassigned') === 'true';

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
    setPage(1);
  };

  const list = useAsync(
    () =>
      fetchOrders({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        ...(unassigned ? { unassigned: true } : {}),
        page,
        limit: 25,
      }),
    [term, status, unassigned, page]
  );

  return (
    <>
      <PageHead
        title="Medicine orders"
        lead="Every order, across every pharmacy. Cancelling here refunds the customer, releases the reserved stock and notifies them — the same path a pharmacy's own cancellation takes."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Order id, patient, phone, pharmacy or address"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <label className="checkbox" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={unassigned}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.checked) next.set('unassigned', 'true');
              else next.delete('unassigned');
              setParams(next, { replace: true });
              setPage(1);
            }}
          />
          <span>Nobody carrying it</span>
        </label>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.orders.length === 0}
        emptyTitle="No orders match those filters"
      >
        {(data) => (
          <>
            <p className="inline-note">
              {data.total.toLocaleString()} order{data.total === 1 ? '' : 's'} matching, worth{' '}
              {money(data.matchedValue)}.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Patient</th>
                    <th>Pharmacy</th>
                    <th className="num">Total</th>
                    <th>Payment</th>
                    <th>Carried by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} onClick={() => setOpenId(o.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn mono">{o.id.slice(0, 8)}</button>
                        <span className="sub">{formatDateTime(o.createdAt)}</span>
                      </td>
                      <td>
                        {o.patient.fullName}
                        <span className="sub mono">{o.patient.user.phoneNumber}</span>
                      </td>
                      <td>{o.pharmacy?.name ?? <span className="sub">Unassigned</span>}</td>
                      <td className="num">{money(o.totalAmount)}</td>
                      <td>
                        <PaymentCell order={o} />
                      </td>
                      <td>
                        {/* A rider carries a parcel, so an order split between
                            two shops can be with two people at once. */}
                        {o.riders.length === 0 ? (
                          <span className="sub">—</span>
                        ) : o.riders.length === 1 ? (
                          <>
                            {o.riders[0]!.name ?? 'Unnamed'}
                            <span className="sub mono">{o.riders[0]!.phoneNumber}</span>
                          </>
                        ) : (
                          `${o.riders.length} riders`
                        )}
                      </td>
                      <td>
                        <Status value={o.status} />
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

      {openId ? (
        <OrderDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
      ) : null}
    </>
  );
};

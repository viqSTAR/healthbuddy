import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchPayment, fetchPayments } from '../api/endpoints';
import {
  Drawer,
  ErrorState,
  Facts,
  Loading,
  PageHead,
  Pager,
  Resource,
  SearchBox,
  Stat,
  Status,
  formatDateTime,
  money,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * The money ledger.
 *
 * The detail view leads with reconciliation: the settlement legs must add up to
 * exactly what the payer was charged. The arithmetic is done in integer paise
 * with the platform taking the remainder, so a difference is never rounding —
 * it is a bug, and showing it as a red line is the only way anyone finds out.
 */

const PaymentDrawer: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const state = useAsync(() => fetchPayment(id), [id]);

  return (
    <Drawer
      open
      title={state.data ? `Payment ${state.data.payment.id.slice(0, 8)}` : 'Payment'}
      subtitle={state.data?.payment.user.phoneNumber}
      onClose={onClose}
    >
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !state.data ? null : (
        <>
          {!state.data.reconciliation.balanced ? (
            <div className="banner error">
              The settlement legs do not add up to the amount charged — a difference of{' '}
              {money(state.data.reconciliation.difference)}. Splits are computed in whole paise with
              the platform absorbing the remainder, so this is a defect rather than rounding.
            </div>
          ) : null}

          <Facts
            rows={[
              ['Status', <Status value={state.data.payment.status} />],
              ['For', state.data.payment.purpose.replace(/_/g, ' ').toLowerCase()],
              ['Method', state.data.payment.method],
              ['Charged', <strong>{money(state.data.payment.amount)}</strong>],
              ['Platform fee', money(state.data.payment.platformFee)],
              [
                'Refunded',
                state.data.payment.refundedAmount > 0
                  ? `${money(state.data.payment.refundedAmount)} · ${state.data.payment.refundReason ?? 'no reason given'}`
                  : null,
              ],
              ['Gateway', state.data.payment.gateway],
              ['Gateway payment id', <span className="mono">{state.data.payment.gatewayPaymentId}</span>],
              ['Gateway order id', <span className="mono">{state.data.payment.gatewayOrderId}</span>],
              ['Failure', state.data.payment.failureReason],
              ['Created', formatDateTime(state.data.payment.createdAt)],
              ['Paid', formatDateTime(state.data.payment.paidAt)],
            ]}
          />

          <div className="card">
            <h3>Settlement legs</h3>
            <p className="inline-note">
              The platform is a marketplace: the pharmacy sells the medicine and the lab runs the
              test. Collecting the whole amount and paying partners later would make this an RBI
              payment aggregator, so the licensed gateway splits at settlement and these rows are
              the record of the arithmetic.
            </p>
            {state.data.payment.splits.length === 0 ? (
              <p className="inline-note">No splits were computed for this payment.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th className="num">Amount</th>
                    <th>Payout account</th>
                    <th>Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.payment.splits.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.payeeName ?? s.payeeType}</strong>
                        <span className="sub">{s.payeeType.toLowerCase()}</span>
                      </td>
                      <td className="num">{money(s.amount)}</td>
                      <td>
                        {s.payoutAccountId ? (
                          <span className="mono">{s.payoutAccountId}</span>
                        ) : s.payeeType === 'PLATFORM' ? (
                          <span className="sub">—</span>
                        ) : (
                          <Status value="NOT ONBOARDED" tone="warning" />
                        )}
                      </td>
                      <td>
                        <Status value={s.status} />
                        {s.settledAt ? (
                          <span className="sub">{formatDateTime(s.settledAt)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Legs total</strong>
                    </td>
                    <td className="num">
                      <strong>{money(state.data.reconciliation.legTotal)}</strong>
                    </td>
                    <td colSpan={2}>
                      {state.data.reconciliation.balanced ? (
                        <Status value="BALANCED" tone="success" />
                      ) : (
                        <Status
                          value={`OUT BY ${money(state.data.reconciliation.difference)}`}
                          tone="danger"
                        />
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>What this paid for</h3>
            {state.data.payment.appointment ? (
              <Facts
                rows={[
                  ['Consultation', state.data.payment.appointment.doctor.name],
                  ['Patient', state.data.payment.appointment.patient.fullName],
                  ['Status', <Status value={state.data.payment.appointment.status} />],
                ]}
              />
            ) : null}
            {state.data.payment.medicineOrder ? (
              <Facts
                rows={[
                  ['Order', <span className="mono">{state.data.payment.medicineOrder.id.slice(0, 8)}</span>],
                  ['Pharmacy', state.data.payment.medicineOrder.pharmacy?.name ?? null],
                  ['Status', <Status value={state.data.payment.medicineOrder.status} />],
                ]}
              />
            ) : null}
            {state.data.payment.labOrder ? (
              <Facts
                rows={[
                  ['Test', state.data.payment.labOrder.testName],
                  ['Lab', state.data.payment.labOrder.labPartner?.name ?? null],
                  ['Status', <Status value={state.data.payment.labOrder.status} />],
                ]}
              />
            ) : null}
            {state.data.payment.fulfilment ? (
              <>
                <p className="inline-note">
                  One approved prescription basket — medicines and tests paid for together, so the
                  patient faced one checkout rather than three.
                </p>
                <Facts
                  rows={[
                    ['Medicines', money(state.data.payment.fulfilment.medicineTotal)],
                    ['Tests', money(state.data.payment.fulfilment.labTotal)],
                    ['Delivery', money(state.data.payment.fulfilment.deliveryFee)],
                    [
                      'Orders created',
                      `${state.data.payment.fulfilment.medicineOrders.length} medicine, ${state.data.payment.fulfilment.labOrders.length} lab`,
                    ],
                  ]}
                />
              </>
            ) : null}
            {!state.data.payment.appointment &&
            !state.data.payment.medicineOrder &&
            !state.data.payment.labOrder &&
            !state.data.payment.fulfilment ? (
              <p className="inline-note">
                This payment is not linked to anything. That should not happen — every charge is
                created against a target.
              </p>
            ) : null}
          </div>
        </>
      )}
    </Drawer>
  );
};

export const Payments: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDebounced(search);

  const status = params.get('status') ?? '';
  const purpose = params.get('purpose') ?? '';
  const method = params.get('method') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const list = useAsync(
    () =>
      fetchPayments({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        ...(purpose ? { purpose } : {}),
        ...(method ? { method } : {}),
        page,
        limit: 25,
      }),
    [term, status, purpose, method, page]
  );

  return (
    <>
      <PageHead
        title="Payments"
        lead="Every charge and its settlement legs. The platform never holds a partner's share — the licensed gateway splits it."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Payment id, gateway reference or phone"
        />
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="FAILED">Failed</option>
          <option value="REFUNDED">Refunded</option>
          <option value="PARTIALLY_REFUNDED">Partially refunded</option>
        </select>
        <select value={purpose} onChange={(e) => setParam('purpose', e.target.value)}>
          <option value="">Anything</option>
          <option value="APPOINTMENT">Consultation</option>
          <option value="MEDICINE_ORDER">Medicine order</option>
          <option value="LAB_ORDER">Lab test</option>
          <option value="PRESCRIPTION_BASKET">Prescription basket</option>
        </select>
        <select value={method} onChange={(e) => setParam('method', e.target.value)}>
          <option value="">Any method</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card</option>
          <option value="NETBANKING">Netbanking</option>
          <option value="WALLET">Wallet</option>
          <option value="COD">Cash on delivery</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.payments.length === 0}
        emptyTitle="No payments match those filters"
      >
        {(data) => (
          <>
            <div className="stat-grid">
              <Stat label="Collected (matching)" value={money(data.totals.collected)} accent />
              <Stat label="Platform fee" value={money(data.totals.platformFee)} />
              <Stat label="Refunded" value={money(data.totals.refunded)} />
              <Stat label="Payments" value={data.total.toLocaleString()} />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Payer</th>
                    <th>For</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                    <th className="num">Platform fee</th>
                    <th className="num">Legs</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} onClick={() => setOpenId(p.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <button className="link-btn mono">{p.id.slice(0, 8)}</button>
                        <span className="sub">{formatDateTime(p.createdAt)}</span>
                      </td>
                      <td className="mono">{p.user.phoneNumber}</td>
                      <td>{p.purpose.replace(/_/g, ' ').toLowerCase()}</td>
                      <td>{p.method}</td>
                      <td className="num">
                        {money(p.amount)}
                        {p.refundedAmount > 0 ? (
                          <span className="sub">−{money(p.refundedAmount)}</span>
                        ) : null}
                      </td>
                      <td className="num">{money(p.platformFee)}</td>
                      <td className="num">{p._count.splits}</td>
                      <td>
                        <Status value={p.status} />
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

      {openId ? <PaymentDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
};

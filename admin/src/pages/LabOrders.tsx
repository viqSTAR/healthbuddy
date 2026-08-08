import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchLabOrders } from '../api/endpoints';
import {
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
 * Lab bookings across every partner.
 *
 * The report count matters more than it looks: a booking marked COMPLETED with
 * no document attached means the patient was told their result is ready and has
 * nothing to open.
 */

const STATUSES = [
  'PENDING_PAYMENT',
  'BOOKED',
  'ACCEPTED',
  'SAMPLE_COLLECTED',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED',
];

export const LabOrders: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);

  const status = params.get('status') ?? '';

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
    setPage(1);
  };

  const list = useAsync(
    () =>
      fetchLabOrders({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        page,
        limit: 25,
      }),
    [term, status, page]
  );

  return (
    <>
      <PageHead
        title="Lab bookings"
        lead="Every diagnostic booking. A completed test with no report attached is the failure worth catching here."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Booking id, test, patient, phone or lab"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.labOrders.length === 0}
        emptyTitle="No bookings match those filters"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Patient</th>
                    <th>Lab</th>
                    <th className="num">Price</th>
                    <th>Payment</th>
                    <th>Report</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.labOrders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.testName}</strong>
                        <span className="sub">{formatDateTime(o.createdAt)}</span>
                      </td>
                      <td>
                        {o.patient.fullName}
                        <span className="sub mono">{o.patient.user.phoneNumber}</span>
                      </td>
                      <td>{o.labPartner?.name ?? <span className="sub">Unassigned</span>}</td>
                      <td className="num">{money(o.price)}</td>
                      <td>
                        {o.payment ? (
                          <>
                            <Status value={o.payment.status} />
                            <span className="sub">{o.payment.method}</span>
                          </>
                        ) : (
                          <span className="sub">No record</span>
                        )}
                      </td>
                      <td>
                        {o._count.documents > 0 ? (
                          <Status value="ATTACHED" tone="success" />
                        ) : o.status === 'COMPLETED' ? (
                          <Status value="MISSING" tone="danger" />
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td>
                        <Status value={o.status} />
                        {o.cancelReason ? <span className="sub">{o.cancelReason}</span> : null}
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
    </>
  );
};

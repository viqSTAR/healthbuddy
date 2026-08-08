import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAppointments } from '../api/endpoints';
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
 * Consultations.
 *
 * The columns are chosen so a support call resolves without opening anything
 * clinical: who saw whom, when, whether it started, whether it was paid for and
 * whether a prescription came out of it. What was diagnosed is not here, and
 * the endpoint behind this screen does not read it.
 *
 * `hasRoom` says a video room was minted without printing its id — on most
 * hosted services a room name is a bearer credential, so listing it would hand
 * out access to the consultation to anyone who can read this table.
 */
export const Appointments: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search);

  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const list = useAsync(
    () =>
      fetchAppointments({
        ...(term ? { search: term } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        page,
        limit: 25,
      }),
    [term, status, type, page]
  );

  return (
    <>
      <PageHead
        title="Consultations"
        lead="Who saw whom, when, and whether it was paid for. Clinical content is not shown here and is not read by this screen."
      />

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Patient, doctor or phone"
        />
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={type} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">Any type</option>
          <option value="VIDEO">Video</option>
          <option value="IN_PERSON">In person</option>
        </select>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.appointments.length === 0}
        emptyTitle="No consultations match those filters"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Doctor</th>
                    <th>Slot</th>
                    <th>Type</th>
                    <th className="num">Fee</th>
                    <th>Payment</th>
                    <th>Prescription</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.appointments.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.patient.fullName}
                        <span className="sub mono">{a.patient.user.phoneNumber}</span>
                      </td>
                      <td>
                        {a.doctor.name}
                        <span className="sub">{a.doctor.specialty}</span>
                      </td>
                      <td>
                        {a.slot.date}
                        <span className="sub">
                          {a.slot.startTime}–{a.slot.endTime}
                        </span>
                      </td>
                      <td>
                        {a.type === 'VIDEO' ? 'Video' : 'In person'}
                        {a.isFollowUp ? <span className="sub">Follow-up</span> : null}
                        {a.type === 'VIDEO' && a.hasRoom ? (
                          <span className="sub">Room created</span>
                        ) : null}
                      </td>
                      <td className="num">{money(a.doctor.consultationFee)}</td>
                      <td>
                        {a.payment ? (
                          <>
                            <Status value={a.payment.status} />
                            <span className="sub">
                              {a.payment.method} · {money(a.payment.amount)}
                            </span>
                          </>
                        ) : (
                          <span className="sub">No record</span>
                        )}
                      </td>
                      <td>
                        {a.prescription ? (
                          <Status value="ISSUED" tone="success" />
                        ) : a.status === 'COMPLETED' ? (
                          <span className="sub">None issued</span>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td>
                        <Status value={a.status} />
                        {a.startedAt ? (
                          <span className="sub">started {formatDateTime(a.startedAt)}</span>
                        ) : null}
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

import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import {
  assignOrderAgent,
  fetchAgents,
  fetchDeliveryBoard,
  type DeliveryJob,
  type DeliveryStage,
} from '../api/endpoints';
import {
  Drawer,
  Facts,
  PageHead,
  Resource,
  Stat,
  Status,
  Tabs,
  duration,
  formatDateTime,
  money,
  useAsync,
} from '../components/ui';

/**
 * The dispatch board.
 *
 * There is no rider identity on this platform. `assignedAgentUserId` on an
 * order points at whichever partner-staff account picked the job up, which is
 * what the partner apps already write to. So this board tracks delivery WORK,
 * and the roster below it is derived from who is actually carrying orders
 * rather than read from a riders table that does not exist.
 *
 * A real rider role is a product, not a screen: a registration and verification
 * flow, a rider app with live location, cash-on-delivery reconciliation, and
 * shift and payout rules. Building the roster UI first would mean an empty list
 * that looks broken and a set of buttons that write to nothing.
 *
 * What the board does give an operator is the thing that actually goes wrong in
 * quick commerce: an order sitting in a lane with nobody on it. Age in stage is
 * the primary column for exactly that reason.
 */

const LANES: { key: DeliveryStage; label: string; note: string }[] = [
  { key: 'PLACED', label: 'Waiting for a shop', note: 'Paid, nobody has accepted it' },
  { key: 'ACCEPTED', label: 'Accepted', note: 'A shop has it, not yet packed' },
  { key: 'PROCESSING', label: 'Being packed', note: 'Stock still reserved' },
  { key: 'DISPATCHED', label: 'Out for delivery', note: 'Stock deducted, on its way' },
];

const JobCard: React.FC<{ job: DeliveryJob; onOpen: () => void }> = ({ job, onOpen }) => (
  <button className={`job${job.stalled ? ' stalled' : ''}`} onClick={onOpen}>
    <div className="who">{job.patient.fullName}</div>
    <div className="line">
      <span>{job.pharmacy?.name ?? 'No shop yet'}</span>
      <span>{money(job.totalAmount)}</span>
    </div>
    <div className="line">
      <span>{job.assignedAgent ? job.assignedAgent.phoneNumber : 'Nobody carrying it'}</span>
      <span>{duration(job.minutesInStage)}</span>
    </div>
  </button>
);

const AssignDrawer: React.FC<{
  job: DeliveryJob;
  onClose: () => void;
  onChanged: () => void;
}> = ({ job, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agents = useAsync(() => fetchAgents(), []);

  const assign = async (agentUserId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await assignOrderAgent(job.id, agentUserId);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title={`Order ${job.id.slice(0, 8)}`}
      subtitle={`${job.patient.fullName} · ${job.patient.user.phoneNumber}`}
      onClose={onClose}
      footer={
        job.assignedAgent ? (
          <button className="btn outline sm" disabled={busy} onClick={() => void assign(null)}>
            Take it off {job.assignedAgent.phoneNumber}
          </button>
        ) : null
      }
    >
      {error ? <div className="banner error">{error}</div> : null}
      {job.stalled ? (
        <div className="banner warning">
          No shop has accepted this order in over half an hour. The customer has paid and is
          waiting.
        </div>
      ) : null}

      <Facts
        rows={[
          ['Status', <Status value={job.status} />],
          ['In this stage for', duration(job.minutesInStage)],
          ['Pharmacy', job.pharmacy?.name ?? 'Not assigned'],
          ['Address', job.address],
          ['Total', money(job.totalAmount)],
          [
            'Payment',
            job.payment ? (
              <>
                <Status value={job.payment.status} /> {job.payment.method}
              </>
            ) : null,
          ],
          ['Placed', formatDateTime(job.createdAt)],
          ['Carried by', job.assignedAgent?.phoneNumber ?? 'Nobody'],
        ]}
      />

      <div className="card">
        <h3>Hand it to someone</h3>
        <p className="inline-note">
          Only partner and admin accounts can be given a delivery — there is no rider account type
          yet, so this is the shop staff who will actually carry it.
        </p>

        <Resource
          state={agents}
          isEmpty={(list) => list.length === 0}
          emptyTitle="No account is available to carry this"
        >
          {(list) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Role</th>
                    <th className="num">Open jobs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.name ?? <span className="sub">Unnamed</span>}
                        <span className="sub mono">{a.phoneNumber}</span>
                      </td>
                      <td>
                        <Status value={a.role} />
                      </td>
                      <td className="num">{a.openWork}</td>
                      <td>
                        <button
                          className="btn sm"
                          disabled={busy || a.id === job.assignedAgent?.id}
                          onClick={() => void assign(a.id)}
                        >
                          {a.id === job.assignedAgent?.id ? 'Carrying' : 'Assign'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Resource>
      </div>
    </Drawer>
  );
};

export const Deliveries: React.FC = () => {
  const [tab, setTab] = useState('board');
  const [open, setOpen] = useState<DeliveryJob | null>(null);
  const board = useAsync(() => fetchDeliveryBoard(), []);

  return (
    <>
      <PageHead
        title="Deliveries"
        lead="Everything paid for and not yet handed over, with how long it has been sitting."
        actions={
          <button className="btn outline" onClick={board.reload}>
            Refresh
          </button>
        }
      />

      <Resource state={board}>
        {(b) => {
          const total = LANES.reduce((n, l) => n + (b.lanes[l.key]?.length ?? 0), 0);

          return (
            <>
              <div className="stat-grid">
                <Stat label="In flight" value={total} hint="Paid and not yet delivered" />
                <Stat
                  label="Nobody carrying it"
                  value={b.unassigned}
                  {...(b.unassigned > 0 ? { tone: 'warning' as const } : {})}
                />
                <Stat
                  label="Stalled"
                  value={b.stalled}
                  hint="Unaccepted for over 30 minutes"
                  {...(b.stalled > 0 ? { tone: 'danger' as const } : {})}
                />
                <Stat label="Sample runs" value={b.sampleRuns.length} hint="Lab collections open" />
              </div>

              <Tabs
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: 'board', label: 'Dispatch board', count: total },
                  { key: 'agents', label: 'Who is carrying what', count: b.agents.length },
                  { key: 'samples', label: 'Sample collection', count: b.sampleRuns.length },
                ]}
              />

              {tab === 'board' ? (
                total === 0 ? (
                  <div className="banner info">
                    Nothing is in flight. Every paid order has been delivered or cancelled.
                  </div>
                ) : (
                  <div className="lanes">
                    {LANES.map((lane) => {
                      const jobs = b.lanes[lane.key] ?? [];
                      return (
                        <div className="lane" key={lane.key}>
                          <h3>
                            <span>{lane.label}</span>
                            <span>{jobs.length}</span>
                          </h3>
                          {jobs.length === 0 ? (
                            <p className="inline-note">{lane.note}</p>
                          ) : (
                            jobs.map((job) => (
                              <JobCard key={job.id} job={job} onOpen={() => setOpen(job)} />
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : null}

              {tab === 'agents' ? (
                <>
                  <p className="inline-note">
                    Derived from who is actually carrying orders right now. There is no rider
                    account type on the platform yet, so these are partner staff accounts — building
                    a real rider role means a registration flow, a rider app with live location and
                    cash reconciliation, not another table here.
                  </p>
                  {b.agents.length === 0 ? (
                    <div className="banner info">Nobody is carrying an order right now.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Account</th>
                            <th className="num">Orders in hand</th>
                            <th className="num">Oldest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.agents.map((a) => (
                            <tr key={a.id}>
                              <td className="mono">{a.phoneNumber}</td>
                              <td className="num">{a.orders}</td>
                              <td className="num">{duration(a.oldestMinutes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}

              {tab === 'samples' ? (
                b.sampleRuns.length === 0 ? (
                  <div className="banner info">No sample collections are open.</div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Patient</th>
                          <th>Lab</th>
                          <th>Scheduled</th>
                          <th>Collector</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.sampleRuns.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.testName}</strong>
                              <span className="sub">{r.address ?? 'At the lab'}</span>
                            </td>
                            <td>
                              {r.patient.fullName}
                              <span className="sub mono">{r.patient.user.phoneNumber}</span>
                            </td>
                            <td>{r.labPartner?.name ?? <span className="sub">Unassigned</span>}</td>
                            <td>{formatDateTime(r.scheduledAt)}</td>
                            <td className="mono">
                              {r.assignedAgent?.phoneNumber ?? <span className="sub">—</span>}
                            </td>
                            <td>
                              <Status value={r.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
            </>
          );
        }}
      </Resource>

      {open ? (
        <AssignDrawer
          job={open}
          onClose={() => setOpen(null)}
          onChanged={board.reload}
        />
      ) : null}
    </>
  );
};

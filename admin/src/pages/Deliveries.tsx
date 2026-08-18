import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import {
  assignOrderAgent,
  fetchAgents,
  fetchDeliveryBoard,
  type DeliveryJob,
  type DeliveryStage,
  type LastSeen,
  type Parcel,
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
 * A rider carries a parcel, not an order: an order filled by two shops is two
 * parcels, two riders and two positions. This board used to read an order-level
 * rider column that nothing wrote once riders started claiming parcels from the
 * pool, so every order in flight displayed as "nobody carrying it" while a fleet
 * was out delivering, and the roster tab was permanently empty.
 *
 * What an operator gets here is the thing that actually goes wrong in quick
 * commerce: a parcel sitting in a lane with nobody on it. Age in stage is the
 * primary column for exactly that reason, and the roster shows who is clocked on
 * with an empty bag — the two halves of the same question.
 *
 * Coordinates appear on this screen and nowhere else. The customer is told place
 * names; a dispatcher needs to know which junction the rider is stuck at.
 */

const LANES: { key: DeliveryStage; label: string; note: string }[] = [
  { key: 'PLACED', label: 'Waiting for a shop', note: 'Paid, nobody has accepted it' },
  { key: 'ACCEPTED', label: 'Accepted', note: 'A shop has it, not yet packed' },
  { key: 'PROCESSING', label: 'Being packed', note: 'Stock still reserved' },
  { key: 'DISPATCHED', label: 'Out for delivery', note: 'Stock deducted, on its way' },
];

/** How long ago a position was reported, in words. */
const ago = (at: string | null) => {
  if (!at) return 'never';
  const minutes = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  return `${duration(minutes)} ago`;
};

/**
 * A position, in text and coordinates.
 *
 * Both, deliberately. The name is what a dispatcher reads out to a customer on
 * the phone; the numbers are what they paste into a map when the name is a
 * suburb three kilometres wide.
 */
const Position: React.FC<{ seen: LastSeen; stale?: boolean }> = ({ seen, stale }) => (
  <div className="position">
    <span>{seen.place ?? 'Unnamed place'}</span>
    {seen.street && seen.street !== seen.place ? (
      <span className="sub">{seen.street}</span>
    ) : null}
    <a
      className="mono sub"
      href={`https://www.google.com/maps/search/?api=1&query=${seen.latitude},${seen.longitude}`}
      target="_blank"
      rel="noreferrer"
    >
      {seen.latitude.toFixed(5)}, {seen.longitude.toFixed(5)}
    </a>
    <span className={`sub${stale ? ' warn' : ''}`}>Seen {ago(seen.at)}</span>
  </div>
);

/** A fix older than this is worth flagging — the app may be closed. */
const STALE_MINUTES = 10;
const isStale = (at: string | null) =>
  !at || Date.now() - new Date(at).getTime() > STALE_MINUTES * 60_000;

const JobCard: React.FC<{ job: DeliveryJob; onOpen: () => void }> = ({ job, onOpen }) => {
  const rider = job.riders[0];
  const carrying = job.parcels.find((p) => p.lastSeen);

  return (
    <button className={`job${job.stalled ? ' stalled' : ''}`} onClick={onOpen}>
      <div className="who">{job.patient.fullName}</div>
      <div className="line">
        <span>{job.pharmacy?.name ?? 'No shop yet'}</span>
        <span>{money(job.totalAmount)}</span>
      </div>
      <div className="line">
        <span>
          {job.riders.length === 0
            ? 'Nobody carrying it'
            : job.riders.length > 1
              ? `${job.riders.length} riders`
              : rider!.name ?? rider!.phoneNumber}
        </span>
        <span>{duration(job.minutesInStage)}</span>
      </div>
      {carrying?.lastSeen ? (
        <div className="line sub">
          <span>{carrying.lastSeen.place ?? 'On the way'}</span>
          <span>{ago(carrying.lastSeen.at)}</span>
        </div>
      ) : null}
      {job.awaitingRider > 0 && job.riders.length > 0 ? (
        <div className="line sub warn">
          <span>{job.awaitingRider} parcel(s) still need a rider</span>
        </div>
      ) : null}
    </button>
  );
};

/** One parcel, with whoever has it and wherever they are. */
const ParcelRow: React.FC<{
  parcel: Parcel;
  multiple: boolean;
  busy: boolean;
  onHandOver: (shipmentId: string) => void;
}> = ({ parcel, multiple, busy, onHandOver }) => (
  <div className="parcel">
    <div className="parcel-head">
      <div>
        <strong>{parcel.pharmacy}</strong>
        <span className="sub mono">#{parcel.id.slice(0, 8)}</span>
      </div>
      <Status value={parcel.status} />
    </div>

    <Facts
      rows={[
        [
          'Rider',
          parcel.rider ? (
            <>
              {parcel.rider.name ?? 'Unnamed'}
              <span className="sub mono">{parcel.rider.phoneNumber}</span>
              {parcel.rider.vehicleNumber ? (
                <span className="sub">{parcel.rider.vehicleNumber}</span>
              ) : null}
            </>
          ) : (
            <span className="sub">Nobody has taken this parcel</span>
          ),
        ],
        [
          'Last seen',
          parcel.lastSeen ? (
            <Position seen={parcel.lastSeen} stale={isStale(parcel.lastSeen.at)} />
          ) : (
            <span className="sub">
              {parcel.rider
                ? 'No position reported — the rider may have location switched off'
                : '—'}
            </span>
          ),
        ],
        ...(parcel.nearlyThere
          ? [['Customer told', 'Arriving soon'] as [string, React.ReactNode]]
          : []),
      ]}
    />

    {parcel.trail.length > 0 ? (
      <details className="trail">
        <summary>Route so far ({parcel.trail.length})</summary>
        <ol>
          {parcel.trail.map((leg) => (
            <li key={`${leg.place}-${leg.at}`}>
              <span>{leg.place}</span>
              <a
                className="mono sub"
                href={`https://www.google.com/maps/search/?api=1&query=${leg.latitude},${leg.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                {leg.latitude.toFixed(4)}, {leg.longitude.toFixed(4)}
              </a>
              <span className="sub">{formatDateTime(leg.at)}</span>
            </li>
          ))}
        </ol>
      </details>
    ) : null}

    {/* Only worth offering per parcel when there is more than one to split. */}
    {multiple && parcel.status !== 'DELIVERED' && parcel.status !== 'CANCELLED' ? (
      <button className="btn outline sm" disabled={busy} onClick={() => onHandOver(parcel.id)}>
        Hand this parcel to someone else
      </button>
    ) : null}
  </div>
);

const AssignDrawer: React.FC<{
  job: DeliveryJob;
  onClose: () => void;
  onChanged: () => void;
}> = ({ job, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Null means every open parcel — what "give this order to Ramesh" means. */
  const [target, setTarget] = useState<string | null>(null);
  const agents = useAsync(() => fetchAgents(), []);

  const assign = async (agentUserId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await assignOrderAgent(job.id, agentUserId, target ?? undefined);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const multiple = job.parcels.length > 1;
  const targeted = target ? job.parcels.find((p) => p.id === target) : null;

  return (
    <Drawer
      open
      title={`Order ${job.id.slice(0, 8)}`}
      subtitle={`${job.patient.fullName} · ${job.patient.user.phoneNumber}`}
      onClose={onClose}
      footer={
        job.riders.length > 0 ? (
          <button className="btn outline sm" disabled={busy} onClick={() => void assign(null)}>
            {target ? 'Take this parcel back' : 'Take it off everyone'}
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
      {job.awaitingRider > 0 ? (
        <div className="banner warning">
          {job.awaitingRider} packed parcel(s) here have nobody carrying them. Riders claim from the
          pool themselves — hand one over below only if it has been sitting.
        </div>
      ) : null}

      <Facts
        rows={[
          ['Status', <Status value={job.status} />],
          ['In this stage for', duration(job.minutesInStage)],
          ['Address', job.address],
          ['Total', money(job.totalAmount)],
          [
            'Payment',
            job.payment ? (
              <>
                <Status value={job.payment.status} /> {job.payment.method}
                {job.paidAsBasket ? <span className="sub">Paid as part of a basket</span> : null}
              </>
            ) : null,
          ],
          ['Placed', formatDateTime(job.createdAt)],
        ]}
      />

      <div className="card">
        <h3>{multiple ? `Parcels (${job.parcels.length})` : 'The parcel'}</h3>
        <p className="inline-note">
          Where each one is. The customer sees these places by name; the coordinates are ours.
        </p>
        {job.parcels.map((parcel) => (
          <ParcelRow
            key={parcel.id}
            parcel={parcel}
            multiple={multiple}
            busy={busy}
            onHandOver={setTarget}
          />
        ))}
      </div>

      <div className="card">
        <h3>Hand it to a rider</h3>
        <p className="inline-note">
          {targeted
            ? `Assigning the parcel from ${targeted.pharmacy} only.`
            : multiple
              ? 'Assigning every open parcel on this order to one rider.'
              : 'Verified, active riders. Assigning puts it straight into their app.'}
          {targeted ? (
            <button className="btn ghost sm" onClick={() => setTarget(null)}>
              Assign the whole order instead
            </button>
          ) : null}
        </p>

        <Resource
          state={agents}
          isEmpty={(list) => list.length === 0}
          emptyTitle="No verified rider is available to carry this"
        >
          {(list) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Shift</th>
                    <th className="num">In hand</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const has = job.parcels.some((p) => p.rider?.id === a.id);
                    return (
                      <tr key={a.id}>
                        <td>
                          {a.name}
                          <span className="sub mono">{a.phoneNumber}</span>
                          {a.vehicleNumber ? <span className="sub">{a.vehicleNumber}</span> : null}
                        </td>
                        <td>
                          {/* On shift first in the list, so say which is which. */}
                          <Status
                            value={a.onShift ? 'ON SHIFT' : 'OFF SHIFT'}
                            tone={a.onShift ? 'success' : 'neutral'}
                          />
                        </td>
                        <td className="num">{a.openWork}</td>
                        <td>
                          <button
                            className="btn sm"
                            disabled={busy || (has && !target)}
                            onClick={() => void assign(a.id)}
                          >
                            {has && !target ? 'Carrying' : 'Assign'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
        lead="Everything paid for and not yet handed over, with how long it has been sitting and who has it."
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
                  hint="Packed parcels still in the pool"
                  {...(b.unassigned > 0 ? { tone: 'warning' as const } : {})}
                />
                <Stat
                  label="Stalled"
                  value={b.stalled}
                  hint="Unaccepted for over 30 minutes"
                  {...(b.stalled > 0 ? { tone: 'danger' as const } : {})}
                />
                <Stat
                  label="Riders free"
                  value={b.idleRiders}
                  hint="On shift with an empty bag"
                  {...(b.unassigned > 0 && b.idleRiders === 0
                    ? { tone: 'danger' as const }
                    : {})}
                />
              </div>

              <Tabs
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: 'board', label: 'Dispatch board', count: total },
                  { key: 'fleet', label: 'Where the riders are', count: b.fleet.length },
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

              {tab === 'fleet' ? (
                <>
                  <p className="inline-note">
                    Riders on shift or holding a parcel. A position older than {STALE_MINUTES}{' '}
                    minutes is flagged — reporting is foreground-only, so it usually means the app
                    is closed rather than the rider is lost.
                  </p>
                  {b.fleet.length === 0 ? (
                    <div className="banner info">
                      Nobody is on shift and nobody is carrying anything.
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Rider</th>
                            <th>Shift</th>
                            <th className="num">In hand</th>
                            <th className="num">Oldest</th>
                            <th>Last seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.fleet.map((r) => (
                            <tr key={r.id}>
                              <td>
                                {r.name}
                                <span className="sub mono">{r.phoneNumber}</span>
                                {r.vehicleNumber ? (
                                  <span className="sub">{r.vehicleNumber}</span>
                                ) : null}
                              </td>
                              <td>
                                <Status
                                  value={r.onShift ? 'ON SHIFT' : 'OFF SHIFT'}
                                  tone={r.onShift ? 'success' : 'neutral'}
                                />
                              </td>
                              <td className="num">
                                {r.parcels}
                                {r.carrying > 0 ? (
                                  <span className="sub">{r.carrying} out for delivery</span>
                                ) : null}
                              </td>
                              <td className="num">
                                {r.parcels > 0 ? duration(r.oldestMinutes) : '—'}
                              </td>
                              <td>
                                {r.lastSeen ? (
                                  <Position seen={r.lastSeen} stale={isStale(r.lastSeen.at)} />
                                ) : (
                                  <span className="sub">
                                    {r.parcels > 0 ? 'No position reported' : 'Nothing in hand'}
                                  </span>
                                )}
                              </td>
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
        <AssignDrawer job={open} onClose={() => setOpen(null)} onChanged={board.reload} />
      ) : null}
    </>
  );
};

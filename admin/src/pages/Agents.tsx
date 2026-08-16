import React, { useState } from 'react';
import { errorMessage } from '../api/client';
import {
  fetchAgentRoster,
  fetchLabs,
  updateAgent,
  type AgentRow,
} from '../api/endpoints';
import {
  Drawer,
  Facts,
  PageHead,
  Pager,
  Resource,
  SearchBox,
  Status,
  formatDate,
  useAsync,
  useDebounced,
} from '../components/ui';

/**
 * Riders and sample collectors.
 *
 * This page is a work queue before it is a directory. Agents sign themselves
 * up, and an unverified one cannot take a single job — taking a job is what
 * discloses a patient's name, phone number and door number, so somebody has to
 * look at who is asking first. Unverified agents sort to the top for that
 * reason.
 *
 * Attaching a lab is the other decision made here. Carrying a sealed parcel is
 * commodity logistics and anyone verified may do it; drawing a blood sample is
 * a clinical act, so a collector belongs to the lab that trained them and only
 * that lab may hand them sample work.
 */

const STATES = [
  { value: 'UNVERIFIED', label: 'Waiting for verification' },
  { value: '', label: 'All agents' },
  { value: 'ACTIVE', label: 'Verified and active' },
  { value: 'ON_SHIFT', label: 'On shift now' },
  { value: 'INACTIVE', label: 'Deactivated' },
] as const;

const AgentState: React.FC<{ agent: AgentRow }> = ({ agent }) => {
  if (!agent.isActive) return <Status value="DEACTIVATED" tone="danger" />;
  if (!agent.verifiedAt) return <Status value="UNVERIFIED" tone="warning" />;
  return (
    <>
      <Status value="VERIFIED" tone="success" />
      {agent.isAvailable ? <span className="sub">On shift</span> : <span className="sub">Off shift</span>}
    </>
  );
};

export const Agents: React.FC = () => {
  const [state, setState] = useState<'' | 'UNVERIFIED' | 'ACTIVE' | 'INACTIVE' | 'ON_SHIFT'>(
    'UNVERIFIED'
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AgentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(search);

  const list = useAsync(
    () =>
      fetchAgentRoster({
        page,
        limit: 20,
        ...(term ? { search: term } : {}),
        ...(state ? { state } : {}),
      }),
    [term, state, page]
  );

  // Only needed when the drawer is open, but labs are few and it keeps the
  // select from flickering in on first paint.
  const labs = useAsync(() => fetchLabs({ page: 1, limit: 100 }), []);

  const apply = async (
    id: string,
    patch: { verified?: boolean; isActive?: boolean; labPartnerId?: string | null }
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateAgent(id, patch);
      setOpen((prev) => (prev ? { ...prev, ...updated } : prev));
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Delivery agents"
        lead="Riders carry sealed parcels from the open pool. Sample collection needs a lab behind the collector — attach one here."
      />

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Name, phone or vehicle" />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value as typeof state);
            setPage(1);
          }}
        >
          {STATES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.agents.length === 0}
        emptyTitle="No agents match"
        emptyMessage={
          state === 'UNVERIFIED'
            ? 'Nobody is waiting to be verified right now.'
            : undefined
        }
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Phone</th>
                    <th>Areas</th>
                    <th>Sample collection</th>
                    <th>State</th>
                    <th>Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.id} onClick={() => setOpen(agent)} className="clickable">
                      <td>
                        <strong>{agent.name}</strong>
                        {agent.vehicleNumber ? (
                          <span className="sub">{agent.vehicleNumber}</span>
                        ) : null}
                      </td>
                      <td>{agent.user.phoneNumber}</td>
                      <td>
                        {agent.serviceAreas.length === 0 ? (
                          <span className="sub">None declared</span>
                        ) : (
                          <>
                            {agent.serviceAreas.slice(0, 3).join(', ')}
                            {agent.serviceAreas.length > 3 ? (
                              <span className="sub">+{agent.serviceAreas.length - 3} more</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {agent.labPartner ? (
                          agent.labPartner.name
                        ) : (
                          <span className="sub">Deliveries only</span>
                        )}
                      </td>
                      <td>
                        <AgentState agent={agent} />
                      </td>
                      <td>{formatDate(agent.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Resource>

      <Drawer
        open={open !== null}
        title={open?.name ?? 'Agent'}
        subtitle={open?.user.phoneNumber}
        onClose={() => {
          setOpen(null);
          setError(null);
        }}
      >
        {open ? (
          <>
            <Facts
              rows={[
                ['Vehicle', open.vehicleNumber ?? '—'],
                ['Areas', open.serviceAreas.join(', ') || 'None declared'],
                ['State', <AgentState key="s" agent={open} />],
                ['Verified', open.verifiedAt ? formatDate(open.verifiedAt) : 'Not yet'],
                ['Signed up', formatDate(open.createdAt)],
                ['Collects for', open.labPartner?.name ?? 'Deliveries only'],
              ]}
            />

            {error ? <p className="error-text">{error}</p> : null}

            {/*
              Verification is the gate on every job, so it is the first control
              here rather than buried under the edit fields.
            */}
            <div className="drawer-section">
              <h4>Verification</h4>
              <p className="sub">
                A job shows this person a patient&apos;s home address. Check their ID and vehicle
                before verifying.
              </p>
              {open.verifiedAt ? (
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() => void apply(open.id, { verified: false })}
                >
                  Withdraw verification
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void apply(open.id, { verified: true })}
                >
                  Verify this agent
                </button>
              )}
            </div>

            <div className="drawer-section">
              <h4>Sample collection</h4>
              <p className="sub">
                Only a collector a lab has taken on may draw a sample. Attaching a lab is that
                lab vouching for them.
              </p>
              <select
                value={open.labPartner?.id ?? ''}
                disabled={busy}
                onChange={(e) => void apply(open.id, { labPartnerId: e.target.value || null })}
              >
                <option value="">Deliveries only</option>
                {(labs.data?.labs ?? []).map((lab) => (
                  <option key={lab.id} value={lab.id}>
                    {lab.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="drawer-section">
              <h4>Account</h4>
              <p className="sub">
                Deactivating also releases any parcel they have not collected yet, so the shop
                is not left waiting on a delivery nobody is making.
              </p>
              <button
                className={open.isActive ? 'btn danger' : 'btn'}
                disabled={busy}
                onClick={() => void apply(open.id, { isActive: !open.isActive })}
              >
                {open.isActive ? 'Deactivate agent' : 'Reactivate agent'}
              </button>
            </div>
          </>
        ) : null}
      </Drawer>
    </>
  );
};

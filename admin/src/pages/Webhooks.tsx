import React, { useState } from 'react';
import { fetchWebhookEvents } from '../api/endpoints';
import {
  PageHead,
  Pager,
  Resource,
  Status,
  formatDateTime,
  useAsync,
} from '../components/ui';

/**
 * What the payment gateway has told us.
 *
 * Each event is recorded under a unique key *before* it is acted on, so a
 * redelivery — which gateways do routinely — cannot apply the same settlement
 * twice. An unprocessed row therefore means one specific thing: the gateway
 * moved money and this platform did not react to it. That is a reconciliation
 * gap, not a log line, which is why it has its own screen.
 */
export const Webhooks: React.FC = () => {
  const [onlyFailed, setOnlyFailed] = useState(true);
  const [page, setPage] = useState(1);

  const list = useAsync(
    () => fetchWebhookEvents({ ...(onlyFailed ? { onlyFailed: true } : {}), page, limit: 25 }),
    [onlyFailed, page]
  );

  return (
    <>
      <PageHead
        title="Gateway webhooks"
        lead="Events the payment gateway delivered. An unprocessed one means money moved there and did not move here."
      />

      <div className="toolbar">
        <label className="checkbox" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => {
              setOnlyFailed(e.target.checked);
              setPage(1);
            }}
          />
          <span>Only unprocessed or errored</span>
        </label>
        <button className="btn outline" onClick={list.reload}>
          Refresh
        </button>
      </div>

      <Resource
        state={list}
        isEmpty={(d) => d.events.length === 0}
        emptyTitle={onlyFailed ? 'Every webhook was processed' : 'No webhooks have arrived yet'}
        emptyMessage={
          onlyFailed
            ? 'Nothing the gateway sent is sitting unacted on.'
            : 'The gateway has not delivered any events to this environment.'
        }
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Gateway</th>
                    <th>Gateway id</th>
                    <th>Received</th>
                    <th>Processed</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.eventType}</strong>
                      </td>
                      <td>{e.gateway}</td>
                      <td className="mono">{e.eventId}</td>
                      <td>{formatDateTime(e.createdAt)}</td>
                      <td>{formatDateTime(e.processedAt)}</td>
                      <td>
                        {e.error ? (
                          <>
                            <Status value="FAILED" tone="danger" />
                            <span className="sub">{e.error}</span>
                          </>
                        ) : e.processedAt ? (
                          <Status value="PROCESSED" tone="success" />
                        ) : (
                          <Status value="UNPROCESSED" tone="warning" />
                        )}
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

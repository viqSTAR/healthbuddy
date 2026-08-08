import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOverview, type Overview } from '../api/endpoints';
import { PageHead, Resource, Stat, money, useAsync } from '../components/ui';

/**
 * The landing page answers one question: what needs a person right now.
 *
 * Everything above the fold is actionable and clickable. Population counts and
 * revenue sit below it, because they are context for a decision rather than a
 * decision — an operator who opens this at 9am should be able to tell in two
 * seconds whether anything is on fire.
 */

interface Alert {
  label: string;
  value: number;
  hint: string;
  to: string;
  tone: 'danger' | 'warning';
}

const alertsFrom = (o: Overview): Alert[] =>
  (
    [
      {
        label: 'Active emergencies',
        value: o.attention.activeEmergencies,
        hint: 'An SOS nobody has resolved',
        to: '/emergency',
        tone: 'danger',
      },
      {
        label: 'Unprocessed webhooks',
        value: o.attention.failedWebhooks,
        hint: 'Money moved at the gateway and not here',
        to: '/webhooks',
        tone: 'danger',
      },
      {
        label: 'Applications waiting',
        value: o.attention.pendingApplications,
        hint: 'A partner cannot trade until this is reviewed',
        to: '/applications',
        tone: 'warning',
      },
      {
        label: 'Licences expiring',
        value: o.attention.expiringLicences,
        hint: 'Within 60 days — an expired licence must suspend the partner',
        to: '/pharmacies?state=LICENCE_EXPIRING',
        tone: 'warning',
      },
      {
        label: 'Low stock lines',
        value: o.attention.lowStockLines,
        hint: 'Sellable stock at or below the reorder level',
        to: '/pharmacies',
        tone: 'warning',
      },
      {
        label: 'Stock expiring',
        value: o.attention.expiringStockLines,
        hint: 'On the shelf, expiring within 60 days',
        to: '/stock',
        tone: 'warning',
      },
      {
        label: 'Abandoned checkouts',
        value: o.attention.abandonedCheckouts,
        hint: 'Unpaid for over an hour',
        to: '/orders?status=PENDING_PAYMENT',
        tone: 'warning',
      },
      {
        label: 'Lapsed prescriptions',
        value: o.attention.expiredFulfilments,
        hint: 'A priced basket the patient never answered',
        to: '/appointments',
        tone: 'warning',
      },
    ] as Alert[]
  )
    .filter((a) => a.value > 0)
    .sort((a, b) => (a.tone === b.tone ? b.value - a.value : a.tone === 'danger' ? -1 : 1));

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const state = useAsync(fetchOverview, []);

  return (
    <>
      <PageHead
        title="Overview"
        lead="What needs a person, who is on the platform, and what money moved this month."
        actions={
          <button className="btn outline" onClick={state.reload}>
            Refresh
          </button>
        }
      />

      <Resource state={state}>
        {(o) => {
          const alerts = alertsFrom(o);

          return (
            <>
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Needs attention
              </h2>
              {alerts.length === 0 ? (
                <div className="banner info">
                  Nothing is waiting. No open emergencies, no unreviewed applications, no failed
                  webhooks, and no stock or licence about to lapse.
                </div>
              ) : (
                <div className="stat-grid">
                  {alerts.map((a) => (
                    <Stat
                      key={a.label}
                      label={a.label}
                      value={a.value}
                      hint={a.hint}
                      tone={a.tone}
                      onClick={() => navigate(a.to)}
                    />
                  ))}
                </div>
              )}

              <h2 className="section-title">Money this month</h2>
              <div className="stat-grid">
                <Stat
                  label="Collected"
                  value={money(o.money.grossPaidThisMonth)}
                  hint={`${o.money.paidCountThisMonth} payment${o.money.paidCountThisMonth === 1 ? '' : 's'}`}
                  accent
                />
                <Stat
                  label="Platform fee"
                  value={money(o.money.platformFeeThisMonth)}
                  hint="Our cut, already inside the amount charged"
                />
                <Stat
                  label="Partner share"
                  value={money(o.money.partnerShareThisMonth)}
                  hint="Settled by the aggregator, not held by us"
                />
                <Stat
                  label="Refunded"
                  value={money(o.money.refundedThisMonth)}
                  hint="Returned to patients this month"
                />
                <Stat
                  label="Cash on delivery due"
                  value={money(o.money.codOutstanding)}
                  hint={`${o.money.codOutstandingCount} order${o.money.codOutstandingCount === 1 ? '' : 's'} where goods moved before money`}
                  onClick={() => navigate('/payments?method=COD&status=PENDING')}
                />
                <Stat
                  label="Unsettled splits"
                  value={money(o.money.unsettledSplitAmount)}
                  hint={`${o.money.unsettledSplitCount} leg${o.money.unsettledSplitCount === 1 ? '' : 's'} awaiting payout`}
                  onClick={() => navigate('/payments')}
                />
              </div>

              <h2 className="section-title">Today</h2>
              <div className="stat-grid">
                <Stat label="Appointments booked" value={o.operations.appointmentsToday} />
                <Stat
                  label="Consults in progress"
                  value={o.operations.consultsInProgress}
                  onClick={() => navigate('/appointments?status=IN_PROGRESS')}
                />
                <Stat label="Consults completed this month" value={o.operations.consultsThisMonth} />
                <Stat
                  label="Orders awaiting a pharmacy"
                  value={o.operations.ordersAwaitingPharmacy}
                  onClick={() => navigate('/deliveries')}
                />
                <Stat
                  label="Orders out for delivery"
                  value={o.operations.ordersInDelivery}
                  onClick={() => navigate('/deliveries')}
                />
                <Stat
                  label="Lab orders open"
                  value={o.operations.labOrdersOpen}
                  onClick={() => navigate('/lab-orders')}
                />
              </div>

              <h2 className="section-title">Who is on the platform</h2>
              <div className="stat-grid">
                <Stat label="Patients" value={o.people.patients} onClick={() => navigate('/patients')} />
                <Stat label="Doctors" value={o.people.doctors} onClick={() => navigate('/doctors')} />
                <Stat
                  label="Pharmacies"
                  value={o.people.pharmacies}
                  onClick={() => navigate('/pharmacies')}
                />
                <Stat label="Labs" value={o.people.labs} onClick={() => navigate('/labs')} />
                <Stat label="Joined this week" value={o.people.signupsThisWeek} />
                <Stat
                  label="Suspended accounts"
                  value={o.people.suspended}
                  onClick={() => navigate('/users')}
                />
              </div>

              <p className="inline-note" style={{ marginTop: 20 }}>
                Counted at {new Date(o.generatedAt).toLocaleTimeString()}.
              </p>
            </>
          );
        }}
      </Resource>
    </>
  );
};

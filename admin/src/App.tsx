import React from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './api/auth';
import { fetchOverview } from './api/endpoints';
import { useAsync } from './components/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Applications } from './pages/Applications';
import { ApplicationDetail } from './pages/ApplicationDetail';
import { Users } from './pages/Users';
import { Patients } from './pages/Patients';
import { Doctors } from './pages/Doctors';
import { Pharmacies } from './pages/Pharmacies';
import { Agents } from './pages/Agents';
import { Labs } from './pages/Labs';
import { Appointments } from './pages/Appointments';
import { Orders } from './pages/Orders';
import { LabOrders } from './pages/LabOrders';
import { Deliveries } from './pages/Deliveries';
import { Payments } from './pages/Payments';
import { Webhooks } from './pages/Webhooks';
import { Catalogue } from './pages/Catalogue';
import { Emergency } from './pages/Emergency';
import { AuditLog } from './pages/AuditLog';
import { LabPricing } from './pages/LabPricing';
import { StockLedger } from './pages/StockLedger';

/**
 * Navigation is grouped by what an operator is doing, not by which table a page
 * reads. Sixteen flat links is a list to read; five labelled groups is a
 * structure to navigate, and the group headings let the eye skip three quarters
 * of the sidebar in one pass.
 *
 * Badges only appear when a count is non-zero — a permanent "0" is noise that
 * trains people to stop looking at the number.
 */

interface Item {
  to: string;
  label: string;
  /** A count worth interrupting for renders red; context renders grey. */
  badge?: { count: number; urgent?: boolean };
}

const Sidebar: React.FC = () => {
  const { user, signOut } = useAuth();
  const overview = useAsync(fetchOverview, []);
  const a = overview.data?.attention;
  const o = overview.data?.operations;

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Dashboard' },
        {
          to: '/applications',
          label: 'Verification queue',
          ...(a?.pendingApplications
            ? { badge: { count: a.pendingApplications, urgent: true } }
            : {}),
        },
        {
          to: '/emergency',
          label: 'Emergency',
          ...(a?.activeEmergencies ? { badge: { count: a.activeEmergencies, urgent: true } } : {}),
        },
      ],
    },
    {
      title: 'People',
      items: [
        { to: '/patients', label: 'Patients' },
        { to: '/doctors', label: 'Doctors' },
        { to: '/pharmacies', label: 'Pharmacies' },
        { to: '/labs', label: 'Labs' },
        { to: '/agents', label: 'Delivery agents' },
        { to: '/users', label: 'All accounts' },
      ],
    },
    {
      title: 'Operations',
      items: [
        { to: '/appointments', label: 'Consultations' },
        {
          to: '/orders',
          label: 'Medicine orders',
          ...(o?.ordersAwaitingPharmacy ? { badge: { count: o.ordersAwaitingPharmacy } } : {}),
        },
        {
          to: '/lab-orders',
          label: 'Lab bookings',
          ...(o?.labOrdersOpen ? { badge: { count: o.labOrdersOpen } } : {}),
        },
        {
          to: '/deliveries',
          label: 'Deliveries',
          ...(o?.ordersInDelivery ? { badge: { count: o.ordersInDelivery } } : {}),
        },
      ],
    },
    {
      title: 'Money',
      items: [
        { to: '/payments', label: 'Payments' },
        {
          to: '/webhooks',
          label: 'Gateway webhooks',
          ...(a?.failedWebhooks ? { badge: { count: a.failedWebhooks, urgent: true } } : {}),
        },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { to: '/catalogue', label: 'Medicines & tests' },
        { to: '/lab-pricing', label: 'Lab pricing' },
        {
          to: '/stock',
          label: 'Stock ledger',
          ...(a?.lowStockLines ? { badge: { count: a.lowStockLines } } : {}),
        },
      ],
    },
    {
      title: 'Governance',
      items: [{ to: '/audit', label: 'Audit log' }],
    },
  ];

  const link = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="brand">Health Buddy</div>

      <nav>
        {groups.map((group) => (
          <React.Fragment key={group.title}>
            <div className="nav-group">{group.title}</div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={link}>
                <span>{item.label}</span>
                {item.badge ? (
                  <span className={`count${item.badge.urgent ? '' : ' muted'}`}>
                    {item.badge.count}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div style={{ marginBottom: 8 }}>
          Signed in as
          <br />
          <strong style={{ color: 'var(--on-surface)' }}>{user?.phoneNumber}</strong>
        </div>
        <button className="btn outline sm" onClick={signOut} style={{ width: '100%' }}>
          Sign out
        </button>
      </div>
    </aside>
  );
};

const Shell: React.FC = () => (
  <div className="shell">
    <Sidebar />
    <main className="main">
      <Routes>
        <Route path="/" element={<Dashboard />} />

        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/emergency" element={<Emergency />} />

        <Route path="/patients" element={<Patients />} />
        <Route path="/doctors" element={<Doctors />} />
        <Route path="/pharmacies" element={<Pharmacies />} />
        <Route path="/labs" element={<Labs />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/users" element={<Users />} />

        <Route path="/appointments" element={<Appointments />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/lab-orders" element={<LabOrders />} />
        <Route path="/deliveries" element={<Deliveries />} />

        <Route path="/payments" element={<Payments />} />
        <Route path="/webhooks" element={<Webhooks />} />

        <Route path="/catalogue" element={<Catalogue />} />
        <Route path="/lab-pricing" element={<LabPricing />} />
        <Route path="/stock" element={<StockLedger />} />

        <Route path="/audit" element={<AuditLog />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  </div>
);

const Gate: React.FC = () => {
  const { user, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <div className="login-shell">
        <div className="state">
          <h3>Loading…</h3>
        </div>
      </div>
    );
  }

  // The panel only renders for an ADMIN session. This is convenience, not
  // security — every endpoint behind it enforces the role independently.
  if (!user || user.role !== 'ADMIN') return <Login />;

  return <Shell />;
};

export const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <Gate />
    </AuthProvider>
  </BrowserRouter>
);

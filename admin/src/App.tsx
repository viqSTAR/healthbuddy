import React from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './api/auth';
import { fetchApplications } from './api/endpoints';
import { useAsync } from './components/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Applications } from './pages/Applications';
import { ApplicationDetail } from './pages/ApplicationDetail';
import { Users } from './pages/Users';
import { Emergency } from './pages/Emergency';
import { AuditLog } from './pages/AuditLog';
import { LabPricing } from './pages/LabPricing';
import { StockLedger } from './pages/StockLedger';

const Sidebar: React.FC = () => {
  const { user, signOut } = useAuth();
  // Drives the queue badge, so a waiting application is visible from any page.
  const pending = useAsync(() => fetchApplications({ status: 'SUBMITTED', limit: 1 }), []);

  const link = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="brand">Health Buddy</div>

      <nav>
        <NavLink to="/" end className={link}>
          Overview
        </NavLink>
        <NavLink to="/applications" className={link}>
          <span>Verification</span>
          {pending.data && pending.data.total > 0 ? (
            <span className="count">{pending.data.total}</span>
          ) : null}
        </NavLink>
        <NavLink to="/users" className={link}>
          Users
        </NavLink>
        <NavLink to="/lab-pricing" className={link}>
          Lab pricing
        </NavLink>
        <NavLink to="/stock" className={link}>
          Stock ledger
        </NavLink>
        <NavLink to="/emergency" className={link}>
          Emergency
        </NavLink>
        <NavLink to="/audit" className={link}>
          Audit log
        </NavLink>
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
        <Route path="/users" element={<Users />} />
        <Route path="/lab-pricing" element={<LabPricing />} />
        <Route path="/stock" element={<StockLedger />} />
        <Route path="/emergency" element={<Emergency />} />
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

import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ScreenerPage from './pages/ScreenerPage';
import VerifyPage from './pages/VerifyPage';

function Layout() {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="brand">Stock Verifier v2</span>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/screener">Screener</NavLink>
        <NavLink to="/verify">Verify</NavLink>
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{user.email}</span>
        <button type="button" className="btn btn-secondary" onClick={logout}>
          Logout
        </button>
      </nav>
      <Outlet />
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-shell">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="screener" element={<ScreenerPage />} />
        <Route path="verify" element={<VerifyPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

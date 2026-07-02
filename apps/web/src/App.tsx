import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ScreenerPage from './pages/ScreenerPage';
import VerifyPage from './pages/VerifyPage';
import AdminPage from './pages/AdminPage';
import WatchlistPage from './pages/WatchlistPage';
import PositionsPage from './pages/PositionsPage';
import SwingScanPage from './pages/SwingScanPage';
import SwingAutoPage from './pages/SwingAutoPage';
import IntradayPage from './pages/IntradayPage';
import { APP_NAME } from './brand';

function Layout() {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <nav className="nav">
        <span className="brand">{APP_NAME}</span>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/screener">Screener</NavLink>
        <NavLink to="/verify">Verify</NavLink>
        <NavLink to="/watchlist">Watchlist</NavLink>
        <NavLink to="/positions">Positions</NavLink>
        <NavLink to="/swing">Swing</NavLink>
        <NavLink to="/swing/auto">Auto Radar</NavLink>
        <NavLink to="/intraday">Intraday</NavLink>
        <NavLink to="/admin">Admin</NavLink>
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
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="positions" element={<PositionsPage />} />
        <Route path="swing" element={<SwingScanPage />} />
        <Route path="swing/auto" element={<SwingAutoPage />} />
        <Route path="intraday" element={<IntradayPage />} />
        <Route path="admin" element={<AdminPage />} />
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

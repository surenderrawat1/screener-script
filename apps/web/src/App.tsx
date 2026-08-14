import { lazy, Suspense } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { APP_NAME } from './brand';
import { homeRouteForRole } from './lib/home-route';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'));
const ScreenerPitBacktestPage = lazy(() => import('./pages/ScreenerPitBacktestPage'));
const VerifyPage = lazy(() => import('./pages/VerifyPage'));
const VerifyFullPage = lazy(() => import('./pages/VerifyFullPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const PositionsPage = lazy(() => import('./pages/PositionsPage'));
const SwingScanPage = lazy(() => import('./pages/SwingScanPage'));
const SwingBacktestPage = lazy(() => import('./pages/SwingBacktestPage'));
const SwingAutoPage = lazy(() => import('./pages/SwingAutoPage'));
const IntradayPage = lazy(() => import('./pages/IntradayPage'));
const IntradayBacktestPage = lazy(() => import('./pages/IntradayBacktestPage'));
const IntradayPositionsPage = lazy(() => import('./pages/IntradayPositionsPage'));
const IntradayAppPage = lazy(() => import('./pages/IntradayAppPage'));
const StockDetailsPage = lazy(() => import('./pages/StockDetailsPage'));
const MorningPage = lazy(() => import('./pages/MorningPage'));
const SignalsPage = lazy(() => import('./pages/SignalsPage'));
const ChartPatternsFeedPage = lazy(() => import('./pages/ChartPatternsFeedPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const LtgAutoPage = lazy(() => import('./pages/LtgAutoPage'));
const PresetsPage = lazy(() => import('./pages/PresetsPage'));
const StrategiesPage = lazy(() => import('./pages/StrategiesPage'));
const CfaReferencePage = lazy(() => import('./pages/CfaReferencePage'));
const AdminCfaDocsPage = lazy(() => import('./pages/AdminCfaDocsPage'));

function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isApp = location.pathname.startsWith('/intraday/app');
  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  const moreLinks = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/presets', label: 'Presets' },
    { to: '/strategies', label: 'Strategies' },
    { to: '/verify/full', label: 'Full Verify' },
    { to: '/cfa-reference', label: 'CFA Ref' },
    { to: '/stock/TCS', label: 'Details' },
    { to: '/watchlist', label: 'Watchlist' },
    { to: '/compare?a=TCS&b=INFY', label: 'Compare memos' },
    { to: '/ltg/auto', label: 'LTG Auto' },
    { to: '/swing/backtest', label: 'Swing Backtest' },
    { to: '/intraday/backtest', label: 'Intraday Backtest' },
    { to: '/intraday/positions', label: 'Nifty Positions' },
    { to: '/intraday/app', label: 'Intraday App' },
    ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  return (
    <div className={isApp ? 'app-shell is-intraday-app' : 'app-shell'}>
      <nav className="nav">
        <span className="brand">{APP_NAME}</span>
        <NavLink to="/morning" end>Morning</NavLink>
        <NavLink to="/signals">Signals</NavLink>
        <NavLink to="/patterns">Patterns</NavLink>
        <NavLink to="/screener">Screener</NavLink>
        <NavLink to="/verify">Verify</NavLink>
        <NavLink to="/positions">Positions</NavLink>
        <NavLink to="/swing">Swing</NavLink>
        <NavLink to="/swing/auto">Auto Radar</NavLink>
        <NavLink to="/intraday">Intraday</NavLink>
        <details className="nav-more">
          <summary>More</summary>
          <div className="nav-more-menu">
            {moreLinks.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          </div>
        </details>
        <span className="nav-user muted">{user.email}</span>
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

  const homeRoute = homeRouteForRole(user?.role);

  return (
    <Suspense fallback={<div className="app-shell">Loading page…</div>}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homeRoute} replace /> : <LoginPage />} />
        <Route element={<Layout />}>
          <Route index element={<Navigate to={homeRoute} replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="morning" element={<MorningPage />} />
          <Route path="signals" element={<SignalsPage />} />
          <Route path="patterns" element={<ChartPatternsFeedPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="ltg/auto" element={<LtgAutoPage />} />
          <Route path="presets" element={<PresetsPage />} />
          <Route path="strategies" element={<StrategiesPage />} />
          <Route path="screener" element={<ScreenerPage />} />
          <Route path="screener/pit-backtest" element={<ScreenerPitBacktestPage />} />
          <Route path="verify" element={<VerifyPage />} />
          <Route path="verify/full" element={<VerifyFullPage />} />
          <Route path="cfa-reference" element={<CfaReferencePage />} />
          <Route path="stock/:symbol" element={<StockDetailsPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="positions" element={<PositionsPage />} />
          <Route path="swing" element={<SwingScanPage />} />
          <Route path="swing/backtest" element={<SwingBacktestPage />} />
          <Route path="swing/auto" element={<SwingAutoPage />} />
          <Route path="intraday" element={<IntradayPage />} />
          <Route path="intraday/backtest" element={<IntradayBacktestPage />} />
          <Route path="intraday/positions" element={<IntradayPositionsPage />} />
          <Route path="intraday/app" element={<IntradayAppPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/cfa-docs" element={<AdminCfaDocsPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

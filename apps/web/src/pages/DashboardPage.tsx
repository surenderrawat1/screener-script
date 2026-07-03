import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

export default function DashboardPage() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>('/health').then(setHealth).catch(() => setHealth({ status: 'error' }));
    api<Record<string, unknown>>('/health/ready').then(setReady).catch(() => setReady(null));
  }, []);

  const checks = (ready?.checks as Record<string, { ok?: boolean; host?: string; detail?: string }> | undefined) ?? {};

  return (
    <Page>
      <PageHeader title="Dashboard" subtitle="System status and quick navigation" />
      <p className="disclaimer">
        Educational research tool only — not SEBI-registered investment advice.
      </p>

      <div className="card">
        <h2>System health</h2>
        <p>
          API: <strong>{String(health?.status ?? '…')}</strong>
        </p>
        {ready && (
          <table className="data-table">
            <tbody>
              <tr>
                <td>PostgreSQL</td>
                <td>{checks.postgres?.ok ? 'OK' : 'Down'} · {checks.postgres?.host ?? '—'}</td>
              </tr>
              <tr>
                <td>Redis</td>
                <td>{checks.redis?.ok ? 'OK' : 'Down'} · {checks.redis?.host ?? '—'}</td>
              </tr>
              <tr>
                <td>Worker</td>
                <td>{checks.worker?.ok ? 'Active' : 'Idle'} · {String(checks.worker?.detail ?? '—')}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Quick links</h2>
        <ul>
          <li>
            <Link to="/morning">Morning routine</Link> — regime, checklist, auto radar
          </li>
          <li>
            <Link to="/screener">Run screener</Link> — universe + preset filters
          </li>
          <li>
            <Link to="/verify">CFA verify</Link> — one-click symbol analysis
          </li>
          <li>
            <Link to="/watchlist">Watchlist</Link> — thesis & review dates
          </li>
          <li>
            <Link to="/positions">Swing positions</Link> — open/closed trades
          </li>
          <li>
            <Link to="/swing/auto">Auto radar</Link> — incremental Nifty 250 scan
          </li>
          <li>
            <Link to="/intraday">Intraday</Link> — Nifty 5m/15m playbook
          </li>
        </ul>
      </div>
    </Page>
  );
}

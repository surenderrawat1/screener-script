import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface PresetChip {
  id: string;
  icon: string;
  label: string;
  tone: string;
  href: string;
}

interface OpsAlert {
  id: string;
  severity: 'info' | 'warn' | 'critical';
  category: string;
  title: string;
  detail: string;
  at: string;
}

interface OpsAlertsResponse {
  ok: boolean;
  alerts: OpsAlert[];
  summary: { count: number; critical: number; warn: number; ok: boolean };
  nse: { label: string; phase: string; ist_time: string };
  checked_at: string;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState<Record<string, unknown> | null>(null);
  const [presetChips, setPresetChips] = useState<PresetChip[]>([]);
  const [ops, setOps] = useState<OpsAlertsResponse | null>(null);
  const [paperSample, setPaperSample] = useState<{
    total_trades: number;
    min_trades: number;
    target_trades: number;
    pct_to_min: number;
    pct_to_target: number;
    min_ready: boolean;
    target_ready: boolean;
    summary: string;
    regimes?: { bull: number; sideways: number; bear: number; unknown: number };
    min_per_regime?: number;
    cycle_ready?: boolean;
    cycle_gaps?: string[];
  } | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>('/health').then(setHealth).catch(() => setHealth({ status: 'error' }));
    api<Record<string, unknown>>('/health/ready').then(setReady).catch(() => setReady(null));
    api<{ chips: PresetChip[] }>('/api/v1/trading/presets')
      .then((r) => setPresetChips(r.chips ?? []))
      .catch(() => setPresetChips([]));
    api<OpsAlertsResponse>('/api/v1/ops/alerts')
      .then(setOps)
      .catch(() => setOps(null));
    api<{ sample?: typeof paperSample }>('/api/v1/swing/paper/state')
      .then((r) => setPaperSample(r.sample ?? null))
      .catch(() => setPaperSample(null));
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
        <h2>Ops alerts</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Stale quotes · worker downtime · rejected paper writes · abnormal price gaps
          {ops?.nse ? ` · NSE ${ops.nse.label} ${ops.nse.ist_time}` : ''}
        </p>
        {!ops ? (
          <p className="muted">Sign in to load ops alerts.</p>
        ) : ops.alerts.length === 0 ? (
          <p className="success">No active ops alerts.</p>
        ) : (
          <ul className="ops-alert-list">
            {ops.alerts.map((alert) => (
              <li key={alert.id} className={`ops-alert ops-alert-${alert.severity}`}>
                <strong>{alert.title}</strong>
                <span className="muted"> · {alert.category.replace(/_/g, ' ')}</span>
                <div>{alert.detail}</div>
              </li>
            ))}
          </ul>
        )}
        {ops?.summary && ops.summary.count > 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {ops.summary.critical} critical · {ops.summary.warn} warn · checked{' '}
            {new Date(ops.checked_at).toLocaleTimeString()}
          </p>
        ) : null}
      </div>

      {paperSample ? (
        <div className="card">
          <h2>Swing paper sample (CFA)</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Out-of-sample closed trades across evaluation periods — minimum {paperSample.min_trades},
            target {paperSample.target_trades}, with ≥{paperSample.min_per_regime ?? 5} closes in each
            of bull / sideways / bear before live money.
          </p>
          <div className="swing-backtest-stats">
            <span className={paperSample.target_ready ? 'swing-pnl-pos' : undefined}>
              {paperSample.total_trades} / {paperSample.target_trades} closes
            </span>
            <span>Min {paperSample.pct_to_min}%</span>
            <span>Target {paperSample.pct_to_target}%</span>
            {paperSample.regimes ? (
              <span className={paperSample.cycle_ready ? 'swing-pnl-pos' : undefined}>
                B{paperSample.regimes.bull} / S{paperSample.regimes.sideways} / Be
                {paperSample.regimes.bear}
                {paperSample.regimes.unknown > 0 ? ` · ?${paperSample.regimes.unknown}` : ''}
              </span>
            ) : null}
          </div>
          <p style={{ marginBottom: 0 }}>{paperSample.summary}</p>
          <p className="muted" style={{ marginBottom: 0 }}>
            <Link to="/swing/auto">Open Swing Auto paper panel →</Link>
          </p>
        </div>
      ) : null}

      <div className="card">
        <h2>Trade today</h2>
        {presetChips.length > 0 ? (
          <div className="morning-presets">
            {presetChips.map((chip) => (
              <Link
                key={chip.id}
                to={chip.href}
                className={`morning-preset-chip morning-preset-${chip.tone}`}
              >
                {chip.icon} {chip.label}
              </Link>
            ))}
            <Link to="/presets" className="muted morning-presets-more">
              All presets →
            </Link>
          </div>
        ) : (
          <p className="muted">
            <Link to="/presets">Trading presets</Link> — one-click swing, ETF, and intraday profiles
          </p>
        )}
      </div>

      <div className="card">
        <h2>Quick links</h2>
        <ul>
          <li>
            <Link to="/presets">Trading presets</Link> — conservative swing, ETF rotation, intraday
          </li>
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

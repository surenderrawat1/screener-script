import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';

interface AutoState {
  ok: boolean;
  profile: { title: string; refresh_sec: number; scan_sec: number };
  guidance: { title: string; message: string; deploy_pct: number; tone: string };
  tiers: {
    high_conviction: HitRow[];
    strict_enter: HitRow[];
    setup_radar: HitRow[];
    breakout_surge: HitRow[];
  };
  positions: { open: PositionRow[]; heat_pct: number; count: number };
  scan: { hit_count?: number; scanned?: number };
  snapshot?: { saved_at?: string; summary?: Record<string, unknown> } | null;
}

interface HitRow {
  symbol: string;
  decision_action: string;
  decision_score: number;
  strict: string;
  price: number;
  suggested_shares: number;
  high_conviction?: boolean;
}

interface PositionRow {
  symbol: string;
  gain_pct: number | null;
  exit_verdict: string;
  position_action: string;
  action_label: string;
  active_stop: number | null;
}

export default function SwingAutoPage() {
  const [state, setState] = useState<AutoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [scanMessage, setScanMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await api<AutoState>('/api/v1/swing/auto/state');
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auto radar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function runScan() {
    setScanMessage('');
    setError('');
    setScanning(true);
    try {
      const res = await api<{ ok: boolean; error?: string; scan_mode?: string; background?: boolean }>(
        '/api/v1/swing/auto/scan',
        { method: 'POST' },
      );
      if (!res.ok) {
        setScanMessage(res.error ?? 'Scan not started');
      } else {
        setScanMessage(
          res.background
            ? `Background ${res.scan_mode ?? 'scan'} queued`
            : `${res.scan_mode ?? 'Scan'} completed`,
        );
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  if (loading && !state) return <PageLoading label="Loading swing auto-radar…" />;
  if (error && !state) {
    return (
      <Page>
        <p className="error">{error}</p>
      </Page>
    );
  }
  if (!state) return null;

  const savedAt = state.snapshot?.saved_at
    ? new Date(state.snapshot.saved_at).toLocaleString()
    : 'Never';

  return (
    <Page>
      <PageHeader
        title="Swing Auto Radar"
        subtitle={state.profile.title}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="btn" onClick={() => void runScan()} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Run scan'}
            </button>
          </>
        }
      />
      <p className="disclaimer">Incremental Nifty 250 radar — full scan every 30m, refresh every 5m.</p>

      {scanMessage && <p className="muted">{scanMessage}</p>}
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>{state.guidance.title}</h2>
        <p>{state.guidance.message}</p>
        <p className="muted">
          Deploy cap {state.guidance.deploy_pct}% · portfolio heat {state.positions.heat_pct}% ·{' '}
          {state.positions.count} open · {state.scan.hit_count ?? 0} hits · last snapshot {savedAt}
        </p>
      </section>

      <div className="grid-2">
        <TierTable title="High conviction" rows={state.tiers.high_conviction} />
        <TierTable title="Strict ENTER" rows={state.tiers.strict_enter} />
        <TierTable title="Setup radar" rows={state.tiers.setup_radar} />
        <TierTable title="Breakout surge" rows={state.tiers.breakout_surge} />
      </div>

      <section className="card">
        <h2>Open positions (live exit eval)</h2>
        {state.positions.open.length === 0 ? (
          <EmptyState>No open swing positions.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Gain %</th>
                <th>Exit</th>
                <th>Action</th>
                <th>Stop</th>
              </tr>
            </thead>
            <tbody>
              {state.positions.open.map((p) => (
                <tr key={p.symbol}>
                  <td>{p.symbol}</td>
                  <td>{p.gain_pct != null ? `${p.gain_pct.toFixed(2)}%` : '—'}</td>
                  <td>{p.exit_verdict}</td>
                  <td>{p.action_label}</td>
                  <td>{p.active_stop != null ? `₹${p.active_stop.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Page>
  );
}

function TierTable({ title, rows }: { title: string; rows: HitRow[] }) {
  return (
    <section className="card">
      <h3>
        {title} ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <EmptyState>None</EmptyState>
      ) : (
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Action</th>
              <th>Score</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((h) => (
              <tr key={h.symbol}>
                <td>{h.symbol}</td>
                <td>{h.decision_action}</td>
                <td>{h.decision_score}</td>
                <td>₹{h.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

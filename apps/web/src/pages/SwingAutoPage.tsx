import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

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
  const [error, setError] = useState('');

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

  if (loading && !state) return <div className="page">Loading swing auto-radar…</div>;
  if (error && !state) return <div className="page error">{error}</div>;
  if (!state) return null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Swing Auto Radar</h1>
          <p className="muted">{state.profile.title}</p>
        </div>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>{state.guidance.title}</h2>
        <p>{state.guidance.message}</p>
        <p className="muted">
          Deploy cap {state.guidance.deploy_pct}% · portfolio heat {state.positions.heat_pct}% ·{' '}
          {state.positions.count} open · last scan {state.scan.hit_count ?? 0} hits
        </p>
      </section>

      <div className="grid-2">
        <TierTable title="High conviction" rows={state.tiers.high_conviction} />
        <TierTable title="Strict ENTER" rows={state.tiers.strict_enter} />
        <TierTable title="Setup radar" rows={state.tiers.setup_radar} />
        <TierTable title="Breakout surge" rows={state.tiers.breakout_surge} />
      </div>

      <section className="card" style={{ marginTop: '1rem' }}>
        <h2>Open positions (live exit eval)</h2>
        {state.positions.open.length === 0 ? (
          <p className="muted">No open swing positions.</p>
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
    </div>
  );
}

function TierTable({ title, rows }: { title: string; rows: HitRow[] }) {
  return (
    <section className="card">
      <h3>{title} ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="muted">None</p>
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

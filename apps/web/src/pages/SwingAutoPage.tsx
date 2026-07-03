import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { OpenPositionsPanel, type PositionsBlock } from '../components/swing/OpenPositionsPanel';

const TIER_TABS = [
  { id: 'high_conviction', label: 'High conviction' },
  { id: 'strict_enter', label: 'Strict ENTER' },
  { id: 'setup_radar', label: 'Setup radar' },
  { id: 'breakout_surge', label: 'Breakout surge' },
] as const;

type TierId = (typeof TIER_TABS)[number]['id'];

interface HitRow {
  symbol: string;
  swing_rank: number;
  decision_action: string;
  decision_score: number;
  strict: string;
  discovery: string;
  price: number;
  stop_loss: number;
  profit_target: number;
  r_multiple: number | null;
  ta_rsi14: number | null;
  ta_pct_52w: number | null;
  suggested_shares: number;
  add_allowed: boolean;
  high_conviction?: boolean;
  risk_flags: string[];
}

interface AutoState {
  ok: boolean;
  profile: { title: string; refresh_sec: number; scan_sec: number; full_scan_sec: number };
  guidance: { title: string; message: string; deploy_pct: number; tone: string };
  regime: { label?: string; key?: string; blocks_strict_enter?: boolean } | null;
  tiers: Record<TierId, HitRow[]>;
  positions: PositionsBlock & { heat_pct: number };
  scan: {
    hit_count?: number;
    scanned?: number;
    scan_mode?: string;
    elapsed_sec?: number;
    incremental_stale?: boolean;
  };
  snapshot?: {
    saved_at?: string;
    last_full_scan_at?: string;
    scan_mode?: string;
    summary?: Record<string, unknown>;
  } | null;
  timing?: {
    next_scan_in_sec: number;
    next_full_scan_in_sec: number;
    scan_interval_sec: number;
  };
  scan_status?: { active: boolean; label: string };
  portfolio_risk?: {
    heat_pct: number;
    open_count: number;
    max_positions: number;
    max_heat_pct: number;
    can_add: boolean;
    blocked_reason: string | null;
  };
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return 'due';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function decisionBadge(action: string): string {
  const a = action.toUpperCase();
  if (a.includes('STRONG')) return 'badge badge-buy';
  if (a.includes('BUY')) return 'badge badge-buy';
  if (a.includes('WATCH')) return 'badge badge-hold';
  return 'badge badge-expensive';
}

function guidanceClass(tone: string): string {
  if (tone === 'danger') return 'swing-guidance danger';
  if (tone === 'warning') return 'swing-guidance warning';
  if (tone === 'success') return 'swing-guidance success';
  return 'swing-guidance';
}

export default function SwingAutoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTier = (searchParams.get('tier') as TierId) || 'high_conviction';
  const [state, setState] = useState<AutoState | null>(null);
  const [positions, setPositions] = useState<PositionsBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [addBusy, setAddBusy] = useState<string | null>(null);

  const load = useCallback(async (live = false) => {
    setError('');
    try {
      const q = live ? '?live=1&positions=0' : '?positions=0';
      const data = await api<AutoState>(`/api/v1/swing/auto/state${q}`);
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auto radar');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPositions = useCallback(async (live = true) => {
    try {
      const q = live ? '?live=1' : '';
      const data = await api<PositionsBlock>(`/api/v1/swing/auto/positions${q}`);
      setPositions(data);
    } catch {
      /* positions poll is best-effort */
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadPositions(true);
    const tierPoll = setInterval(() => void load(false), 60_000);
    const posPoll = setInterval(() => void loadPositions(true), 60_000);
    return () => {
      clearInterval(tierPoll);
      clearInterval(posPoll);
    };
  }, [load, loadPositions]);

  async function pollJob(jobId: string) {
    setScanMessage('Scan running in background…');
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = await api<{
          job: { status: string; progress?: { processed: number; total: number } };
        }>(`/api/v1/screener/jobs/${jobId}`);
        const st = res.job.status;
        const prog = res.job.progress;
        if (prog?.total) {
          setScanMessage(`Scanning ${prog.processed}/${prog.total} symbols…`);
        }
        if (st === 'done' || st === 'failed') break;
      } catch {
        break;
      }
    }
    setScanMessage('Scan finished — refreshing radar.');
    await Promise.all([load(true), loadPositions(true)]);
    setScanning(false);
  }

  async function runScan() {
    setScanMessage('');
    setError('');
    setScanning(true);
    try {
      const res = await api<{
        ok: boolean;
        error?: string;
        scan_mode?: string;
        background?: boolean;
        jobId?: string;
      }>('/api/v1/swing/auto/scan', { method: 'POST' });

      if (!res.ok) {
        setScanMessage(res.error ?? 'Scan not started');
        setScanning(false);
        return;
      }

      if (res.background && res.jobId) {
        void pollJob(res.jobId);
        return;
      }

      setScanMessage(`${res.scan_mode ?? 'Scan'} completed`);
      await Promise.all([load(true), loadPositions(true)]);
      setScanning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      setScanning(false);
    }
  }

  async function addPosition(hit: HitRow) {
    if (!state?.portfolio_risk?.can_add && state?.portfolio_risk?.blocked_reason) {
      setError(state.portfolio_risk.blocked_reason);
      return;
    }
    setAddBusy(hit.symbol);
    setError('');
    try {
      const check = await api<{
        ok: boolean;
        error?: string;
        entry_price?: number;
        stop_loss?: number;
        shares?: number;
      }>('/api/v1/swing/auto/check-add', {
        method: 'POST',
        body: JSON.stringify({
          symbol: hit.symbol,
          price: hit.price,
          stop_loss: hit.stop_loss,
          shares: hit.suggested_shares,
          regime: state?.regime,
        }),
      });

      if (!check.ok) {
        setError(check.error ?? 'Cannot add position');
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol: hit.symbol,
          entry_price: check.entry_price ?? hit.price,
          entry_date: today,
          stop_loss: check.stop_loss ?? hit.stop_loss,
          shares: check.shares ?? hit.suggested_shares,
          profit_target: hit.profit_target > 0 ? hit.profit_target : undefined,
          source: 'auto_radar',
        }),
      });
      setScanMessage(`Added ${hit.symbol} to swing positions.`);
      await Promise.all([load(true), loadPositions(true)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add position failed');
    } finally {
      setAddBusy(null);
    }
  }

  function setTier(tier: TierId) {
    setSearchParams({ tier });
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
  const regimeLabel = String(state.regime?.label ?? state.regime?.key ?? '—');
  const tierRows = state.tiers[activeTier] ?? [];
  const scanActive = state.scan_status?.active || scanning;
  const risk = state.portfolio_risk;
  const positionsBlock: PositionsBlock = positions ?? {
    open: [],
    count: state.positions.count,
    summary: { open: state.positions.count, exit_signals: 0 },
  };

  return (
    <Page>
      <PageHeader
        title="Swing Auto Radar"
        subtitle={state.profile.title}
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void Promise.all([load(true), loadPositions(true)])}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh live'}
            </button>
            <button type="button" className="btn" onClick={() => void runScan()} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Run scan'}
            </button>
          </>
        }
      />
      <p className="disclaimer">
        Nifty 250 incremental radar — worker scans every 5m, full universe every 30m when{' '}
        <code>pnpm dev:worker</code> is running.
      </p>

      {scanMessage && <p className="message-success">{scanMessage}</p>}
      {error && <p className="error">{error}</p>}

      <section className="card swing-kpi-bar">
        <div className="swing-kpi-pills">
          <span className={`swing-pill ${scanActive ? 'pill-scanning' : 'pill-live'}`}>
            {scanActive ? '● Scanning' : '● Live'}
          </span>
          <span className="swing-pill">Regime: {regimeLabel}</span>
          <span className="swing-pill">
            Next scan: {fmtCountdown(state.timing?.next_scan_in_sec ?? 0)}
          </span>
          <span className="swing-pill">
            Full N250: {fmtCountdown(state.timing?.next_full_scan_in_sec ?? 0)}
          </span>
          <span className="swing-pill">
            Mode: {state.snapshot?.scan_mode ?? state.scan.scan_mode ?? '—'}
          </span>
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0' }}>
          {state.scan.scanned ?? 0} scanned · {state.scan.hit_count ?? 0} hits
          {state.scan.elapsed_sec ? ` · ${state.scan.elapsed_sec}s` : ''} · snapshot {savedAt}
          {state.scan.incremental_stale ? ' · incremental stale' : ''}
        </p>
      </section>

      <section className={`card ${guidanceClass(state.guidance.tone)}`}>
        <h2 style={{ marginTop: 0 }}>{state.guidance.title}</h2>
        <p>{state.guidance.message}</p>
        <p className="muted">
          Deploy cap {state.guidance.deploy_pct}% · heat {state.positions.heat_pct}% /{' '}
          {risk?.max_heat_pct ?? 4}% · {state.positions.count}/{risk?.max_positions ?? 10} open
          {risk?.can_add === false && risk.blocked_reason ? (
            <span className="swing-blocked"> · New entries blocked: {risk.blocked_reason}</span>
          ) : (
            <span> · New entries allowed</span>
          )}
        </p>
      </section>

      <OpenPositionsPanel
        positions={positionsBlock}
        onRefresh={async () => {
          await Promise.all([load(true), loadPositions(true)]);
        }}
      />

      <section className="card">
        <div className="swing-tier-tabs">
          {TIER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTier === tab.id ? 'swing-tier-tab active' : 'swing-tier-tab'}
              onClick={() => setTier(tab.id)}
            >
              {tab.label} ({state.tiers[tab.id]?.length ?? 0})
            </button>
          ))}
        </div>
        <HitTable
          rows={tierRows}
          canAdd={Boolean(risk?.can_add)}
          addBusy={addBusy}
          onAdd={addPosition}
        />
      </section>
    </Page>
  );
}

function HitTable({
  rows,
  canAdd,
  addBusy,
  onAdd,
}: {
  rows: HitRow[];
  canAdd: boolean;
  addBusy: string | null;
  onAdd: (hit: HitRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 20);

  if (rows.length === 0) {
    return (
      <EmptyState>
        No hits in this tier. Wait for the next scan or run a manual scan.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Decision</th>
              <th>Score</th>
              <th>Strict</th>
              <th>Price</th>
              <th>Stop</th>
              <th>Target</th>
              <th>R</th>
              <th>RSI</th>
              <th>52w%</th>
              <th>Shares</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => (
              <tr key={h.symbol}>
                <td>{h.swing_rank}</td>
                <td>
                  <Link to={`/stock/${encodeURIComponent(h.symbol)}`}>{h.symbol}</Link>
                </td>
                <td>
                  <span className={decisionBadge(h.decision_action)}>{h.decision_action}</span>
                </td>
                <td>{h.decision_score}</td>
                <td>{h.strict}</td>
                <td>₹{h.price.toFixed(2)}</td>
                <td>₹{h.stop_loss.toFixed(2)}</td>
                <td>{h.profit_target > 0 ? `₹${h.profit_target.toFixed(2)}` : '—'}</td>
                <td>{h.r_multiple != null ? h.r_multiple.toFixed(2) : '—'}</td>
                <td>{h.ta_rsi14 ?? '—'}</td>
                <td>{h.ta_pct_52w != null ? `${h.ta_pct_52w}%` : '—'}</td>
                <td>{h.suggested_shares}</td>
                <td>
                  {h.add_allowed && canAdd ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={addBusy === h.symbol}
                      onClick={() => void onAdd(h)}
                    >
                      {addBusy === h.symbol ? '…' : '+ Add'}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 20 && !showAll && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: '0.75rem' }} onClick={() => setShowAll(true)}>
          Show all {rows.length} hits
        </button>
      )}
    </>
  );
}

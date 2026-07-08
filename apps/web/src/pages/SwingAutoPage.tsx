import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { NseSessionBanner, type NseSessionInfo } from '../components/NseSessionBanner';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { fmtMoney, formatRegimeLabel, verdictClass, zoneClass } from '../components/swing/format';
import { OpenPositionsPanel, type PositionsBlock } from '../components/swing/OpenPositionsPanel';
import { PriceFreshness } from '../components/swing/PriceFreshness';

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
  entry_score: number;
  decision_action: string;
  decision_label?: string;
  decision_score: number;
  strict: string;
  discovery: string;
  price: number;
  stop_loss: number;
  profit_target: number;
  r_multiple: number | null;
  ta_rsi14: number | null;
  ta_pct_52w: number | null;
  ta_52w_chart_zone?: string;
  as_of_date?: string;
  suggested_shares: number;
  add_allowed: boolean;
  already_held?: boolean;
  held_near_stop?: boolean;
  held_action_label?: string;
  held_stop_distance_pct?: number | null;
  high_conviction?: boolean;
  risk_flags: string[];
  rules_passed?: number;
  rules_failed?: string[];
  backtest_grade?: string;
  backtest_label?: string;
  backtest_pf?: number | null;
  backtest_win_rate_pct?: number | null;
  backtest_trades?: number;
  backtest_expectancy_pct?: number | null;
  incremental_stale?: boolean;
}

interface TransparencyBlock {
  engine_version: string;
  scan_mode: string;
  universe_size: number;
  scanned: number;
  total_hits_raw: number;
  fresh_hits: number;
  stale_carried: number;
  incremental_refreshed: number;
  incremental_carried: number;
  tiers_source: string;
  filter_stats: Record<string, number> | null;
  elapsed_sec: number;
  backtest_truth_preload: number;
  backtest_method: string;
  regime_blocks_strict_enter: boolean;
  regime_key: string;
  accuracy_note: string;
}

interface AutoState {
  ok: boolean;
  profile: { title: string; refresh_sec: number; scan_sec: number; full_scan_sec: number };
  guidance: { title: string; message: string; deploy_pct: number; tone: string };
  regime: { label?: string; key?: string; blocks_strict_enter?: boolean } | null;
  tiers: Record<TierId, HitRow[]>;
  positions: PositionsBlock & { heat_pct: number };
  transparency?: TransparencyBlock;
  session?: NseSessionInfo;
  scan: {
    hit_count?: number;
    fresh_hit_count?: number;
    scanned?: number;
    scan_mode?: string;
    elapsed_sec?: number;
    incremental_stale?: boolean;
    incremental_carried?: number;
    incremental_refreshed?: number;
    universe_size?: number;
    engine_version?: string;
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

function btClass(grade: string): string {
  const g = grade.toLowerCase();
  if (g === 'strong') return 'swing-bt-strong';
  if (g === 'ok') return 'swing-bt-ok';
  if (g === 'weak') return 'swing-bt-weak';
  if (g === 'fail') return 'swing-bt-fail';
  return 'swing-bt-unproven';
}

function BacktestCell({ hit }: { hit: HitRow }) {
  if (!hit.backtest_grade) {
    return <span className="muted">—</span>;
  }
  return (
    <span className={`swing-bt ${btClass(hit.backtest_grade)}`} title={btTitle(hit)}>
      {hit.backtest_label || hit.backtest_grade}
      {hit.backtest_pf != null ? (
        <small className="muted block">
          PF {hit.backtest_pf.toFixed(2)}
          {hit.backtest_win_rate_pct != null ? ` · ${hit.backtest_win_rate_pct}%` : ''}
          {hit.backtest_trades ? ` · n=${hit.backtest_trades}` : ''}
        </small>
      ) : null}
    </span>
  );
}

function btTitle(hit: HitRow): string {
  const parts = [
    hit.backtest_label,
    hit.backtest_pf != null ? `PF ${hit.backtest_pf}` : '',
    hit.backtest_win_rate_pct != null ? `WR ${hit.backtest_win_rate_pct}%` : '',
    hit.backtest_trades ? `${hit.backtest_trades} closed signals` : '',
    hit.backtest_expectancy_pct != null ? `E ${hit.backtest_expectancy_pct}%` : '',
    '2y walk-forward replay',
  ].filter(Boolean);
  return parts.join(' · ');
}

function addBlockReason(hit: HitRow, canAdd: boolean): string {
  if (hit.already_held) return 'Already held';
  if (hit.incremental_stale) return 'Stale carried';
  if (!canAdd) return 'Portfolio gate blocked';
  if (!hit.add_allowed) return 'Engine gate blocked';
  if (hit.suggested_shares <= 0) return 'No share size';
  return '';
}

export default function SwingAutoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTier = (searchParams.get('tier') as TierId) || 'high_conviction';
  const showCarried = searchParams.get('carried') === '1';
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
      const params = new URLSearchParams({ positions: '0' });
      if (live) params.set('live', '1');
      if (showCarried) params.set('include_carried', '1');
      const data = await api<AutoState>(`/api/v1/swing/auto/state?${params}`);
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auto radar');
    } finally {
      setLoading(false);
    }
  }, [showCarried]);

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
        symbol_count?: number;
      }>('/api/v1/swing/auto/scan', {
        method: 'POST',
        body: JSON.stringify({ force: true, full: true }),
      });

      if (!res.ok) {
        setError(res.error ?? 'Scan not started');
        setScanning(false);
        return;
      }

      if (res.background && res.jobId) {
        setScanMessage(`Full N250 scan queued (${res.symbol_count ?? '—'} symbols)…`);
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

    const shares = hit.suggested_shares;
    const confirmMsg = [
      `Add ${hit.symbol}?`,
      `Entry ₹${hit.price.toFixed(2)} (EOD scan price${hit.as_of_date ? ` ${hit.as_of_date}` : ''})`,
      `Stop ₹${hit.stop_loss.toFixed(2)}`,
      `${shares} shares`,
      hit.profit_target > 0 ? `Target ₹${hit.profit_target.toFixed(2)}` : '',
      hit.risk_flags.length ? `Flags: ${hit.risk_flags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (!window.confirm(confirmMsg)) return;

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
    const next = new URLSearchParams(searchParams);
    next.set('tier', tier);
    setSearchParams(next);
  }

  function toggleCarried() {
    const next = new URLSearchParams(searchParams);
    if (showCarried) next.delete('carried');
    else next.set('carried', '1');
    setSearchParams(next);
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
  const regimeLabel = formatRegimeLabel(state.regime as Record<string, unknown> | null);
  const tierRows = state.tiers[activeTier] ?? [];
  const scanActive = state.scan_status?.active || scanning;
  const waitingForWorker =
    !state.snapshot?.saved_at && state.scan_status?.label === 'idle' && !scanActive;
  const risk = state.portfolio_risk;
  const transparency = state.transparency;
  const setupPlusCount =
    (state.tiers.setup_radar?.length ?? 0) + (state.tiers.breakout_surge?.length ?? 0);
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

      {state.session && <NseSessionBanner session={state.session} />}

      {waitingForWorker && (
        <section className="card swing-auto-worker-hint" role="status">
          <p style={{ margin: 0 }}>
            <strong>Waiting for first scan.</strong> Start the background worker so Nifty 250 scans run
            every 5 minutes: <code>pnpm dev:worker</code> (or <code>pnpm dev:all</code>).
          </p>
        </section>
      )}

      <section className="card swing-kpi-bar">
        <div className="swing-kpi-pills">
          <span className={`swing-pill ${scanActive ? 'pill-scanning' : 'pill-live'}`}>
            {scanActive ? '● Scanning' : waitingForWorker ? '● Idle' : '● Live'}
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
        <div className="swing-kpi-compact">
          <span>
            High conviction <strong className="swing-pnl-pos">{state.tiers.high_conviction?.length ?? 0}</strong>
          </span>
          <span>
            Strict ENTER <strong>{state.tiers.strict_enter?.length ?? 0}</strong>
          </span>
          <span>
            SETUP+ <strong>{state.scan.fresh_hit_count ?? state.scan.hit_count ?? setupPlusCount}</strong>
          </span>
          {risk ? (
            <span>
              Portfolio heat <strong>{risk.heat_pct.toFixed(1)}%</strong>
            </span>
          ) : null}
          {risk ? (
            <span>
              New entries <strong>{risk.can_add ? 'OK' : 'Blocked'}</strong>
            </span>
          ) : null}
          {state.scan.elapsed_sec ? (
            <span>{Number(state.scan.elapsed_sec).toFixed(1)}s scan</span>
          ) : null}
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0' }}>
          {state.scan.scanned ?? 0} evaluated this cycle
          {state.scan.universe_size ? ` · universe ${state.scan.universe_size}` : ''}
          {' · '}
          {state.scan.fresh_hit_count ?? state.scan.hit_count ?? 0} fresh hits
          {showCarried ? ' · showing carried stale in tiers' : ''}
          {!showCarried && state.scan.incremental_carried
            ? ` · ${state.scan.incremental_carried} stale carried (hidden)`
            : ''}
          {state.scan.incremental_refreshed
            ? ` · ${state.scan.incremental_refreshed} refreshed`
            : ''}
          {state.scan.elapsed_sec ? ` · ${state.scan.elapsed_sec}s` : ''} · snapshot {savedAt}
        </p>
        <label className="swing-carried-toggle">
          <input type="checkbox" checked={showCarried} onChange={toggleCarried} />
          Show carried / stale incremental hits (PHP parity — less accurate)
        </label>
      </section>

      {transparency && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Scan transparency</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {transparency.accuracy_note}
          </p>
          <dl className="swing-transparency-grid">
            <div>
              <dt>Engine</dt>
              <dd>{transparency.engine_version || '—'}</dd>
            </div>
            <div>
              <dt>Scan mode</dt>
              <dd>{transparency.scan_mode || '—'}</dd>
            </div>
            <div>
              <dt>Universe / scanned</dt>
              <dd>
                {transparency.universe_size} / {transparency.scanned}
              </dd>
            </div>
            <div>
              <dt>Hits (raw / fresh)</dt>
              <dd>
                {transparency.total_hits_raw} / {transparency.fresh_hits}
              </dd>
            </div>
            <div>
              <dt>Stale carried</dt>
              <dd>{transparency.stale_carried}</dd>
            </div>
            <div>
              <dt>Tier source</dt>
              <dd>{transparency.tiers_source}</dd>
            </div>
            <div>
              <dt>BT 2y preload</dt>
              <dd>
                {transparency.backtest_truth_preload} symbols ({transparency.backtest_method})
              </dd>
            </div>
            <div>
              <dt>Regime gate</dt>
              <dd>
                {transparency.regime_blocks_strict_enter ? 'Blocks strict ENTER' : 'Open'}
                {transparency.regime_key ? ` · ${transparency.regime_key}` : ''}
              </dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{transparency.elapsed_sec ? `${transparency.elapsed_sec}s` : '—'}</dd>
            </div>
          </dl>
          {transparency.filter_stats && Object.keys(transparency.filter_stats).length > 0 && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary>Filter breakdown (why symbols dropped)</summary>
              <ul className="muted" style={{ marginBottom: 0 }}>
                {Object.entries(transparency.filter_stats)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => (
                    <li key={key}>
                      {key}: {count}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>
      )}

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
        sessionLive={Boolean(state.session?.live_quotes)}
        onRefresh={async () => {
          await Promise.all([load(true), loadPositions(true)]);
        }}
      />

      <section className="card">
        <div className="swing-auto-section-head">
          <div>
            <h2 style={{ margin: 0 }}>{TIER_TABS.find((t) => t.id === activeTier)?.label ?? 'Radar hits'}</h2>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              Buckets are non-exclusive. Table is sorted by <strong>D-Score</strong> (actionability); Rank is the
              original swing rank.
            </p>
          </div>
          <Link to="/swing?mode=symbol" className="btn btn-secondary btn-xs">
            Symbol analysis
          </Link>
        </div>
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
          sessionLive={Boolean(state.session?.live_quotes)}
          waitingForWorker={waitingForWorker}
        />
      </section>
    </Page>
  );
}

function zoneLabel(hit: HitRow): string {
  const pct = hit.ta_pct_52w;
  const zone = String(hit.ta_52w_chart_zone ?? '').toUpperCase();
  if (pct == null) return zone || '—';
  return `${pct}%${zone ? ` · ${zone}` : ''}`;
}

function swingSymbolUrl(symbol: string): string {
  return `/swing?mode=symbol&symbol=${encodeURIComponent(symbol)}&autorun=1`;
}

function HitTable({
  rows,
  canAdd,
  addBusy,
  onAdd,
  sessionLive,
  waitingForWorker,
}: {
  rows: HitRow[];
  canAdd: boolean;
  addBusy: string | null;
  onAdd: (hit: HitRow) => void;
  sessionLive: boolean;
  waitingForWorker: boolean;
}) {
  const [query, setQuery] = useState('');
  const [addableOnly, setAddableOnly] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toUpperCase();
  const filtered = rows.filter((h) => {
    if (normalizedQuery && !h.symbol.toUpperCase().includes(normalizedQuery)) return false;
    if (addableOnly && !(h.add_allowed && canAdd && h.suggested_shares > 0 && !h.already_held && !h.incremental_stale)) {
      return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);
  const rangeStart = filtered.length === 0 ? 0 : start + 1;
  const rangeEnd = Math.min(start + pageSize, filtered.length);

  if (rows.length === 0) {
    return (
      <EmptyState>
        {waitingForWorker ? (
          <>
            Waiting for first scan — start <code>pnpm dev:worker</code> or click Run scan for a manual full
            N250 pass.
          </>
        ) : (
          <>
            No fresh hits in this tier. Run a full scan or wait for the worker (every 5m incremental, 30m
            full N250).
          </>
        )}
      </EmptyState>
    );
  }

  return (
    <>
      <div className="swing-auto-table-tools">
        <label>
          Search
          <input
            type="search"
            value={query}
            placeholder="Symbol"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="morning-live-toggle">
          <input
            type="checkbox"
            checked={addableOnly}
            onChange={(e) => {
              setAddableOnly(e.target.checked);
              setPage(1);
            }}
          />
          Addable only
        </label>
        <label>
          Rows
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
        <span className="segmented-meta">
          Showing {rangeStart}-{rangeEnd} / {filtered.length} filtered · {rows.length} tier rows
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table compact swing-auto-hits-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Decision</th>
              <th title="Decision score: actionability after risk flags, BT truth, and gates. Table sorts by this.">D-Score</th>
              <th title="2-year walk-forward backtest truth. Blank means not preloaded/evaluated for this state.">BT 2y</th>
              <th title="Original swing rank from the scan engine; not the table sort order.">Rank</th>
              <th title="Entry rule composite score (E1-E11), different from D-Score.">Entry</th>
              <th>Strict</th>
              <th>R</th>
              <th>Price</th>
              <th>Stop</th>
              <th>Target</th>
              <th>RSI</th>
              <th>52w</th>
              <th>Risk</th>
              <th>Add</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h) => {
              const showAdd =
                h.add_allowed && canAdd && h.suggested_shares > 0 && !h.already_held && !h.incremental_stale;
              const blocked = addBlockReason(h, canAdd);
              return (
                <tr key={h.symbol} className={h.incremental_stale ? 'row-stale' : undefined}>
                  <td>
                    <Link to={swingSymbolUrl(h.symbol)} className="swing-symbol-link">
                      <strong>{h.symbol}</strong>
                    </Link>
                    {h.already_held ? (
                      <span
                        className={`swing-held-badge${h.held_near_stop ? ' swing-held-near' : ''}`}
                        title={h.held_action_label || 'Already in open positions'}
                      >
                        Held
                        {h.held_action_label ? ` · ${h.held_action_label}` : ''}
                        {h.held_stop_distance_pct != null
                          ? ` · ${h.held_stop_distance_pct}% above stop`
                          : ''}
                      </span>
                    ) : null}
                    {h.incremental_stale ? (
                      <small className="muted block">stale carried</small>
                    ) : null}
                  </td>
                  <td>
                    <span className={decisionBadge(h.decision_action)}>
                      {h.decision_label || h.decision_action}
                    </span>
                  </td>
                  <td>
                    <strong>{h.decision_score}</strong>
                  </td>
                  <td>
                    <BacktestCell hit={h} />
                  </td>
                  <td>{h.swing_rank}</td>
                  <td>{h.entry_score}</td>
                  <td>
                    <span className={`swing-verdict-pill ${verdictClass(h.strict)}`}>{h.strict}</span>
                  </td>
                  <td>{h.r_multiple != null ? h.r_multiple.toFixed(2) : '—'}</td>
                  <td className="swing-uni-price">
                    {fmtMoney(h.price)}
                    {h.as_of_date ? (
                      <>
                        <br />
                        <PriceFreshness
                          row={{ as_of_date: h.as_of_date, live: false, data_source: 'yahoo_daily' }}
                          sessionLive={sessionLive}
                        />
                      </>
                    ) : null}
                  </td>
                  <td>{fmtMoney(h.stop_loss)}</td>
                  <td>{h.profit_target > 0 ? fmtMoney(h.profit_target) : '—'}</td>
                  <td>{h.ta_rsi14 ?? '—'}</td>
                  <td>
                    <span className={zoneClass(String(h.ta_52w_chart_zone ?? ''))}>{zoneLabel(h)}</span>
                  </td>
                  <td>
                    {h.risk_flags.length > 0 ? (
                      <span className="swing-risk-flags" title={h.risk_flags.join(', ')}>
                        {h.risk_flags.slice(0, 2).map((f) => (
                          <span key={f} className="swing-flag">
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {h.risk_flags.length > 2 ? '…' : ''}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {showAdd ? (
                      <div className="swing-hit-add">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={addBusy === h.symbol}
                          onClick={() => void onAdd(h)}
                        >
                          {addBusy === h.symbol ? '…' : '+ Add'}
                        </button>
                        <span className="muted swing-add-shares">
                          {h.suggested_shares} sh · ~₹
                          {Math.round(h.suggested_shares * h.price).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ) : (
                      <span className="muted swing-add-blocked">{blocked || '—'}</span>
                    )}
                    <Link to={swingSymbolUrl(h.symbol)} className="btn btn-secondary btn-xs swing-row-analyze">
                      Analyze
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <p className="muted" style={{ marginTop: '0.75rem' }}>No rows match the current table filters.</p>
      ) : null}
      {filtered.length > pageSize ? (
        <div className="swing-table-pager">
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="muted">
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

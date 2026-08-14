import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { NseSessionBanner, type NseSessionInfo } from '../components/NseSessionBanner';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import {
  EconomicGateBanner,
  pickEconomicGate,
  type EconomicGateBook,
} from '../components/research/EconomicGateBanner';
import { SignalCard } from '../components/research/SignalCard';
import { econFromSwingHit } from '../lib/signal-utils';
import { fmtMoney, formatRegimeLabel, verdictClass, zoneClass } from '../components/swing/format';
import { OpenPositionsPanel, type PositionsBlock } from '../components/swing/OpenPositionsPanel';
import { PriceFreshness } from '../components/swing/PriceFreshness';
import { SwingPaperTradingPanel } from '../components/swing/SwingPaperTradingPanel';

const TIER_TABS = [
  { id: 'high_conviction', label: 'High conviction' },
  { id: 'strict_enter', label: 'Strict ENTER' },
  { id: 'setup_radar', label: 'Setup radar' },
  { id: 'breakout_surge', label: 'Breakout surge' },
  { id: 'compounder_sleeve', label: 'Compounder' },
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
  strict_enter_ready?: boolean;
  net_edge_ok?: boolean;
  r_multiple_ok?: boolean;
  deploy_scale?: number;
  deploy_pct?: number;
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
  research_add_allowed?: boolean;
  add_block_reasons?: string[];
  already_held?: boolean;
  held_near_stop?: boolean;
  held_action_label?: string;
  held_stop_distance_pct?: number | null;
  high_conviction?: boolean;
  risk_flags: string[];
  tape_confluence?: {
    key: string;
    label: string;
    tone: string;
    score: number;
    factors: string[];
    summary: string;
  };
  sleeve?: string;
  sleeve_label?: string;
  sleeve_summary?: string;
  sleeve_eligible?: boolean;
  sleeve_blocks_swing_paper?: boolean;
  sleeve_hold?: {
    action?: string;
    label?: string;
    summary?: string;
    reasons?: string[];
    ignore_swing_target?: boolean;
    min_hold_sessions?: number;
  } | null;
  sleeve_policy?: {
    strategy_preset?: string;
    strategy_key?: string;
    min_hold_sessions?: number;
  } | null;
  rules_passed?: number;
  rules_failed?: string[];
  roe?: number | null;
  roce?: number | null;
  fundamental_quality_ok?: boolean | null;
  fundamental_quality_summary?: string | null;
  backtest_grade?: string;
  backtest_label?: string;
  backtest_pf?: number | null;
  backtest_win_rate_pct?: number | null;
  backtest_win_rate_ok?: boolean;
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
  scan_elapsed_sec?: number;
  sla?: {
    ok: boolean | null;
    label: string;
    summary: string;
    target_sec: number | null;
    elapsed_sec: number;
    scan_mode: string;
  };
  backtest_truth_preload: number;
  backtest_method: string;
  regime_blocks_strict_enter: boolean;
  regime_key: string;
  accuracy_note: string;
  hourly_on_scan?: boolean;
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
    portfolio_nav: number;
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

function tapeConfluenceBadge(tone?: string): string {
  const t = String(tone ?? 'muted');
  if (t === 'success') return 'badge badge-buy';
  if (t === 'warning') return 'badge badge-hold';
  if (t === 'danger') return 'badge badge-expensive';
  return 'badge';
}

function sleeveBadge(sleeve?: string): string {
  const s = String(sleeve ?? '');
  if (s === 'compounder') return 'badge badge-hold';
  if (s === 'swing') return 'badge badge-buy';
  if (s === 'avoid') return 'badge badge-expensive';
  return 'badge';
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
    '3y walk-forward replay',
  ].filter(Boolean);
  return parts.join(' · ');
}

function addBlockReason(hit: HitRow, canAdd: boolean, researchAdd: boolean): string {
  if (hit.already_held) return 'Already held';
  if (hit.incremental_stale) return 'Stale carried';
  if (!canAdd) return 'Portfolio gate blocked';
  if (researchAdd) {
    if (!hit.research_add_allowed) return 'Research gate blocked';
  } else if (!hit.add_allowed) {
    return hit.add_block_reasons?.length
      ? `Ch.93: ${hit.add_block_reasons[0]}`
      : 'Strict ENTER gate blocked';
  }
  if (hit.suggested_shares <= 0) return 'No share size';
  return '';
}

function hitAddable(hit: HitRow, canAdd: boolean, researchAdd: boolean): boolean {
  if (!canAdd || hit.suggested_shares <= 0 || hit.already_held || hit.incremental_stale) return false;
  return researchAdd ? Boolean(hit.research_add_allowed) : hit.add_allowed;
}

export default function SwingAutoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTier = (searchParams.get('tier') as TierId) || 'high_conviction';
  const showCarried = searchParams.get('carried') === '1';
  const researchAdd = searchParams.get('research_add') === '1';
  const [state, setState] = useState<AutoState | null>(null);
  const [positions, setPositions] = useState<PositionsBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    phase?: string;
    processed: number;
    total: number;
    passed?: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [addBusy, setAddBusy] = useState<string | null>(null);
  const [econBooks, setEconBooks] = useState<EconomicGateBook[]>([]);

  useEffect(() => {
    void api<{ books: EconomicGateBook[] }>('/api/v1/trading/economic-gates')
      .then((r) => setEconBooks(r.books ?? []))
      .catch(() => setEconBooks([]));
  }, []);

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
  }, [load, loadPositions]);

  useEffect(() => {
    const refreshSec = Math.max(15, Number(state?.profile?.refresh_sec ?? 60));
    const scanSec = Math.max(30, Number(state?.profile?.scan_sec ?? 60));
    const tierPoll = setInterval(() => void load(false), scanSec * 1000);
    const posPoll = setInterval(() => void loadPositions(true), refreshSec * 1000);
    return () => {
      clearInterval(tierPoll);
      clearInterval(posPoll);
    };
  }, [load, loadPositions, state?.profile?.refresh_sec, state?.profile?.scan_sec]);

  const finishScanJob = useCallback(async () => {
    setScanMessage('Scan finished — refreshing radar.');
    setScanJobId(null);
    setScanProgress(null);
    await Promise.all([load(true), loadPositions(true)]);
    setScanning(false);
  }, [load, loadPositions]);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await api<{
          job: {
            status: string;
            progress?: { phase?: string; processed: number; total: number; passed?: number };
          };
        }>(`/api/v1/screener/jobs/${jobId}`);
        if (res.job.progress?.total) {
          setScanProgress(res.job.progress);
          setScanMessage(
            `Scanning ${res.job.progress.processed}/${res.job.progress.total} symbols…`,
          );
        }
        if (res.job.status === 'done' || res.job.status === 'failed') {
          if (res.job.status === 'failed') setError('Scan job failed');
          await finishScanJob();
        }
      } catch {
        /* poll is best-effort while WS is primary */
      }
    },
    [finishScanJob],
  );

  useEffect(() => {
    if (!scanJobId) return;
    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/jobs/${scanJobId}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data) as {
          phase?: string;
          processed?: number;
          total?: number;
          passed?: number;
        };
        if (p.total != null && p.processed != null) {
          setScanProgress({
            phase: p.phase,
            processed: p.processed,
            total: p.total,
            passed: p.passed,
          });
          setScanMessage(`Scanning ${p.processed}/${p.total} symbols…`);
        }
        if (p.phase === 'done') void finishScanJob();
      } catch {
        /* ignore malformed progress */
      }
    };
    const interval = setInterval(() => void pollJob(scanJobId), 2_000);
    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [scanJobId, finishScanJob, pollJob]);

  async function runScan() {
    setScanMessage('');
    setError('');
    setScanProgress(null);
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
        setScanJobId(res.jobId);
        setScanMessage(`Full N250 scan queued (${res.symbol_count ?? '—'} symbols)…`);
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

    const liveTier =
      activeTier === 'high_conviction' || activeTier === 'strict_enter';
    if (!researchAdd && !liveTier && !hit.add_allowed) {
      setError(
        activeTier === 'compounder_sleeve'
          ? 'Compounder sleeve is research/journal only — enable research_add=1 (not Swing paper / X1–X9).'
          : 'Live Add only from High conviction / Strict ENTER. Enable research_add=1 for SETUP journal.',
      );
      return;
    }

    const shares = hit.suggested_shares;
    const isCompounder = hit.sleeve === 'compounder' || hit.sleeve_eligible === true;
    const confirmMsg = [
      researchAdd && !hit.add_allowed ? 'RESEARCH journal (not Ch.93 live ENTER)' : 'Add position',
      isCompounder ? 'COMPOUNDER sleeve (positional moat — ignore swing targets)' : '',
      `${hit.symbol}`,
      `Entry ₹${hit.price.toFixed(2)} (EOD scan price${hit.as_of_date ? ` ${hit.as_of_date}` : ''})`,
      `Stop ₹${hit.stop_loss.toFixed(2)}`,
      `${shares} shares (deploy ${hit.deploy_pct ?? state?.guidance?.deploy_pct ?? 100}% × ${hit.deploy_scale ?? 1}×)`,
      hit.profit_target > 0 && !isCompounder ? `Target ₹${hit.profit_target.toFixed(2)}` : '',
      isCompounder && hit.sleeve_hold?.summary ? hit.sleeve_hold.summary : '',
      hit.risk_flags.length ? `Flags: ${hit.risk_flags.join(', ')}` : '',
      hit.add_block_reasons?.length && researchAdd ? `Live gate: ${hit.add_block_reasons.join(' · ')}` : '',
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
          strict_verdict: hit.strict,
          strict_enter_ready: hit.strict_enter_ready,
          r_multiple_ok: hit.r_multiple_ok ?? (hit.r_multiple != null && hit.r_multiple >= 3),
          net_edge_ok: hit.net_edge_ok,
          decision_action: hit.decision_action,
          deploy_scale: hit.deploy_scale,
          deploy_pct: hit.deploy_pct ?? state?.guidance?.deploy_pct,
          research_add: researchAdd && !hit.add_allowed,
          incremental_stale: hit.incremental_stale,
          backtest_truth:
            hit.backtest_trades && hit.backtest_trades > 0
              ? {
                  trades_closed: hit.backtest_trades,
                  win_rate_pct: hit.backtest_win_rate_pct ?? 0,
                  profit_factor: hit.backtest_pf ?? 0,
                  grade: hit.backtest_grade ?? '',
                  win_rate_ok: hit.backtest_win_rate_ok,
                }
              : undefined,
        }),
      });

      if (!check.ok) {
        setError(check.error ?? 'Cannot add position');
        return;
      }

      const sessionLive = Boolean(state?.session?.live_quotes);
      const today = new Date().toISOString().slice(0, 10);
      const entryDate = !sessionLive && hit.as_of_date ? hit.as_of_date : today;
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol: hit.symbol,
          entry_price: check.entry_price ?? hit.price,
          entry_date: entryDate,
          stop_loss: check.stop_loss ?? hit.stop_loss,
          shares: check.shares ?? hit.suggested_shares,
          profit_target: hit.profit_target > 0 ? hit.profit_target : undefined,
          source: researchAdd && !hit.add_allowed ? 'research_radar' : 'auto_radar',
          notes: [
            researchAdd && !hit.add_allowed ? 'research_add (non-strict)' : '',
            isCompounder ? 'sleeve:compounder · pos_moat_compounders · ignore swing X2' : '',
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
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

  async function updatePortfolioNav() {
    const current = state?.portfolio_risk?.portfolio_nav ?? 1_000_000;
    const entered = window.prompt('Swing portfolio NAV (₹)', String(current));
    if (entered == null) return;
    const portfolioNav = Number(entered.replace(/,/g, ''));
    if (!Number.isFinite(portfolioNav) || portfolioNav < 10_000) {
      setError('Portfolio NAV must be at least ₹10,000.');
      return;
    }
    try {
      await api('/api/v1/swing/auto/risk-settings', {
        method: 'POST',
        body: JSON.stringify({ portfolio_nav: portfolioNav }),
      });
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update portfolio NAV');
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

  function toggleResearchAdd() {
    const next = new URLSearchParams(searchParams);
    if (researchAdd) next.delete('research_add');
    else next.set('research_add', '1');
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
      {scanProgress && scanning && scanProgress.total > 0 ? (
        <section className="card screener-progress" aria-live="polite">
          <div className="screener-progress-header">
            <span>
              {scanProgress.phase === 'done' ? 'Complete' : 'Scanning'} — {scanProgress.processed}/
              {scanProgress.total} symbols
            </span>
            <span className="muted">
              {scanProgress.passed != null ? `${scanProgress.passed} hits · ` : ''}
              {Math.round((scanProgress.processed / scanProgress.total) * 100)}%
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, Math.round((scanProgress.processed / scanProgress.total) * 100))}%`,
              }}
            />
          </div>
        </section>
      ) : null}
      {error && <p className="error">{error}</p>}

      {state.session && <NseSessionBanner session={state.session} />}

      <EconomicGateBanner
        gate={pickEconomicGate(econBooks, { id: 'swing_auto_hc' })}
        backtestHref="/swing/backtest"
      />

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
          <span>
            Compounder <strong>{state.tiers.compounder_sleeve?.length ?? 0}</strong>
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
        <label className="swing-carried-toggle">
          <input type="checkbox" checked={researchAdd} onChange={toggleResearchAdd} />
          Research Add (SETUP / breakout journal — bypasses Ch.93 strict ENTER)
        </label>
        {researchAdd ? (
          <p className="disclaimer" style={{ marginTop: '0.35rem' }}>
            Research mode on — Add journals non-strict names for tracking only. Prefer High conviction /
            Strict ENTER for live risk.
          </p>
        ) : null}
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
              <dt>BT 3y preload</dt>
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
              <dt>Hourly E9 on scan</dt>
              <dd>{transparency.hourly_on_scan ? 'Yes (incremental)' : 'No (full N250 daily-only)'}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>
                {transparency.elapsed_sec ? `${transparency.elapsed_sec}s` : '—'}
                {transparency.scan_elapsed_sec != null &&
                transparency.scan_elapsed_sec !== transparency.elapsed_sec
                  ? ` (scan ${transparency.scan_elapsed_sec}s)`
                  : ''}
              </dd>
            </div>
            <div>
              <dt>Scan SLA</dt>
              <dd
                title={transparency.sla?.summary || undefined}
                className={
                  transparency.sla?.ok === true
                    ? 'swing-pnl-pos'
                    : transparency.sla?.ok === false
                      ? 'error'
                      : 'muted'
                }
              >
                {transparency.sla?.label ?? '—'}
                {transparency.sla?.target_sec
                  ? ` · target ≤${transparency.sla.target_sec}s`
                  : ''}
              </dd>
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
          NAV ₹{(risk?.portfolio_nav ?? 1_000_000).toLocaleString('en-IN')} · deploy cap{' '}
          {state.guidance.deploy_pct}% · heat {risk?.heat_pct ?? state.positions.heat_pct}% /{' '}
          {risk?.max_heat_pct ?? 4}% · {state.positions.count}/{risk?.max_positions ?? 10} open
          {risk?.can_add === false && risk.blocked_reason ? (
            <span className="swing-blocked"> · New entries blocked: {risk.blocked_reason}</span>
          ) : (
            <span> · New entries allowed</span>
          )}
        </p>
        <button type="button" className="btn btn-secondary btn-xs" onClick={() => void updatePortfolioNav()}>
          Set portfolio NAV
        </button>
      </section>

      <OpenPositionsPanel
        positions={positionsBlock}
        sessionLive={Boolean(state.session?.live_quotes)}
        onRefresh={async () => {
          await Promise.all([load(true), loadPositions(true)]);
        }}
      />

      <SwingPaperTradingPanel />

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
          researchAdd={researchAdd}
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
  researchAdd,
  addBusy,
  onAdd,
  sessionLive,
  waitingForWorker,
}: {
  rows: HitRow[];
  canAdd: boolean;
  researchAdd: boolean;
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
    if (addableOnly && !hitAddable(h, canAdd, researchAdd)) return false;
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
          {researchAdd ? ' · research Add on' : ' · live Add = strict ENTER'}
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table compact swing-auto-hits-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Decision</th>
              <th title="Daily setup + volume/breakout + soft E9/hourly + regime (no 5m/15m fetch).">Tape</th>
              <th title="Swing vs compounder sleeve (BSE/INDIGO research: don’t force X1–X9 on re-rating names).">Sleeve</th>
              <th title="Decision score: actionability after risk flags, BT truth, and gates. Table sorts by this.">D-Score</th>
              <th title="3-year walk-forward backtest truth. Blank means not preloaded/evaluated for this state.">BT 3y</th>
              <th title="Original swing rank from the scan engine; not the table sort order.">Rank</th>
              <th title="Hard E1–E8 entry score (soft E9–E12 are catalysts). Different from D-Score.">Entry</th>
              <th>Strict</th>
              <th title="CFA quality floor: ROE & ROCE ≥ 15% (ROE-only for banks/NBFCs/insurance).">ROE</th>
              <th title="CFA quality floor: ROE & ROCE ≥ 15% (ROE-only for banks/NBFCs/insurance).">ROCE</th>
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
              const showAdd = hitAddable(h, canAdd, researchAdd);
              const blocked = addBlockReason(h, canAdd, researchAdd);
              return (
                <tr key={h.symbol} className={h.incremental_stale ? 'row-stale' : undefined}>
                  <td className="swing-signal-cell">
                    <SignalCard
                      variant="inline"
                      symbol={h.symbol}
                      verdict={h.strict}
                      verdictClassName={verdictClass(h.strict)}
                      decisionLabel={h.decision_label || h.decision_action}
                      decisionScore={h.decision_score}
                      price={h.price}
                      highConviction={h.high_conviction}
                      recommendationBasis="screening_matrix"
                      scoreBasis="quality_proxy"
                      econStatus={econFromSwingHit(h)}
                      backtestLabel={
                        h.backtest_pf != null
                          ? `BT PF ${h.backtest_pf.toFixed(2)}`
                          : undefined
                      }
                    />
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
                    {h.tape_confluence ? (
                      <span
                        className={tapeConfluenceBadge(h.tape_confluence.tone)}
                        title={h.tape_confluence.summary}
                      >
                        {h.tape_confluence.label}
                        {h.tape_confluence.score > 0 ? ` · ${h.tape_confluence.score}` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {h.sleeve ? (
                      <span
                        className={sleeveBadge(h.sleeve)}
                        title={
                          [h.sleeve_summary, h.sleeve_hold?.summary].filter(Boolean).join(' · ') ||
                          undefined
                        }
                      >
                        {h.sleeve_label || h.sleeve}
                        {h.sleeve_hold?.label ? ` · ${h.sleeve_hold.label}` : ''}
                        {h.sleeve_eligible ? (
                          <>
                            {' '}
                            <Link
                              to={`/strategies?strategy=${encodeURIComponent(h.sleeve_policy?.strategy_key || 'pos_moat_compounders')}&style=positional`}
                              className="muted"
                            >
                              →
                            </Link>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
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
                  <td
                    title={h.fundamental_quality_summary || undefined}
                    className={
                      h.fundamental_quality_ok === false
                        ? 'swing-quality-fail'
                        : h.fundamental_quality_ok === true
                          ? 'swing-quality-ok'
                          : undefined
                    }
                  >
                    {h.roe != null && h.roe > 0 ? `${h.roe}%` : '—'}
                  </td>
                  <td
                    title={h.fundamental_quality_summary || undefined}
                    className={
                      h.fundamental_quality_ok === false
                        ? 'swing-quality-fail'
                        : h.fundamental_quality_ok === true
                          ? 'swing-quality-ok'
                          : undefined
                    }
                  >
                    {h.roce != null && h.roce > 0 ? `${h.roce}%` : '—'}
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
                          {addBusy === h.symbol ? '…' : researchAdd && !h.add_allowed ? '+ Research' : '+ Add'}
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

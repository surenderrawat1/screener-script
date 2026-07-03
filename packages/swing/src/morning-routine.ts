import { NSE_PHASE, type NseSession } from '@sv/shared';
import { portfolioHeatPct } from './portfolio-risk.js';

export type RoutineStatus = 'ok' | 'warn' | 'info' | 'muted';

export const MORNING_TOP_HITS = 5;

export interface RoutineStep {
  step: string;
  detail: string;
  href: string;
  status: RoutineStatus;
}

export interface SwingPanelStub {
  open?: number;
  exit_count?: number;
}

export interface IntradayPanelStub {
  open?: number;
  exit_count?: number;
}

export interface IntradayPanel {
  open: number;
  exit_count: number;
  rows: Array<{
    label: string;
    gain_pct: number | null;
    position_action: string;
    action_label: string;
    id: string;
  }>;
  urgent: Array<{
    label: string;
    symbol: string;
    action: string;
  }>;
  portfolio: {
    count: number;
    net_pnl_inr: number | null;
  };
  available: boolean;
  live?: boolean;
}

export interface EtfPanelStub {
  hits?: unknown[];
  hit_count?: number;
}

export interface AutoPanelStub {
  available?: boolean;
  hits?: unknown[];
  saved_ago?: string | null;
}

export interface NiftyPanelStub {
  ok?: boolean;
  label?: string;
  summary?: string;
}

export interface SwingPanel {
  open: number;
  exit_count: number;
  rows: Array<{
    symbol: string;
    gain_pct: number | null;
    exit_verdict: string;
    current_price: number | null;
    id: string;
  }>;
  urgent: Array<{
    symbol: string;
    gain_pct: number | null;
    triggers: string[];
    id: string;
  }>;
  portfolio: {
    net_gain_pct: number | null;
    heat_pct: number;
    open: number;
  };
  live?: boolean;
}

export function countExitSignals(tracked: Record<string, unknown>[]): number {
  return tracked.filter((row) => String(row.exit_verdict ?? '') === 'EXIT').length;
}

export function summarizeOpenPortfolio(tracked: Record<string, unknown>[]) {
  let sumGain = 0;
  let gainCount = 0;
  for (const row of tracked) {
    const g = row.gain_pct;
    if (typeof g === 'number' && Number.isFinite(g)) {
      sumGain += g;
      gainCount += 1;
    }
  }
  return {
    net_gain_pct: gainCount > 0 ? Math.round((sumGain / gainCount) * 10) / 10 : null,
    heat_pct: portfolioHeatPct(tracked),
    open: tracked.length,
  };
}

export function swingPositionsPanel(
  tracked: Record<string, unknown>[],
  options: { live?: boolean } = {},
): SwingPanel {
  const exitCount = countExitSignals(tracked);
  const urgent: SwingPanel['urgent'] = [];
  for (const row of tracked) {
    if (String(row.exit_verdict ?? '') !== 'EXIT') continue;
    urgent.push({
      symbol: String(row.symbol ?? ''),
      gain_pct: typeof row.gain_pct === 'number' ? row.gain_pct : null,
      triggers: Array.isArray(row.exit_triggers) ? row.exit_triggers.map(String) : [],
      id: String(row.id ?? ''),
    });
  }

  const rows: SwingPanel['rows'] = [];
  for (const row of tracked.slice(0, MORNING_TOP_HITS)) {
    rows.push({
      symbol: String(row.symbol ?? ''),
      gain_pct: typeof row.gain_pct === 'number' ? row.gain_pct : null,
      exit_verdict: String(row.exit_verdict ?? ''),
      current_price: typeof row.current_price === 'number' ? row.current_price : null,
      id: String(row.id ?? ''),
    });
  }

  return {
    open: tracked.length,
    exit_count: exitCount,
    urgent,
    rows,
    portfolio: summarizeOpenPortfolio(tracked),
    live: options.live ?? false,
  };
}

const INTRADAY_EXIT_ACTIONS = new Set(['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS']);

export function intradayPositionsPanel(
  tracked: Record<string, unknown>[],
  options: { available?: boolean; live?: boolean } = {},
): IntradayPanel {
  const exitCount = tracked.filter((row) => String(row.exit_verdict ?? '') === 'EXIT').length;
  const urgent: IntradayPanel['urgent'] = [];

  for (const row of tracked) {
    const act = String(row.position_action ?? 'HOLD');
    if (!INTRADAY_EXIT_ACTIONS.has(act) && String(row.exit_verdict ?? '') !== 'EXIT') continue;
    const pos = (row.position as Record<string, unknown> | undefined) ?? row;
    urgent.push({
      label: String(row.instrument_label ?? pos.instrument_label ?? ''),
      symbol: String(pos.symbol ?? row.symbol ?? ''),
      action: String(row.action_label ?? act),
    });
  }

  const rows: IntradayPanel['rows'] = [];
  for (const row of tracked.slice(0, MORNING_TOP_HITS)) {
    const pos = (row.position as Record<string, unknown> | undefined) ?? row;
    rows.push({
      label: String(row.instrument_label ?? pos.instrument_label ?? ''),
      gain_pct: typeof row.gain_pct === 'number' ? row.gain_pct : null,
      position_action: String(row.position_action ?? ''),
      action_label: String(row.action_label ?? ''),
      id: String(pos.id ?? row.id ?? ''),
    });
  }

  let netPnl = 0;
  let pnlCount = 0;
  for (const row of tracked) {
    const pnl = row.pnl_inr;
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      netPnl += pnl;
      pnlCount += 1;
    }
  }

  return {
    open: tracked.length,
    exit_count: exitCount,
    urgent,
    rows,
    portfolio: {
      count: pnlCount,
      net_pnl_inr: pnlCount > 0 ? Math.round(netPnl * 100) / 100 : null,
    },
    available: options.available !== false,
    live: options.live ?? false,
  };
}

export function buildAlerts(
  swing: { exit_count?: number; urgent?: SwingPanel['urgent'] },
  intraday: { exit_count?: number; urgent?: Array<Record<string, unknown>> },
): string[] {
  const alerts: string[] = [];
  const swingExit = Number(swing.exit_count ?? 0);
  const intraExit = Number(intraday.exit_count ?? 0);

  if (swingExit > 0) {
    alerts.push(`${swingExit} swing position(s) triggered EXIT rules`);
  }
  if (intraExit > 0) {
    alerts.push(`${intraExit} intraday position(s) need action`);
  }

  for (const row of swing.urgent ?? []) {
    const triggers = row.triggers?.length ? ` (${row.triggers.join(', ')})` : '';
    alerts.push(`Swing EXIT: ${row.symbol}${triggers}`);
  }

  for (const row of intraday.urgent ?? []) {
    const label = String(row.label ?? row.symbol ?? '');
    const action = String(row.action ?? 'review');
    alerts.push(`Intraday: ${label} → ${action}`);
  }

  return [...new Set(alerts)];
}

export function serializeNiftyPanel(niftyState: Record<string, unknown> | null) {
  if (!niftyState?.ok) {
    return {
      ok: false,
      label: '—',
      tone: 'neutral',
      summary: 'Nifty intraday data unavailable',
      confidence: 0,
      price: null as number | null,
      setup_grade: '',
      instrument_label: 'Nifty 50',
      href: '/intraday',
      as_of: '',
    };
  }

  const analysis = (niftyState.analysis_15m ?? niftyState.analysis) as Record<string, unknown>;
  const setupQuality = analysis.setup_quality as Record<string, unknown> | undefined;

  return {
    ok: true,
    label: String(analysis.direction_label ?? '—'),
    tone: String(analysis.tone ?? 'neutral'),
    summary: String(analysis.summary ?? ''),
    as_of: String(analysis.as_of ?? ''),
    confidence: Number(analysis.confidence ?? 0),
    price: (analysis.price as number | null | undefined) ?? null,
    entry_window: (analysis.entry_window as Record<string, unknown> | undefined) ?? {},
    session_regime: (analysis.session_regime as Record<string, unknown> | undefined) ?? {},
    setup_grade: String(setupQuality?.grade ?? ''),
    instrument_label: String(niftyState.index_label ?? 'Nifty 50'),
    href: '/intraday',
  };
}

export function agoLabel(secondsAgo: number): string {
  if (secondsAgo < 60) return 'just now';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  return `${Math.floor(secondsAgo / 86400)}d ago`;
}

export function routineSteps(
  session: NseSession,
  swing: SwingPanelStub,
  intraday: IntradayPanelStub,
  etf: EtfPanelStub,
  auto: AutoPanelStub,
  nifty: NiftyPanelStub = {},
): RoutineStep[] {
  const swingOpen = Number(swing.open ?? 0);
  const swingExit = Number(swing.exit_count ?? 0);
  const intraOpen = Number(intraday.open ?? 0);
  const intraExit = Number(intraday.exit_count ?? 0);
  const etfHits = Array.isArray(etf.hits) ? etf.hits : [];
  const autoHits = Array.isArray(auto.hits) ? auto.hits : [];

  return [
    {
      step: 'Check NSE session',
      detail: `${session.label} · ${session.message}`,
      href: '/morning',
      status: session.phase === NSE_PHASE.OPEN ? 'ok' : 'info',
    },
    {
      step: 'Swing regime (NIFTYBEES)',
      detail: 'Daily proxy for deploy bias and strict ENTER gate',
      href: '/swing/auto',
      status: 'info',
    },
    {
      step: 'Review open swing positions',
      detail: `${swingOpen} open${swingExit > 0 ? ` · ${swingExit} EXIT` : ''}`,
      href: '/positions',
      status: swingExit > 0 ? 'warn' : swingOpen > 0 ? 'ok' : 'muted',
    },
    {
      step: 'Nifty 15m direction',
      detail:
        nifty.ok && nifty.summary
          ? `${nifty.label ?? '—'} · ${nifty.summary}`
          : nifty.ok && nifty.label
            ? String(nifty.label)
            : 'Intraday bias before entries',
      href: '/intraday',
      status: nifty.ok ? 'ok' : 'info',
    },
    {
      step: 'Intraday positions',
      detail: `${intraOpen} open${intraExit > 0 ? ` · ${intraExit} exit signal(s)` : ''}`,
      href: '/intraday/positions',
      status: intraExit > 0 ? 'warn' : intraOpen > 0 ? 'ok' : 'muted',
    },
    {
      step: 'ETF SETUP+ book',
      detail: `${etfHits.length} hits · ${Number(etf.hit_count ?? 0)} total`,
      href: '/swing?universe=swing_etf',
      status: etfHits.length > 0 ? 'ok' : 'muted',
    },
    {
      step: 'Swing Auto high conviction',
      detail: auto.available
        ? `${autoHits.length} names · saved ${auto.saved_ago ?? '—'}`
        : 'No snapshot — open Swing Auto to scan',
      href: '/swing/auto',
      status: auto.available && autoHits.length > 0 ? 'ok' : 'muted',
    },
  ];
}

export function mapAutoHits(hits: Record<string, unknown>[], limit = 5) {
  return hits.slice(0, limit).map((hit) => ({
    symbol: String(hit.symbol ?? ''),
    decision_label: String(hit.decision_label ?? hit.decision_action ?? ''),
    decision_score: Number(hit.decision_score ?? 0),
    verdict: String(hit.verdict ?? ''),
    strict_verdict: String(hit.strict_verdict ?? ''),
    price: hit.price ?? null,
  }));
}

export function autoRadarPanel(snapshot: {
  saved_at?: string;
  tiers?: Record<string, unknown>;
  summary?: Record<string, unknown>;
} | null) {
  if (!snapshot) {
    return {
      available: false,
      hits: [],
      hit_count: 0,
      saved_at: null as string | null,
      saved_ago: null as string | null,
      summary: {},
    };
  }

  const tiers = (snapshot.tiers ?? {}) as Record<string, unknown>;
  const rawHits = Array.isArray(tiers.high_conviction) ? (tiers.high_conviction as Record<string, unknown>[]) : [];
  const hits = mapAutoHits(rawHits);
  const savedAt = String(snapshot.saved_at ?? '');
  const savedTs = savedAt ? Date.parse(savedAt) : NaN;
  const savedAgo = Number.isFinite(savedTs) ? agoLabel(Math.max(0, Math.floor((Date.now() - savedTs) / 1000))) : null;

  return {
    available: true,
    hits,
    hit_count: rawHits.length,
    saved_at: savedAt || null,
    saved_ago: savedAgo,
    summary: (snapshot.summary ?? {}) as Record<string, unknown>,
  };
}

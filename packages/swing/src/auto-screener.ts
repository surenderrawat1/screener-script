import {
  ACTION_SKIP,
  categorizeHits,
  enrichHit,
  evaluatePositionAction,
  overlayOpenPositionsOnTiers,
  regimeGuidance,
} from './auto-decision.js';
import { tier } from './ranker.js';
import {
  canOpenPosition,
  DEFAULT_PORTFOLIO_NAV,
  portfolioHeatPct,
  suggestedShares,
} from './portfolio-risk.js';
import { FULL_SCAN_INTERVAL_SEC } from './incremental-scan.js';

export { FULL_SCAN_INTERVAL_SEC };
export const UNIVERSE = 'nifty250';
export const POSITION_REFRESH_INTERVAL_SEC = 60;
export const SCAN_INTERVAL_SEC = 300;

export function scanInput() {
  return {
    universe: UNIVERSE,
    max_scan: 0,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'swing_rank',
    zone_52w: 'any',
    breakout_volume: false,
    rank_hits: true,
  };
}

export function profile() {
  return {
    title: 'Nifty LargeMidcap 250 — CFA Swing Radar',
    universe: UNIVERSE,
    universe_label: 'Nifty LargeMidcap 250',
    min_verdict: 'SETUP_PLUS',
    sort_by: 'swing_rank',
    method: 'Decision-ranked SETUP+ · positions 60s · full N250 30m',
    refresh_sec: POSITION_REFRESH_INTERVAL_SEC,
    scan_sec: SCAN_INTERVAL_SEC,
    full_scan_sec: FULL_SCAN_INTERVAL_SEC,
  };
}

export function serializeHit(hit: Record<string, unknown>) {
  const discovery = String(hit.verdict ?? 'AVOID');
  const strict = String(hit.strict_verdict ?? discovery);
  const pct = num(hit.ta_pct_52w);

  return {
    symbol: String(hit.symbol ?? ''),
    swing_rank: Number(hit.swing_rank ?? 0),
    tier: tier(Number(hit.swing_rank ?? 0)),
    entry_score: Number(hit.entry_score ?? 0),
    discovery,
    strict,
    decision_score: Number(hit.decision_score ?? 0),
    decision_action: String(hit.decision_action ?? ACTION_SKIP),
    decision_label: String(hit.decision_label ?? ''),
    high_conviction: Boolean(hit.high_conviction),
    risk_flags: Array.isArray(hit.risk_flags) ? hit.risk_flags : [],
    rules_passed: Number(hit.rules_passed ?? 0),
    rules_scored: Number(hit.rules_scored ?? 0),
    price: Math.round(Number(hit.price ?? 0) * 100) / 100,
    stop_loss: Math.round(Number(hit.stop_loss ?? 0) * 100) / 100,
    profit_target: Math.round(Number(hit.profit_target ?? 0) * 100) / 100,
    r_multiple: num(hit.r_multiple) !== null ? Math.round(Number(hit.r_multiple) * 100) / 100 : null,
    ta_rsi14: num(hit.ta_rsi14) !== null ? Math.round(Number(hit.ta_rsi14) * 10) / 10 : null,
    ta_pct_52w: pct !== null ? Math.round(pct) : null,
    ta_52w_chart_zone: String(hit.ta_52w_chart_zone ?? ''),
    ta_volume_ratio: num(hit.ta_volume_ratio) !== null ? Math.round(Number(hit.ta_volume_ratio) * 100) / 100 : null,
    broke_swing_high: Boolean(hit.broke_swing_high),
    as_of_date: String(hit.as_of_date ?? ''),
    suggested_shares: suggestedSharesForHit(hit),
    add_allowed: !['SKIP'].includes(String(hit.decision_action ?? '')),
  };
}

export function serializePosition(
  row: Record<string, unknown>,
  hitMatch?: Record<string, unknown> | null,
  regime?: Record<string, unknown> | null,
) {
  const action = evaluatePositionAction(row, hitMatch ?? null, regime ?? null);
  return {
    symbol: String(row.symbol ?? ''),
    status: String(row.status ?? 'open'),
    entry_price: Number(row.entry_price ?? 0),
    current_price: num(row.current_price),
    gain_pct: num(row.gain_pct),
    exit_verdict: String(row.exit_verdict ?? 'HOLD'),
    exit_triggers: Array.isArray(row.exit_triggers) ? row.exit_triggers : [],
    active_stop: num(row.active_stop),
    profit_target: num(row.profit_target),
    trail_armed: Boolean(row.trail_armed),
    trail_stop: num(row.trail_stop),
    sessions_held: Number(row.sessions_held ?? 0),
    position_action: action.action,
    action_label: action.label,
    action_reasons: action.reasons,
    stop_distance_pct: action.stop_distance_pct,
    r_unrealized: action.r_unrealized,
    hit_match: hitMatch
      ? {
          decision_action: hitMatch.decision_action,
          high_conviction: hitMatch.high_conviction,
          swing_rank: hitMatch.swing_rank,
        }
      : null,
  };
}

export function summarizeScan(
  scanResult: Record<string, unknown>,
  hits: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
) {
  const tiers = categorizeHits(hits, regime, false);
  return {
    scanned: Number(scanResult.scanned ?? 0),
    hit_count: Number(scanResult.hit_count ?? hits.length),
    high_conviction: tiers.high_conviction.length,
    strict_enter: tiers.strict_enter.length,
    setup_radar: tiers.setup_radar.length,
    breakout_surge: tiers.breakout_surge.length,
    elapsed_sec: Number(scanResult.elapsed_sec ?? 0),
    engine_version: String(scanResult.engine_version ?? ''),
  };
}

export function buildState(
  scanResult: Record<string, unknown> | null,
  openPositions: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
) {
  const hits = Array.isArray(scanResult?.hits) ? (scanResult!.hits as Record<string, unknown>[]) : [];
  let tiers = categorizeHits(hits, regime, false);
  const positionRows = openPositions.map((p) =>
    serializePosition(p, findHitMatch(hits, String(p.symbol ?? '')), regime),
  );
  tiers = overlayOpenPositionsOnTiers(tiers, positionRows) as typeof tiers;

  return {
    ok: true,
    profile: profile(),
    regime: regime ?? null,
    guidance: regimeGuidance(regime),
    scan: scanResult ?? { hits: [], hit_count: 0, scanned: 0 },
    tiers: {
      high_conviction: tiers.high_conviction.map(serializeHit),
      strict_enter: tiers.strict_enter.map(serializeHit),
      setup_radar: tiers.setup_radar.map(serializeHit),
      breakout_surge: tiers.breakout_surge.map(serializeHit),
    },
    positions: {
      open: positionRows,
      heat_pct: portfolioHeatPct(
        openPositions.map((p) => ({
          entry_price: p.entry_price,
          stop_loss: p.stop_loss ?? p.active_stop,
          shares: p.shares,
        })),
      ),
      count: openPositions.length,
    },
    server_time: new Date().toISOString(),
  };
}

export function checkAddPosition(
  input: Record<string, unknown>,
  openPositions: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
) {
  const symbol = String(input.symbol ?? '').toUpperCase().replace(/\.(NS|BO)$/, '');
  const entryPrice = Math.round(Number(input.entry_price ?? input.price ?? 0) * 100) / 100;
  let stopLoss = num(input.stop_loss) ?? 0;
  if (stopLoss <= 0 && entryPrice > 0) stopLoss = Math.round(entryPrice * 0.95 * 100) / 100;

  const shares = num(input.shares) ?? suggestedSharesForHit({ price: entryPrice, stop_loss: stopLoss });

  if (!symbol || entryPrice <= 0) {
    return { ok: false, error: 'Symbol and entry price are required.' };
  }

  for (const pos of openPositions) {
    if (String(pos.symbol ?? '').toUpperCase() === symbol) {
      return { ok: false, error: `${symbol} is already open — manage it in positions.`, already_held: true };
    }
  }

  if (regime?.blocks_strict_enter) {
    return {
      ok: false,
      error: 'Strong bear regime — new entries blocked. Manage open positions only.',
      blocked_by_regime: true,
    };
  }

  const gate = canOpenPosition(openPositions, entryPrice, stopLoss, DEFAULT_PORTFOLIO_NAV, shares);
  const suggested = suggestedSharesForHit({ price: entryPrice, stop_loss: stopLoss });
  const newRiskPct =
    gate.ok && entryPrice > stopLoss
      ? (((entryPrice - stopLoss) * shares) / DEFAULT_PORTFOLIO_NAV) * 100
      : 0;
  const heatAfter = gate.ok ? Math.round((gate.heat_pct + newRiskPct) * 100) / 100 : gate.heat_pct;

  return {
    ok: gate.ok,
    error: gate.ok ? null : gate.reason,
    symbol,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    shares,
    suggested_shares: suggested,
    heat_pct: gate.heat_pct,
    heat_after_pct: heatAfter,
    open_count: gate.open_count,
    max_heat: 4.0,
  };
}

export function suggestedSharesForHit(hit: Record<string, unknown>): number {
  const entry = Number(hit.price ?? 0);
  let stop = Number(hit.stop_loss ?? 0);
  if (entry <= 0) return 0;
  if (stop <= 0 || stop >= entry) stop = Math.round(entry * 0.95 * 100) / 100;
  return suggestedShares(entry, stop);
}

function findHitMatch(hits: Record<string, unknown>[], symbol: string) {
  const sym = symbol.toUpperCase();
  const raw = hits.find((h) => String(h.symbol ?? '').toUpperCase() === sym);
  return raw ? enrichHit(raw) : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

import {
  ACTION_SKIP,
  categorizeHits,
  computeTapeConfluence,
  enrichHit,
  evaluatePositionAction,
  overlayOpenPositionsOnTiers,
  POS_CUT,
  POS_EXIT,
  POS_HOLD,
  POS_TIGHTEN,
  POS_TRAIL,
  regimeGuidance,
} from './auto-decision.js';
import {
  MAX_DRAWDOWN_LIVE_PCT,
  MIN_PROFIT_FACTOR_LIVE,
  MIN_PROFITABLE_WIN_RATE_PCT,
  economicEdgeGateReasons,
  economicEdgeGateStatus,
  winRateGateStatus,
} from './auto-backtest-truth.js';
import { navDeployScaleForEntry } from './evaluate-entry.js';
import { tier } from './ranker.js';
import {
  canOpenPosition,
  DEFAULT_PORTFOLIO_NAV,
  portfolioHeatPct,
  resolvePositionSector,
  suggestedShares,
} from './portfolio-risk.js';
import { computeTradePnl, summarizeOpenTradePnl } from './trade-pnl.js';
import { FULL_SCAN_INTERVAL_SEC } from './incremental-scan.js';
import { evaluateScanSla } from './scan-sla.js';

/** Live-order gate — same discipline as symbol-mode SwingAddPositionForm. */
export function liveAddGateReasons(hit: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  if (hit.already_held) reasons.push('already held');
  if (hit.incremental_stale) reasons.push('stale carried data');
  if (String(hit.decision_action ?? '') === ACTION_SKIP) reasons.push('decision is SKIP');
  if (String(hit.strict_verdict ?? '') !== 'ENTER') reasons.push('strict verdict is not ENTER');
  if (hit.strict_enter_ready === false) reasons.push('strict gate is not ready');
  if (hit.r_multiple_ok !== true) reasons.push('R multiple is below minimum');
  if (hit.net_edge_ok === false) reasons.push('net edge is below floor');
  if (hit.fundamental_quality_ok === false) {
    reasons.push(String(hit.fundamental_quality_summary ?? 'ROE & ROCE must both be ≥ 15%'));
  } else if (hit.fundamental_quality_ok == null && (hit.roe != null || hit.roce != null)) {
    // Metrics present but quality not evaluated yet — still enforce floors.
    const roe = Number(hit.roe ?? 0);
    const roce = Number(hit.roce ?? 0);
    if (roe > 0 && roce > 0 && (roe < 15 || roce < 15)) {
      reasons.push(`ROE ${roe}% / ROCE ${roce}% — need both ≥ 15%`);
    }
  }

  const truth = (hit.backtest_truth as Record<string, unknown> | undefined) ?? null;
  const edgeReasons = economicEdgeGateReasons(
    truth
      ? {
          trades_closed: Number(truth.trades_closed ?? 0),
          profit_factor: Number(truth.profit_factor ?? 0),
          compounded_return_pct: Number(truth.compounded_return_pct ?? 0),
          max_drawdown_pct: Number(truth.max_drawdown_pct ?? 0),
          expectancy_pct: Number(truth.expectancy_pct ?? 0),
          win_rate_pct: Number(truth.win_rate_pct ?? 0),
          avg_win_pct: Number(truth.avg_win_pct ?? 0),
          avg_loss_pct: Number(truth.avg_loss_pct ?? 0),
        }
      : null,
  );
  reasons.push(...edgeReasons);
  return reasons;
}

export function isLiveAddAllowed(hit: Record<string, unknown>): boolean {
  return liveAddGateReasons(hit).length === 0;
}

/** Research-only journal (SETUP / breakout) — heat/regime still apply server-side. */
export function isResearchAddAllowed(hit: Record<string, unknown>): boolean {
  if (hit.already_held || hit.incremental_stale) return false;
  return String(hit.decision_action ?? '') !== ACTION_SKIP;
}

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

export function serializeHit(
  hit: Record<string, unknown>,
  regime?: Record<string, unknown> | null,
  options: { deploy_pct?: number; portfolio_nav?: number } = {},
) {
  const discovery = String(hit.verdict ?? 'AVOID');
  const strict = String(hit.strict_verdict ?? discovery);
  const pct = num(hit.ta_pct_52w);
  const truth = (hit.backtest_truth ?? {}) as Record<string, unknown>;
  const guidance = regimeGuidance(regime);
  const deployPct = options.deploy_pct ?? guidance.deploy_pct;
  const liveOk = hit.add_allowed === false ? false : isLiveAddAllowed(hit);
  const researchOk = hit.add_allowed === false ? false : isResearchAddAllowed(hit);
  const deployScale =
    num(hit.deploy_scale) ??
    navDeployScaleForEntry(regime, (hit.dynamic as Record<string, unknown> | undefined) ?? null);

  return {
    symbol: String(hit.symbol ?? ''),
    swing_rank: Number(hit.swing_rank ?? 0),
    tier: tier(Number(hit.entry_score ?? 0)),
    entry_score: Number(hit.entry_score ?? 0),
    discovery,
    strict,
    strict_enter_ready: hit.strict_enter_ready !== false && String(hit.strict_verdict ?? '') === 'ENTER',
    net_edge_ok: hit.net_edge_ok !== false,
    r_multiple_ok: hit.r_multiple_ok === true,
    deploy_scale: Math.round(deployScale * 100) / 100,
    deploy_pct: deployPct,
    decision_score: Number(hit.decision_score ?? 0),
    decision_action: String(hit.decision_action ?? ACTION_SKIP),
    decision_label: String(hit.decision_label ?? ''),
    already_held: Boolean(hit.already_held),
    held_near_stop: Boolean(hit.held_near_stop),
    held_action_label: String(hit.held_action_label ?? ''),
    held_stop_distance_pct:
      num(hit.held_stop_distance_pct) !== null ? Math.round(Number(hit.held_stop_distance_pct) * 10) / 10 : null,
    high_conviction: Boolean(hit.high_conviction),
    risk_flags: Array.isArray(hit.risk_flags) ? hit.risk_flags : [],
    tape_confluence:
      hit.tape_confluence && typeof hit.tape_confluence === 'object'
        ? hit.tape_confluence
        : computeTapeConfluence(hit, regime),
    sleeve: String(hit.sleeve ?? 'research'),
    sleeve_label: String(hit.sleeve_label ?? ''),
    sleeve_summary: String(hit.sleeve_summary ?? ''),
    sleeve_eligible: hit.sleeve_eligible === true,
    sleeve_blocks_swing_paper: hit.sleeve_blocks_swing_paper === true,
    sleeve_policy:
      hit.sleeve_policy && typeof hit.sleeve_policy === 'object' ? hit.sleeve_policy : null,
    sleeve_hold:
      hit.sleeve_hold && typeof hit.sleeve_hold === 'object' ? hit.sleeve_hold : null,
    add_block_reasons: liveAddGateReasons(hit),
    backtest_grade: String(truth.grade ?? ''),
    backtest_label: String(truth.grade_label ?? ''),
    backtest_pf: num(truth.profit_factor) !== null ? Math.round(Number(truth.profit_factor) * 100) / 100 : null,
    backtest_win_rate_pct:
      num(truth.win_rate_pct) !== null ? Math.round(Number(truth.win_rate_pct) * 10) / 10 : null,
    backtest_win_rate_ok: truth.win_rate_ok === true || winRateGateStatus({
      trades_closed: Number(truth.trades_closed ?? 0),
      win_rate_pct: Number(truth.win_rate_pct ?? 0),
    }) === 'pass',
    backtest_economic_edge_ok:
      truth.economic_edge_ok === true ||
      economicEdgeGateStatus({
        trades_closed: Number(truth.trades_closed ?? 0),
        profit_factor: Number(truth.profit_factor ?? 0),
        compounded_return_pct: Number(truth.compounded_return_pct ?? 0),
        max_drawdown_pct: Number(truth.max_drawdown_pct ?? 0),
        expectancy_pct: Number(truth.expectancy_pct ?? 0),
        win_rate_pct: Number(truth.win_rate_pct ?? 0),
        avg_win_pct: Number(truth.avg_win_pct ?? 0),
        avg_loss_pct: Number(truth.avg_loss_pct ?? 0),
      }) === 'pass',
    backtest_trades: Number(truth.trades_closed ?? 0),
    backtest_expectancy_pct:
      num(truth.expectancy_pct) !== null ? Math.round(Number(truth.expectancy_pct) * 100) / 100 : null,
    backtest_compounded_return_pct:
      num(truth.compounded_return_pct) !== null
        ? Math.round(Number(truth.compounded_return_pct) * 100) / 100
        : null,
    incremental_stale: Boolean(hit.incremental_stale),
    rules_passed: Number(hit.rules_passed ?? 0),
    rules_scored: Number(hit.rules_scored ?? 0),
    rules_hard_passed: Number(hit.rules_hard_passed ?? 0),
    rules_hard_total: Number(hit.rules_hard_total ?? 8),
    rules_soft_passed: Number(hit.rules_soft_passed ?? 0),
    rules_soft_total: Number(hit.rules_soft_total ?? 4),
    rules_failed: failedRuleIds(hit),
    entry_rules: (hit.entry_rules ?? hit.rules ?? []) as unknown[],
    price: Math.round(Number(hit.price ?? 0) * 100) / 100,
    stop_loss: Math.round(Number(hit.stop_loss ?? 0) * 100) / 100,
    profit_target: Math.round(Number(hit.profit_target ?? 0) * 100) / 100,
    r_multiple: num(hit.r_multiple) !== null ? Math.round(Number(hit.r_multiple) * 100) / 100 : null,
    ta_rsi14: num(hit.ta_rsi14) !== null ? Math.round(Number(hit.ta_rsi14) * 10) / 10 : null,
    ta_pct_52w: pct !== null ? Math.round(pct) : null,
    ta_52w_chart_zone: String(hit.ta_52w_chart_zone ?? ''),
    ta_volume_ratio: num(hit.ta_volume_ratio) !== null ? Math.round(Number(hit.ta_volume_ratio) * 100) / 100 : null,
    broke_swing_high: Boolean(hit.broke_swing_high),
    roe: num(hit.roe) !== null ? Math.round(Number(hit.roe) * 10) / 10 : null,
    roce: num(hit.roce) !== null ? Math.round(Number(hit.roce) * 10) / 10 : null,
    sector: hit.sector ? String(hit.sector) : null,
    industry: hit.industry ? String(hit.industry) : null,
    fundamental_quality_ok:
      hit.fundamental_quality_ok == null ? null : hit.fundamental_quality_ok === true,
    fundamental_quality_status: hit.fundamental_quality_status
      ? String(hit.fundamental_quality_status)
      : null,
    fundamental_quality_summary: hit.fundamental_quality_summary
      ? String(hit.fundamental_quality_summary)
      : null,
    fundamental_roce_waived: hit.fundamental_roce_waived === true,
    as_of_date: String(hit.as_of_date ?? ''),
    suggested_shares: suggestedSharesForHit(hit, regime, {
      deploy_pct: deployPct,
      portfolio_nav: options.portfolio_nav,
    }),
    add_allowed: liveOk,
    research_add_allowed: researchOk,
  };
}

export const URGENT_POSITION_ACTIONS = [POS_EXIT, POS_CUT, POS_TIGHTEN] as const;

function exitField(row: Record<string, unknown>, key: string): unknown {
  const exit = row.exit as Record<string, unknown> | undefined;
  return row[key] ?? exit?.[key];
}

function positionPnl(row: Record<string, unknown>) {
  const entry = Number(row.entry_price ?? 0);
  const cur = num(row.current_price);
  const shares = num(row.shares);
  if (cur === null || shares === null || shares <= 0 || entry <= 0) {
    return { gross_pnl: null as number | null, net_pnl: null as number | null, pnl_detail: null as Record<string, unknown> | null };
  }
  const pnl = computeTradePnl(entry, cur, shares);
  return {
    gross_pnl: pnl.gross_pnl,
    net_pnl: pnl.net_pnl,
    pnl_detail: pnl.charges as unknown as Record<string, unknown>,
  };
}

export function serializePosition(
  row: Record<string, unknown>,
  hitMatch?: Record<string, unknown> | null,
  regime?: Record<string, unknown> | null,
) {
  const action = evaluatePositionAction(row, hitMatch ?? null, regime ?? null);
  const posAction = action.action;
  const inHighConviction =
    hitMatch != null &&
    Boolean(hitMatch.high_conviction) &&
    (posAction === POS_HOLD || posAction === POS_TRAIL);

  const pnl = positionPnl(row);

  return {
    id: String(row.id ?? (row.position as Record<string, unknown> | undefined)?.id ?? ''),
    symbol: String(row.symbol ?? ''),
    notes: String(row.notes ?? ''),
    source: row.source != null ? String(row.source) : null,
    status: String(row.status ?? 'open'),
    entry_price: Number(row.entry_price ?? 0),
    entry_date: String(row.entry_date ?? ''),
    shares: num(row.shares),
    current_price: num(row.current_price),
    gain_pct: num(row.gain_pct),
    gross_pnl: pnl.gross_pnl,
    net_pnl: pnl.net_pnl,
    pnl_detail: pnl.pnl_detail,
    exit_verdict: String(row.exit_verdict ?? 'HOLD'),
    exit_triggers: Array.isArray(row.exit_triggers) ? row.exit_triggers : [],
    exit_rules: Array.isArray((row.exit as Record<string, unknown> | undefined)?.rules)
      ? ((row.exit as Record<string, unknown>).rules as Array<Record<string, unknown>>)
      : [],
    active_stop: num(row.active_stop),
    effective_stop: num(exitField(row, 'effective_stop') ?? row.active_stop),
    profit_target: num(row.profit_target),
    trail_armed: Boolean(exitField(row, 'trail_armed')),
    trail_stop: num(exitField(row, 'trail_stop')),
    trail_arm_pct: num(exitField(row, 'trail_arm_pct')),
    trail_from_high_pct: num(exitField(row, 'trail_from_high_pct')),
    high_water: num(exitField(row, 'high_water')),
    gain_to_arm_trail_pct: num(exitField(row, 'gain_to_arm_trail_pct')),
    breakeven_armed: Boolean(exitField(row, 'breakeven_armed')),
    sessions_held: Number(row.sessions_held ?? 0),
    ok: row.ok !== false && num(row.current_price) !== null,
    error: String(row.error ?? ''),
    position_action: posAction,
    action_label: action.label,
    action_reasons: action.reasons,
    stop_distance_pct: action.stop_distance_pct,
    r_unrealized: action.r_unrealized,
    in_high_conviction: inHighConviction,
    hit_match: hitMatch
      ? {
          decision_action: hitMatch.decision_action,
          high_conviction: hitMatch.high_conviction,
          swing_rank: hitMatch.swing_rank,
        }
      : null,
  };
}

export function sortPositionsByUrgency<
  T extends { position_action: string; exit_verdict: string },
>(rows: T[]): T[] {
  const priority = (r: T) => {
    const act = r.position_action;
    if (act === POS_EXIT) return 0;
    if (act === POS_CUT) return 1;
    if (act === POS_TIGHTEN) return 2;
    if (r.exit_verdict === 'EXIT') return 3;
    return 10;
  };
  return [...rows].sort((a, b) => priority(a) - priority(b));
}

export function buildPositionsBlock(
  openPositions: Record<string, unknown>[],
  hits: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
) {
  const rows = openPositions.map((p) =>
    serializePosition(p, findHitMatch(hits, String(p.symbol ?? ''), regime), regime),
  );
  const open = sortPositionsByUrgency(rows);
  const exitCount = open.filter((r) => r.exit_verdict === 'EXIT').length;
  const portfolio = summarizeOpenTradePnl(
    open.map((r) => ({
      entry_price: r.entry_price,
      current_price: r.current_price,
      shares: r.shares,
    })),
  );

  return {
    open,
    count: open.length,
    heat_pct: portfolioHeatPct(
      openPositions.map((p) => ({
        entry_price: p.entry_price,
        stop_loss: p.stop_loss ?? p.active_stop,
        shares: p.shares,
      })),
    ),
    exit_count: exitCount,
    urgent_count: open.filter((r) =>
      (URGENT_POSITION_ACTIONS as readonly string[]).includes(r.position_action),
    ).length,
    refreshed_at: new Date().toISOString(),
    summary: { open: open.length, exit_signals: exitCount },
    portfolio: {
      count: portfolio.count,
      net_pnl: portfolio.net_pnl,
      gross_pnl: portfolio.gross_pnl,
      charges_total: portfolio.charges_total,
      invested: portfolio.invested,
      current_value: portfolio.current_value,
    },
  };
}

export function summarizeClosedSwingPositions(closed: Record<string, unknown>[]) {
  let wins = 0;
  let losses = 0;
  let netSum = 0;
  let withPnl = 0;
  let rSum = 0;
  let rCount = 0;
  let best: { instrument: string; net_pnl: number; r_multiple: number | null } | null = null;
  let worst: { instrument: string; net_pnl: number; r_multiple: number | null } | null = null;

  for (const pos of closed) {
    const entry = Number(pos.entry_price ?? 0);
    const exit = Number(pos.closed_price ?? 0);
    const shares = Number(pos.shares ?? 0) || 1;
    if (entry <= 0 || exit <= 0) continue;

    const pnl = computeTradePnl(entry, exit, shares);
    const net = pnl.net_pnl;
    withPnl += 1;
    netSum += net;
    if (net >= 0) wins += 1;
    else losses += 1;

    let rMultiple: number | null = null;
    const stop = Number(pos.stop_loss ?? 0);
    if (stop > 0) {
      const risk = Math.abs(entry - stop);
      if (risk > 0) {
        rMultiple = Math.round(((exit - entry) / risk) * 100) / 100;
        rSum += rMultiple;
        rCount += 1;
      }
    }

    const label = String(pos.symbol ?? '');
    if (!best || net > best.net_pnl) {
      best = { instrument: label, net_pnl: net, r_multiple: rMultiple };
    }
    if (!worst || net < worst.net_pnl) {
      worst = { instrument: label, net_pnl: net, r_multiple: rMultiple };
    }
  }

  return {
    with_pnl: withPnl,
    wins,
    losses,
    win_rate_pct: withPnl > 0 ? Math.round((wins / withPnl) * 1000) / 10 : null,
    avg_r: rCount > 0 ? Math.round((rSum / rCount) * 100) / 100 : null,
    r_count: rCount,
    total_net_pnl: Math.round(netSum * 100) / 100,
    best,
    worst,
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
    compounder_sleeve: tiers.compounder_sleeve.length,
    elapsed_sec: Number(scanResult.elapsed_sec ?? 0),
    engine_version: String(scanResult.engine_version ?? ''),
  };
}

export function actionableScanHits(hits: Record<string, unknown>[]) {
  return hits.filter((h) => !h.incremental_stale);
}

export interface BuildStateOptions {
  includeCarried?: boolean;
  backtestAttached?: number;
  portfolioNav?: number;
}

export function buildScanTransparency(
  scanResult: Record<string, unknown> | null,
  allHits: Record<string, unknown>[],
  freshHits: Record<string, unknown>[],
  options: BuildStateOptions = {},
) {
  const staleCarried = allHits.length - freshHits.length;
  const regime = (scanResult?.regime as Record<string, unknown> | undefined) ?? null;
  const elapsedSec = Number(scanResult?.elapsed_sec ?? 0);
  const scanned = Number(scanResult?.scanned ?? scanResult?.incremental_refreshed ?? 0);
  const sla =
    scanResult?.sla && typeof scanResult.sla === 'object'
      ? scanResult.sla
      : evaluateScanSla(String(scanResult?.scan_mode ?? ''), elapsedSec, scanned);

  return {
    engine_version: String(scanResult?.engine_version ?? ''),
    scan_mode: String(scanResult?.scan_mode ?? ''),
    universe_size: Number(scanResult?.universe_size ?? scanResult?.scanned ?? 0),
    scanned: Number(scanResult?.scanned ?? 0),
    total_hits_raw: allHits.length,
    fresh_hits: freshHits.length,
    stale_carried: staleCarried,
    incremental_refreshed: Number(scanResult?.incremental_refreshed ?? 0),
    incremental_carried: Number(scanResult?.incremental_carried ?? staleCarried),
    tiers_source: options.includeCarried ? 'all_hits_including_stale' : 'fresh_hits_only',
    filter_stats: scanResult?.filter_stats ?? null,
    elapsed_sec: elapsedSec,
    scan_elapsed_sec: Number(scanResult?.scan_elapsed_sec ?? elapsedSec),
    sla,
    backtest_truth_preload: options.backtestAttached ?? 0,
    backtest_method: 'walk_forward_3y',
    regime_blocks_strict_enter: Boolean(regime?.blocks_strict_enter),
    regime_key: String(regime?.key ?? regime?.label ?? ''),
    accuracy_note:
      `Default tiers exclude stale incremental hits. Live Add requires strict ENTER + R≥3 + net edge + ROE≥15% & ROCE≥15% (ROE-only for banks/NBFCs/insurance) + proven BT economic edge (expectancy>0, PF≥${MIN_PROFIT_FACTOR_LIVE}, compound≥0, max DD≤${MAX_DRAWDOWN_LIVE_PCT}%). Soft WR floor ${MIN_PROFITABLE_WIN_RATE_PCT}% is diagnostic only. Toggle research_add=1 for SETUP journal only. BT 3y grades top 40 hits by rank.`,
    hourly_on_scan: scanResult?.hourly_on_scan === true || scanResult?.include_hourly === true,
    min_profitable_win_rate_pct: MIN_PROFITABLE_WIN_RATE_PCT,
    min_profit_factor_live: MIN_PROFIT_FACTOR_LIVE,
    max_drawdown_live_pct: MAX_DRAWDOWN_LIVE_PCT,
    primary_gate: 'economic_edge',
  };
}

export function buildState(
  scanResult: Record<string, unknown> | null,
  openPositions: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
  options: BuildStateOptions = {},
) {
  const allHits = Array.isArray(scanResult?.hits) ? (scanResult!.hits as Record<string, unknown>[]) : [];
  const freshHits = actionableScanHits(allHits);
  const staleCarried = allHits.length - freshHits.length;
  const hitsForTiers = options.includeCarried ? allHits : freshHits;
  let tiers = categorizeHits(hitsForTiers, regime, false);
  const positionsBlock = buildPositionsBlock(openPositions, allHits, regime);
  tiers = overlayOpenPositionsOnTiers(tiers, positionsBlock.open) as typeof tiers;

  const scan = scanResult
    ? {
        ...scanResult,
        hit_count: options.includeCarried ? allHits.length : freshHits.length,
        fresh_hit_count: freshHits.length,
        incremental_carried: Number(scanResult.incremental_carried ?? staleCarried),
        universe_size: Number(scanResult.universe_size ?? scanResult.scanned ?? 0),
      }
    : { hits: [], hit_count: 0, fresh_hit_count: 0, scanned: 0, incremental_carried: 0 };

  const transparency = buildScanTransparency(scanResult, allHits, freshHits, options);
  const guidance = regimeGuidance(regime);
  const serialize = (h: Record<string, unknown>) =>
    serializeHit(h, regime, {
      deploy_pct: guidance.deploy_pct,
      portfolio_nav: options.portfolioNav,
    });

  return {
    ok: true,
    profile: profile(),
    regime: regime ?? null,
    guidance,
    scan,
    transparency,
    tiers: {
      high_conviction: tiers.high_conviction.map(serialize),
      strict_enter: tiers.strict_enter.map(serialize),
      setup_radar: tiers.setup_radar.map(serialize),
      breakout_surge: tiers.breakout_surge.map(serialize),
      compounder_sleeve: tiers.compounder_sleeve.map(serialize),
    },
    positions: positionsBlock,
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

  const researchAdd = Boolean(input.research_add);
  const gateHit: Record<string, unknown> = {
    symbol,
    already_held: false,
    incremental_stale: Boolean(input.incremental_stale),
    decision_action: String(input.decision_action ?? 'BUY'),
    strict_verdict: String(input.strict_verdict ?? input.strict ?? ''),
    strict_enter_ready: input.strict_enter_ready,
    r_multiple_ok: input.r_multiple_ok,
    net_edge_ok: input.net_edge_ok,
    backtest_truth: input.backtest_truth ?? null,
  };

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

  if (!researchAdd) {
    const liveReasons = liveAddGateReasons(gateHit);
    if (liveReasons.length > 0) {
      return {
        ok: false,
        error: `Ch.93 live gate blocked: ${liveReasons.join(' · ')}.`,
        add_block_reasons: liveReasons,
        requires_strict_enter: true,
      };
    }
  } else if (String(input.decision_action ?? '') === ACTION_SKIP) {
    return { ok: false, error: 'Research add blocked — decision is SKIP.', research_add: true };
  }

  const guidance = regimeGuidance(regime);
  const deployPct = num(input.deploy_pct) ?? guidance.deploy_pct;
  const portfolioNav = num(input.portfolio_nav) ?? DEFAULT_PORTFOLIO_NAV;
  const shares =
    num(input.shares) ??
    suggestedSharesForHit(
      {
        price: entryPrice,
        stop_loss: stopLoss,
        deploy_scale: input.deploy_scale,
        dynamic: input.dynamic,
      },
      regime,
      { deploy_pct: deployPct, portfolio_nav: portfolioNav },
    );

  const gate = canOpenPosition(openPositions, entryPrice, stopLoss, portfolioNav, shares, {
    sector: resolvePositionSector({
      symbol,
      sector: input.sector ?? input.sector_key,
    }),
  });
  const suggested = suggestedSharesForHit(
    { price: entryPrice, stop_loss: stopLoss, deploy_scale: input.deploy_scale, dynamic: input.dynamic },
    regime,
    { deploy_pct: deployPct, portfolio_nav: portfolioNav },
  );
  const newRiskPct =
    gate.ok && entryPrice > stopLoss
      ? (((entryPrice - stopLoss) * shares) / portfolioNav) * 100
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
    sector: gate.sector,
    sector_pct: gate.sector_pct,
    sector_after_pct: gate.sector_after_pct,
    max_heat: 4.0,
    research_add: researchAdd,
    deploy_pct: deployPct,
    portfolio_nav: portfolioNav,
  };
}

export function suggestedSharesForHit(
  hit: Record<string, unknown>,
  regime?: Record<string, unknown> | null,
  options: { deploy_pct?: number; portfolio_nav?: number } = {},
): number {
  const entry = Number(hit.price ?? 0);
  let stop = Number(hit.stop_loss ?? 0);
  if (entry <= 0) return 0;
  if (stop <= 0 || stop >= entry) stop = Math.round(entry * 0.95 * 100) / 100;
  const nav = options.portfolio_nav ?? DEFAULT_PORTFOLIO_NAV;
  const base = suggestedShares(entry, stop, nav);
  const scale =
    num(hit.deploy_scale) ??
    navDeployScaleForEntry(regime, (hit.dynamic as Record<string, unknown> | undefined) ?? null);
  const deployPct = (options.deploy_pct ?? regimeGuidance(regime).deploy_pct) / 100;
  const sized = Math.floor(base * Math.max(0.1, scale) * Math.max(0.1, deployPct));
  return Math.max(1, sized);
}

function findHitMatch(hits: Record<string, unknown>[], symbol: string, regime?: Record<string, unknown> | null) {
  const sym = symbol.toUpperCase();
  const raw = hits.find((h) => String(h.symbol ?? '').toUpperCase() === sym);
  return raw ? enrichHit(raw, regime) : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function failedRuleIds(hit: Record<string, unknown>): string[] {
  const rules = (hit.entry_rules ?? hit.rules ?? []) as Array<{ id?: string; passed?: boolean | null }>;
  return rules.filter((r) => r.passed === false).map((r) => String(r.id ?? '')).filter(Boolean);
}

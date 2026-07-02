import { VOLUME_SURGE_MIN } from './dynamic-signals.js';
import { strictFloor } from './entry-scorer.js';
import { MIN_LIQUIDITY_CR } from './ranker.js';

export const ACTION_STRONG_BUY = 'STRONG_BUY';
export const ACTION_BUY = 'BUY';
export const ACTION_WATCH = 'WATCH';
export const ACTION_SKIP = 'SKIP';

export const POS_EXIT = 'EXIT_NOW';
export const POS_CUT = 'CUT_LOSS';
export const POS_TIGHTEN = 'TIGHTEN_STOP';
export const POS_TRIM = 'TRIM_PROFIT';
export const POS_HOLD = 'HOLD';
export const POS_REVIEW = 'REVIEW';
export const POS_TRAIL = 'TRAIL_ACTIVE';

const RSI_CHASE = 72.0;
const PCT_52W_EXTENDED = 88.0;
const STOP_NEAR_PCT = 2.0;
const TRAIL_NEAR_PCT = 1.5;
const CUT_LOSS_PCT = -4.0;
const TRIM_GAIN_PCT = 8.0;

export function enrichHit(hit: Record<string, unknown>, regime?: Record<string, unknown> | null): Record<string, unknown> {
  const flags = riskFlags(hit, regime);
  const score = decisionScore(hit, regime, flags);
  const action = entryAction(hit, score, flags, regime);
  return {
    ...hit,
    decision_score: score,
    decision_action: action,
    decision_label: actionLabel(action),
    risk_flags: flags,
    high_conviction: isHighConviction(hit, score, action, flags),
  };
}

export function categorizeHits(
  hits: Record<string, unknown>[],
  regime?: Record<string, unknown> | null,
  _attachBacktest = true,
) {
  const enriched = hits.map((hit) => enrichHit(hit, regime));
  const highConviction: Record<string, unknown>[] = [];
  const strict: Record<string, unknown>[] = [];
  const setup: Record<string, unknown>[] = [];
  const breakout: Record<string, unknown>[] = [];

  for (const hit of enriched) {
    if (hit.high_conviction) highConviction.push(hit);
    if (String(hit.strict_verdict ?? '') === 'ENTER') strict.push(hit);
    const discovery = String(hit.verdict ?? '');
    if (['ENTER', 'SETUP'].includes(discovery)) setup.push(hit);
    const volRatio = Number(hit.ta_volume_ratio ?? 0);
    if (hit.broke_swing_high && volRatio >= VOLUME_SURGE_MIN) breakout.push(hit);
  }

  const sort = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    Number(b.decision_score ?? 0) - Number(a.decision_score ?? 0) ||
    Number(b.swing_rank ?? 0) - Number(a.swing_rank ?? 0);

  highConviction.sort(sort);
  strict.sort(sort);
  setup.sort(sort);
  breakout.sort(sort);

  return { high_conviction: highConviction, strict_enter: strict, setup_radar: setup, breakout_surge: breakout };
}

export function overlayOpenPositionsOnTiers(
  tiers: Record<string, Record<string, unknown>[]>,
  positionRows: Record<string, unknown>[],
) {
  const held: Record<string, Record<string, unknown>> = {};
  for (const row of positionRows) {
    const sym = String(row.symbol ?? '').toUpperCase();
    if (sym) held[sym] = row;
  }
  if (Object.keys(held).length === 0) return tiers;

  const mgmtActions = [POS_TIGHTEN, POS_CUT, POS_EXIT];
  const out: Record<string, Record<string, unknown>[]> = { ...tiers };

  for (const [tierKey, hits] of Object.entries(tiers)) {
    const next: Record<string, unknown>[] = [];
    for (const hit of hits) {
      const sym = String(hit.symbol ?? '').toUpperCase();
      if (!held[sym]) {
        next.push(hit);
        continue;
      }
      const pos = held[sym];
      const posAction = String(pos.position_action ?? POS_REVIEW);
      const stopDist = num(pos.stop_distance_pct);
      const nearStop = stopDist !== null && stopDist <= STOP_NEAR_PCT;
      const needsMgmt = nearStop || mgmtActions.includes(posAction);

      if (tierKey === 'high_conviction') continue;

      const updated: Record<string, unknown> = { ...hit, already_held: true, add_allowed: false };
      updated.held_position_action = posAction;
      updated.held_action_label = pos.action_label ?? '';
      updated.held_stop_distance_pct = stopDist;
      updated.held_near_stop = nearStop;
      if (needsMgmt) {
        updated.decision_action = ACTION_WATCH;
        updated.decision_label = `Held · ${pos.action_label ?? 'manage stop'}`;
        updated.high_conviction = false;
      }
      next.push(updated);
    }
    out[tierKey] = next;
  }
  return out;
}

export function riskFlags(hit: Record<string, unknown>, regime?: Record<string, unknown> | null): string[] {
  const flags: string[] = [];
  if (hit.stale) flags.push('STALE_DATA');

  const rsi = num(hit.ta_rsi14);
  if (rsi !== null && rsi > RSI_CHASE) flags.push('RSI_CHASE');

  const pct52 = num(hit.ta_pct_52w);
  if (pct52 !== null && pct52 > PCT_52W_EXTENDED) flags.push('EXTENDED_52W');

  const zone = String(hit.ta_52w_chart_zone ?? '');
  if (zone === 'red' && regime?.bear) flags.push('RED_ZONE_BEAR');

  if (hit.r_multiple_ok !== true) flags.push('LOW_R');

  const liq = num(hit.ta_avg_value_cr) ?? 0;
  if (liq > 0 && liq < MIN_LIQUIDITY_CR) flags.push('LOW_LIQUIDITY');

  if (regime?.blocks_strict_enter && String(hit.strict_verdict ?? '') !== 'ENTER') {
    flags.push('BEAR_NO_STRICT');
  }

  const entryScore = Number(hit.entry_score ?? 0);
  const floor = strictFloor(regime);
  if (entryScore > 0 && entryScore < floor - 5) flags.push('SCORE_BELOW_FLOOR');

  if (regime?.high_vol && !hit.volume_surge) flags.push('HIGH_VOL_NO_SURGE');

  return flags;
}

export function decisionScore(hit: Record<string, unknown>, regime: Record<string, unknown> | null | undefined, flags: string[]): number {
  let score = Math.round(Number(hit.swing_rank ?? 0) * 0.55);

  if (String(hit.strict_verdict ?? '') === 'ENTER') score += 22;
  else if (String(hit.verdict ?? '') === 'ENTER') score += 14;
  else if (String(hit.verdict ?? '') === 'SETUP') score += 8;

  if (hit.strict_enter_ready) score += 10;
  if (hit.r_multiple_ok === true) score += 10;

  const entryScore = Number(hit.entry_score ?? 0);
  if (entryScore >= 85) score += 8;
  else if (entryScore >= strictFloor(regime)) score += 5;

  const liq = num(hit.ta_avg_value_cr) ?? 0;
  if (liq >= 25) score += 6;
  else if (liq >= MIN_LIQUIDITY_CR) score += 3;

  if (hit.volume_surge && hit.broke_swing_high) score += 6;
  else if (hit.volume_surge) score += 3;

  const zone = String(hit.ta_52w_chart_zone ?? '');
  if (regime?.bear && zone === 'green') score += 5;
  else if (regime?.bull && zone === 'red' && hit.broke_swing_high) score += 4;

  const penalties: Record<string, number> = {
    STALE_DATA: 18,
    RSI_CHASE: 12,
    EXTENDED_52W: 10,
    RED_ZONE_BEAR: 12,
    LOW_R: 14,
    LOW_LIQUIDITY: 8,
    SCORE_BELOW_FLOOR: 10,
    HIGH_VOL_NO_SURGE: 6,
    BEAR_NO_STRICT: 5,
  };
  for (const flag of flags) score -= penalties[flag] ?? 4;

  return Math.max(0, Math.min(100, score));
}

export function entryAction(
  hit: Record<string, unknown>,
  score: number,
  flags: string[],
  regime?: Record<string, unknown> | null,
): string {
  const blockers = ['STALE_DATA', 'LOW_R', 'RSI_CHASE', 'EXTENDED_52W'];
  for (const b of blockers) {
    if (flags.includes(b) && score < 70) return ACTION_SKIP;
  }

  if (regime?.blocks_strict_enter && String(hit.strict_verdict ?? '') !== 'ENTER') {
    return score >= 58 ? ACTION_WATCH : ACTION_SKIP;
  }

  const strict = String(hit.strict_verdict ?? '') === 'ENTER';
  const rOk = hit.r_multiple_ok === true;

  if (score >= 78 && strict && rOk && !flags.includes('STALE_DATA')) return ACTION_STRONG_BUY;
  if (score >= 65 && (strict || String(hit.verdict ?? '') === 'ENTER')) return ACTION_BUY;
  if (score >= 50 && ['ENTER', 'SETUP'].includes(String(hit.verdict ?? ''))) return ACTION_WATCH;
  return ACTION_SKIP;
}

export function isHighConviction(
  hit: Record<string, unknown>,
  score: number,
  action: string,
  flags: string[],
): boolean {
  if (action === ACTION_STRONG_BUY) return true;
  if (action !== ACTION_BUY || score < 72) return false;
  if (String(hit.strict_verdict ?? '') !== 'ENTER') return false;
  if (flags.includes('STALE_DATA') || flags.includes('LOW_R')) return false;
  return hit.r_multiple_ok === true;
}

export function evaluatePositionAction(
  row: Record<string, unknown>,
  hitMatch?: Record<string, unknown> | null,
  regime?: Record<string, unknown> | null,
) {
  void regime;
  const reasons: string[] = [];
  const exitV = String(row.exit_verdict ?? 'HOLD');
  const gain = num(row.gain_pct);
  const sessions = Number(row.sessions_held ?? 0);
  const entry = Number((row.position as Record<string, unknown> | undefined)?.entry_price ?? row.entry_price ?? 0);
  const price = num(row.current_price);
  const activeStop =
    num(row.effective_stop) ?? num(row.active_stop);
  const trailArmed = Boolean(row.trail_armed);
  const trailStop = num(row.trail_stop);

  if (exitV === 'EXIT') {
    const triggers = Array.isArray(row.exit_triggers) ? row.exit_triggers : [];
    reasons.push(triggers.length > 0 ? triggers.join(', ') : 'Exit rules triggered');
    return positionResult(POS_EXIT, reasons, entry, price, activeStop);
  }

  let stopDist: number | null = null;
  if (price !== null && price > 0 && activeStop !== null && activeStop > 0) {
    stopDist = Math.round(((price - activeStop) / price) * 10000) / 100;
    if (stopDist <= STOP_NEAR_PCT) {
      reasons.push(`Price within ${STOP_NEAR_PCT}% of active stop`);
    }
  }

  if (gain !== null && gain <= CUT_LOSS_PCT && sessions >= 2) {
    reasons.push(`Loss beyond ${Math.abs(CUT_LOSS_PCT)}% — cut regardless of scan tier`);
    return positionResult(POS_CUT, reasons, entry, price, activeStop);
  }

  if (stopDist !== null && stopDist <= TRAIL_NEAR_PCT && trailArmed) {
    reasons.push(
      `Price within ${TRAIL_NEAR_PCT}% of trailing stop (₹${(trailStop ?? activeStop ?? 0).toFixed(2)})`,
    );
    return positionResult(POS_TIGHTEN, reasons, entry, price, activeStop);
  }

  if (stopDist !== null && stopDist <= STOP_NEAR_PCT) {
    reasons.push(`Protect capital — price within ${STOP_NEAR_PCT}% of active stop`);
    return positionResult(POS_TIGHTEN, reasons, entry, price, activeStop);
  }

  if (gain !== null && gain >= TRIM_GAIN_PCT && row.chop_regime) {
    reasons.push('Chop regime — lock partial gains');
    return positionResult(POS_TRIM, reasons, entry, price, activeStop);
  }

  if (
    gain !== null &&
    gain >= TRIM_GAIN_PCT &&
    hitMatch &&
    String(hitMatch.decision_action ?? '') === ACTION_SKIP
  ) {
    reasons.push('Setup degraded in latest scan — consider trimming');
    return positionResult(POS_TRIM, reasons, entry, price, activeStop);
  }

  if (
    hitMatch?.high_conviction &&
    exitV === 'HOLD' &&
    (stopDist === null || stopDist > STOP_NEAR_PCT)
  ) {
    reasons.push('Still high conviction in live scan — hold unless stop threatened');
    return positionResult(POS_HOLD, reasons, entry, price, activeStop);
  }

  if (exitV === 'HOLD' && trailArmed && gain !== null && gain > 0) {
    const hw = num(row.high_water);
    const trailPct = num(row.trail_from_high_pct);
    let msg = 'Trail armed';
    if (trailStop !== null) msg += ` at ₹${trailStop.toFixed(2)}`;
    if (hw !== null && trailPct !== null) msg += ` (−${trailPct}% from high ₹${hw.toFixed(2)})`;
    msg += ' — let winner run';
    reasons.push(msg);
    return positionResult(POS_TRAIL, reasons, entry, price, activeStop);
  }

  if (exitV === 'HOLD' && gain !== null && gain > 0) {
    reasons.push('Trend intact — trail stop active');
    return positionResult(POS_HOLD, reasons, entry, price, activeStop);
  }

  if (sessions >= 12 && gain !== null && gain < 3.0) {
    reasons.push('Time stop — stagnant trade');
    return positionResult(POS_REVIEW, reasons, entry, price, activeStop);
  }

  reasons.push('Monitor exit rules');
  return positionResult(POS_REVIEW, reasons, entry, price, activeStop);
}

export function regimeGuidance(regime?: Record<string, unknown> | null) {
  if (!regime) {
    return {
      tone: 'neutral',
      title: 'Regime unknown',
      message: 'Use strict ENTER + high conviction tier only until NIFTYBEES regime loads.',
      deploy_pct: 100,
    };
  }
  if (regime.blocks_strict_enter) {
    return {
      tone: 'danger',
      title: 'Strong bear — capital preservation',
      message: 'Strict ENTER blocked. Favor green-zone pullbacks only; cut losers fast; max 50% deploy.',
      deploy_pct: 50,
    };
  }
  if (regime.bear) {
    return {
      tone: 'warning',
      title: 'Bear overlay — selective entries',
      message: 'Trade strict ENTER + Tier A only. Avoid red-zone chase. Tighten stops on open positions.',
      deploy_pct: 70,
    };
  }
  if (regime.sideways) {
    return {
      tone: 'warning',
      title: 'Chop / sideways — smaller size',
      message: 'Favor high-conviction only; tighten time stops on open trades.',
      deploy_pct: 80,
    };
  }
  return {
    tone: 'success',
    title: 'Bull / risk-on overlay',
    message: 'Full deploy on strict ENTER + high conviction. Trail winners per X6.',
    deploy_pct: 100,
  };
}

function positionResult(
  action: string,
  reasons: string[],
  entry: number,
  price: number | null,
  activeStop: number | null,
) {
  let rUnrealized: number | null = null;
  if (entry > 0 && price !== null && activeStop !== null && activeStop > 0 && activeStop < entry) {
    const risk = entry - activeStop;
    if (risk > 0) rUnrealized = Math.round(((price - entry) / risk) * 100) / 100;
  }
  let stopDist: number | null = null;
  if (price !== null && price > 0 && activeStop !== null && activeStop > 0) {
    stopDist = Math.round(((price - activeStop) / price) * 10000) / 100;
  }
  return {
    action,
    label: positionActionLabel(action),
    reasons,
    stop_distance_pct: stopDist,
    r_unrealized: rUnrealized,
  };
}

function positionActionLabel(action: string): string {
  const labels: Record<string, string> = {
    [POS_EXIT]: 'Exit now',
    [POS_CUT]: 'Cut loss',
    [POS_TIGHTEN]: 'Tighten stop',
    [POS_TRIM]: 'Trim profit',
    [POS_HOLD]: 'Hold',
    [POS_REVIEW]: 'Review',
    [POS_TRAIL]: 'Trail active',
  };
  return labels[action] ?? action;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    [ACTION_STRONG_BUY]: 'Strong buy',
    [ACTION_BUY]: 'Buy',
    [ACTION_WATCH]: 'Watch',
    [ACTION_SKIP]: 'Skip',
  };
  return labels[action] ?? action;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

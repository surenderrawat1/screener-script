import type { OhlcBar, TaMetrics } from './types.js';
import { ema, volumeSurgeRatio } from './ta-helper.js';

export const MOMENTUM_STRONG = 'strong';
export const MOMENTUM_WEAK = 'weak';
export const MOMENTUM_NEUTRAL = 'neutral';
export const VOLUME_SURGE_MIN = 1.08;
export const VOLUME_DRY_MAX = 0.7;
export const EMA9_STOP_BUFFER_PCT = 0.5;
export const MOMENTUM_TARGET_BOOST = 1.12;

const DEFAULT_STOP_LOSS_PCT = 5.0;
const ATR_STOP_MULTIPLIER = 1.2;
const SMA50_STOP_BUFFER_PCT = 1.0;
const EMA21_STOP_BUFFER_PCT = 1.0;
const TARGET_RR_RATIO = 3.0;
const MIN_TARGET_PCT = 6.0;
const MAX_TARGET_PCT = 24.0;
const MIN_CHARGE_AWARE_TARGET_PCT = 4.0;

export function goldenCrossActive(ta: TaMetrics): boolean {
  return Boolean(ta.ta_golden_cross_9_50 || ta.ta_golden_cross_50_200 || ta.ta_bull_ma_stack);
}

export function hourlyEmaBias(hourlyBars: OhlcBar[] | null | undefined, price: number) {
  if (!hourlyBars || hourlyBars.length < 30) {
    return { ready: false, bull: null as boolean | null, ema9: null as number | null, ema21: null as number | null };
  }
  const closes = hourlyBars.map((b) => b.close);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  if (e9 === null || e21 === null) {
    return { ready: false, bull: null, ema9: null, ema21: null };
  }
  return { ready: true, bull: price >= e21 && e9 > e21, ema9: e9, ema21: e21 };
}

export function analyzeDynamic(
  ta: TaMetrics,
  price: number,
  dailyBars?: OhlcBar[] | null,
  hourlyBars?: OhlcBar[] | null,
) {
  const ema9 = num(ta.ta_ema9);
  const ema21 = num(ta.ta_ema21);
  const ema50 = num(ta.ta_ema50);
  const sma50 = num(ta.ta_sma50);
  const macdHist = num(ta.ta_macd_hist);
  const rsi = num(ta.ta_rsi14);
  const atrPct = num(ta.ta_atr_pct);

  let volRatio = num(ta.ta_volume_ratio);
  if (volRatio === null && dailyBars?.length) volRatio = volumeSurgeRatio(dailyBars);

  const golden = goldenCrossActive(ta);
  const gc9 = Boolean(ta.ta_golden_cross_9_50);
  const dailyBull =
    ema9 !== null && ema21 !== null && ema50 !== null && ema9 > ema21 && ema21 > ema50 && price >= ema21;
  const hourly = hourlyEmaBias(hourlyBars, price);
  const momentum = classifyMomentum(ta, price, volRatio, golden, dailyBull, hourly);
  const score = momentumScore(momentum, macdHist, rsi, volRatio, golden, dailyBull, hourly, gc9);

  let hardPct = DEFAULT_STOP_LOSS_PCT;
  if (atrPct !== null && atrPct > 0) hardPct = Math.min(hardPct, ATR_STOP_MULTIPLIER * atrPct);
  const hardStop = price > 0 ? Math.round(price * (1 - hardPct / 100) * 100) / 100 : null;

  const stopPack = dynamicStop(price, sma50, ema9, ema21, hardStop, momentum, hourly);
  const targetPack = dynamicTarget(price, stopPack.dynamic_stop, ema50, momentum, golden, volRatio);

  return {
    momentum,
    momentum_score: score,
    volume_ratio: volRatio,
    volume_surge: volRatio !== null && volRatio >= VOLUME_SURGE_MIN,
    volume_dry: volRatio !== null && volRatio <= VOLUME_DRY_MAX,
    golden_cross_active: golden,
    gc9_active: gc9,
    daily_ema_bull: dailyBull,
    hourly_ema_bull: hourly.bull,
    hourly_ready: hourly.ready,
    hourly_ema9: hourly.ema9,
    hourly_ema21: hourly.ema21,
    dynamic_stop: stopPack.dynamic_stop,
    dynamic_stop_pct: stopPack.dynamic_stop_pct,
    stop_reason: stopPack.stop_reason,
    dynamic_target: targetPack.dynamic_target,
    dynamic_target_pct: targetPack.dynamic_target_pct,
    target_reason: targetPack.target_reason,
    entry_ok: momentum !== MOMENTUM_WEAK && dailyBull && hourly.bull !== false,
    entry_strict_ok:
      momentum === MOMENTUM_STRONG ||
      (momentum === MOMENTUM_NEUTRAL && (golden || (volRatio !== null && volRatio >= VOLUME_SURGE_MIN))),
    exit_momentum_weak: momentum === MOMENTUM_WEAK,
    ema9_trail: ema9TrailLevel(price, ema9, momentum),
  };
}

function classifyMomentum(
  ta: TaMetrics,
  price: number,
  volRatio: number | null,
  golden: boolean,
  dailyBull: boolean,
  hourly: ReturnType<typeof hourlyEmaBias>,
): string {
  const macdHist = num(ta.ta_macd_hist);
  const ema21 = num(ta.ta_ema21);
  const bearStack = Boolean(ta.ta_ema_bear_stack);
  const weak =
    bearStack ||
    (ema21 !== null && price < ema21) ||
    (macdHist !== null && macdHist < 0 && Boolean(ta.ta_death_cross_9_50)) ||
    (hourly.ready && hourly.bull === false && macdHist !== null && macdHist < 0);
  if (weak) return MOMENTUM_WEAK;
  const strong =
    dailyBull &&
    (macdHist === null || macdHist >= 0) &&
    (volRatio === null || volRatio >= VOLUME_SURGE_MIN || golden) &&
    hourly.bull !== false;
  return strong ? MOMENTUM_STRONG : MOMENTUM_NEUTRAL;
}

function momentumScore(
  momentum: string,
  macdHist: number | null,
  rsi: number | null,
  volRatio: number | null,
  golden: boolean,
  dailyBull: boolean,
  hourly: ReturnType<typeof hourlyEmaBias>,
  gc9: boolean,
): number {
  let score = momentum === MOMENTUM_STRONG ? 40 : momentum === MOMENTUM_NEUTRAL ? 10 : -40;
  if (dailyBull) score += 20;
  if (golden) score += 15;
  if (gc9) score += 8;
  if (macdHist !== null && macdHist >= 0) score += 10;
  if (volRatio !== null && volRatio >= VOLUME_SURGE_MIN) score += 10;
  if (hourly.ready && hourly.bull === true) score += 15;
  else if (hourly.ready && hourly.bull === false) score -= 20;
  if (rsi !== null && rsi >= 45 && rsi <= 60) score += 5;
  return Math.max(-100, Math.min(100, score));
}

function dynamicStop(
  price: number,
  sma50: number | null,
  ema9: number | null,
  ema21: number | null,
  hardStop: number | null,
  momentum: string,
  hourly: ReturnType<typeof hourlyEmaBias>,
) {
  if (price <= 0 || hardStop === null) {
    return { dynamic_stop: null as number | null, dynamic_stop_pct: null as number | null, stop_reason: 'invalid price' };
  }
  const candidates: Record<string, number> = { hard: hardStop };
  if (sma50 !== null && sma50 > 0) candidates.sma50 = Math.round(sma50 * (1 - SMA50_STOP_BUFFER_PCT / 100) * 100) / 100;
  if (ema21 !== null && ema21 > 0) candidates.ema21 = Math.round(ema21 * (1 - EMA21_STOP_BUFFER_PCT / 100) * 100) / 100;
  if (ema9 !== null && ema9 > 0 && momentum === MOMENTUM_STRONG) {
    candidates.ema9 = Math.round(ema9 * (1 - EMA9_STOP_BUFFER_PCT / 100) * 100) / 100;
  }
  if (hourly.ready && hourly.ema21 !== null && hourly.bull === true) {
    candidates.h_ema21 = Math.round(hourly.ema21 * 0.995 * 100) / 100;
  }
  const valid = Object.entries(candidates).filter(([, v]) => v > 0 && v < price);
  if (valid.length === 0) {
    return { dynamic_stop: hardStop, dynamic_stop_pct: Math.round(((price - hardStop) / price) * 10000) / 100, stop_reason: 'hard % stop' };
  }
  const best = Math.max(...valid.map(([, v]) => v));
  const reason = valid.find(([, v]) => v === best)?.[0] ?? 'structural';
  const labels: Record<string, string> = {
    hard: 'ATR/hard % stop',
    sma50: 'below SMA-50 buffer',
    ema21: 'below daily EMA-21',
    ema9: 'below daily EMA-9 (strong momentum)',
    h_ema21: 'below hourly EMA-21',
  };
  return {
    dynamic_stop: best,
    dynamic_stop_pct: Math.round(((price - best) / price) * 10000) / 100,
    stop_reason: labels[reason] ?? 'structural EMA stop',
  };
}

function dynamicTarget(
  price: number,
  dynamicStop: number | null,
  ema50: number | null,
  momentum: string,
  golden: boolean,
  volRatio: number | null,
) {
  if (price <= 0 || dynamicStop === null || dynamicStop >= price) {
    return { dynamic_target: Math.round(price * (1 + MIN_TARGET_PCT / 100) * 100) / 100, dynamic_target_pct: MIN_TARGET_PCT, target_reason: 'fallback min target' };
  }
  const risk = price - dynamicStop;
  const riskPct = (risk / price) * 100;
  let rawTargetPct = riskPct * TARGET_RR_RATIO;
  let reason = `${TARGET_RR_RATIO}R from ${riskPct.toFixed(2)}% risk`;
  if (momentum === MOMENTUM_STRONG && (golden || (volRatio !== null && volRatio >= VOLUME_SURGE_MIN))) {
    rawTargetPct *= MOMENTUM_TARGET_BOOST;
    reason += ' + momentum/golden extension';
  }
  if (ema50 !== null && ema50 > price && golden) {
    const emaStretch = ((ema50 - price) / price) * 100 + 3.0;
    if (emaStretch > rawTargetPct) {
      rawTargetPct = Math.min(emaStretch, MAX_TARGET_PCT);
      reason += ' toward EMA-50 zone';
    }
  }
  const targetPct = Math.min(Math.max(rawTargetPct, MIN_TARGET_PCT, MIN_CHARGE_AWARE_TARGET_PCT), MAX_TARGET_PCT);
  return {
    dynamic_target: Math.round(price * (1 + targetPct / 100) * 100) / 100,
    dynamic_target_pct: Math.round(targetPct * 100) / 100,
    target_reason: reason,
  };
}

function ema9TrailLevel(price: number, ema9: number | null, momentum: string): number | null {
  if (ema9 === null || ema9 <= 0 || momentum !== MOMENTUM_STRONG) return null;
  const trail = Math.round(ema9 * (1 - EMA9_STOP_BUFFER_PCT / 100) * 100) / 100;
  return trail > 0 && trail < price ? trail : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
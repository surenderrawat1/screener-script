import type { OhlcBar, SwingRule, TaMetrics } from './types.js';
import { atrPct14 } from './ta-helper.js';
import { fromTa } from './gc9-dc9.js';
import { analyzeDynamic, MOMENTUM_WEAK } from './dynamic-signals.js';
import { priceActionMetrics } from './price-action.js';
import { entry52wBand } from './market-regime.js';
import { MIN_BUY, MIN_WATCHLIST, scoreEntry, strictFloor } from './entry-scorer.js';

export const ENGINE_VERSION = 'v3.9-gc9';
export const MIN_BARS_FOR_ENTER = 200;

const TARGET_RR_RATIO = 3.0;
const DEFAULT_STOP_LOSS_PCT = 5.0;
const MIN_TARGET_PCT = 6.0;
const MAX_TARGET_PCT = 24.0;
const MIN_CHARGE_AWARE_TARGET_PCT = 4.0;
const MIN_R_MULTIPLE = 3.0;
const MIN_EFFECTIVE_RISK_PCT = 2.75;
const ATR_STOP_MULTIPLIER = 1.2;
const SMA50_STOP_BUFFER_PCT = 1.0;
const EMA21_STOP_BUFFER_PCT = 1.0;
const ESTIMATED_ROUND_TRIP_CHARGE_PCT = 1.25;
const MIN_NET_EDGE_PCT = 4.0;

const ENTRY_MIN_PCT_52W = 32.0;
const ENTRY_MAX_PCT_52W = 68.0;
const ENTRY_RSI_PULLBACK_MIN = 42.0;
const ENTRY_RSI_PULLBACK_MAX = 54.0;
const ENTRY_RSI_MAX = 65.0;
const ENTRY_BB_PCT_B_MAX = 85.0;
const ENTRY_SMA50_PROXIMITY_PCT = 2.5;
const ENTRY_EMA21_PROXIMITY_PCT = 2.5;
const ENTRY_EMA21_MAX_EXTENSION_PCT = 4.5;
const MIN_AVG_DAILY_VALUE_CR = 8.0;
const MIN_AVG_DAILY_VALUE_CR_STRICT = 12.0;
const DISCOVERY_MIN_ENTRY_RULES = 6;
const DISCOVERY_SETUP_MIN_RULES = 5;
const DISCOVERY_MIN_DYNAMIC_SCORE = 45;
const DISCOVERY_MIN_VOLUME_RATIO = 1.1;

export function evaluateEntry(
  ta: TaMetrics,
  price: number,
  bars?: OhlcBar[] | null,
  regime?: Record<string, unknown> | null,
  hourlyBars?: OhlcBar[] | null,
) {
  const sma50 = num(ta.ta_sma50);
  const sma200 = num(ta.ta_sma200);
  const ema9 = num(ta.ta_ema9);
  const ema21 = num(ta.ta_ema21);
  const ema50 = num(ta.ta_ema50);
  const ema200 = num(ta.ta_ema200);
  const rsi = num(ta.ta_rsi14);
  const pct52 = num(ta.ta_pct_52w);
  const bbPct = num(ta.ta_bb_pct_b);
  const macdHist = num(ta.ta_macd_hist);
  const avgValueCr = num(ta.ta_avg_value_cr);
  let atrPct = num(ta.ta_atr_pct);
  if (atrPct === null && bars?.length) atrPct = atrPct14(bars);
  const barCount = Number(ta.ta_bar_count ?? 0);

  const rules: SwingRule[] = [];

  const trendOk =
    price > 0 &&
    sma50 !== null &&
    sma200 !== null &&
    sma50 > 0 &&
    sma200 > 0 &&
    barCount >= MIN_BARS_FOR_ENTER &&
    price >= sma50 &&
    sma50 >= sma200;
  rules.push(
    rule('E1', 'Trend alignment', 'Price ≥ SMA-50 ≥ SMA-200 (200+ daily bars)', trendOk, trendOk ? 'Uptrend structure supports long swing.' : barCount < MIN_BARS_FOR_ENTER ? 'Insufficient history for SMA-200 — wait for more data.' : 'No long swing — price below SMA-50 or MAs misaligned.'),
  );

  const nearSma50 = sma50 !== null && sma50 > 0 && Math.abs(price - sma50) / sma50 * 100 <= ENTRY_SMA50_PROXIMITY_PCT;
  const nearEma21 = ema21 !== null && ema21 > 0 && Math.abs(price - ema21) / ema21 * 100 <= ENTRY_EMA21_PROXIMITY_PCT;
  const rsiPullback = rsi !== null && rsi >= ENTRY_RSI_PULLBACK_MIN && rsi <= ENTRY_RSI_PULLBACK_MAX;
  const pullbackOk = nearSma50 || nearEma21 || rsiPullback;
  rules.push(rule('E2', 'Pullback zone', `RSI ${ENTRY_RSI_PULLBACK_MIN}–${ENTRY_RSI_PULLBACK_MAX} or price within ${ENTRY_SMA50_PROXIMITY_PCT}% of SMA-50 / EMA-21`, pullbackOk, pullbackOk ? (nearEma21 ? 'Price hugging EMA-21 support.' : nearSma50 ? 'Price hugging SMA-50 support.' : 'RSI in pullback band.') : 'Wait for pullback — extended short-term move.'));

  const momentumOk = macdHist !== null && macdHist >= 0;
  const momentumStrong = macdHist !== null && macdHist >= 0;
  rules.push(rule('E3', 'Momentum (MACD)', 'Histogram ≥ 0 or turning up vs prior session', momentumOk, momentumStrong ? 'MACD histogram positive — momentum confirmed.' : momentumOk ? 'MACD turning up — early momentum.' : 'MACD not confirming — wait.'));

  const band = regime ? entry52wBand(regime) : { min: ENTRY_MIN_PCT_52W, max: ENTRY_MAX_PCT_52W };
  const rangeOk = pct52 !== null && pct52 >= band.min && pct52 <= band.max;
  rules.push(rule('E4', '52-week band', `${band.min}–${band.max}% of 252-session range`, rangeOk, rangeOk ? 'Mid-range — not chasing 52w high.' : pct52 !== null && pct52 > band.max ? 'Too close to 52w high — chase risk.' : 'Too close to 52w low — trend may be broken.'));

  const extOk = (rsi === null || rsi < ENTRY_RSI_MAX) && (bbPct === null || bbPct < ENTRY_BB_PCT_B_MAX);
  rules.push(rule('E5', 'Not overextended', `RSI < ${ENTRY_RSI_MAX} and BB %B < ${ENTRY_BB_PCT_B_MAX}`, extOk, extOk ? 'No short-term exhaustion signal.' : 'Overbought / upper band — defer entry.'));

  const liquidityOk = avgValueCr !== null && avgValueCr >= MIN_AVG_DAILY_VALUE_CR;
  rules.push(rule('E6', 'Liquidity', `Avg daily value ≥ ₹${MIN_AVG_DAILY_VALUE_CR} cr (20 sessions)`, liquidityOk, liquidityOk ? `₹${avgValueCr?.toFixed(1)} cr avg daily value — liquid enough.` : avgValueCr !== null ? `₹${avgValueCr.toFixed(1)} cr avg — thin; reduce size or skip.` : 'Volume data missing — verify turnover on NSE before order.'));

  const emaStackOk = ema9 !== null && ema21 !== null && ema50 !== null && ema9 > ema21 && ema21 > ema50;
  const emaTrendOk = price > 0 && ema50 !== null && ema200 !== null && ema50 > 0 && ema200 > 0 && barCount >= MIN_BARS_FOR_ENTER && price >= ema50 && ema50 >= ema200;
  const emaOk = emaTrendOk && emaStackOk;
  rules.push(rule('E7', 'EMA trend & stack', 'Price ≥ EMA-50 ≥ EMA-200 and EMA-9 > EMA-21 > EMA-50', emaOk, emaOk ? 'EMA structure confirms swing momentum.' : !emaTrendOk ? 'EMA primary trend not aligned — wait for EMA-50/200 stack.' : 'Short EMA stack not bullish — defer entry.'));

  const pa = bars?.length ? priceActionMetrics(bars) : priceActionMetrics([]);
  const paHasData = Boolean(pa.has_data);
  const paEntry = Boolean(pa.entry_signal);
  const paPassed = paHasData ? paEntry : null;
  rules.push(rule('E8', 'Price action', 'Higher low + (higher high OR bullish reversal / support rejection candle)', paPassed, paEntry ? 'Price action confirms long swing entry.' : String(pa.structure_detail)));

  const dynamic = analyzeDynamic(ta, price, bars, hourlyBars);
  const dynamicEntryOk = Boolean(dynamic.entry_ok);
  const dynamicScore = Number(dynamic.momentum_score ?? 0);
  const dynamicVolumeOk = Boolean(dynamic.gc9_active || dynamic.golden_cross_active || dynamic.volume_surge || (Number(dynamic.volume_ratio ?? 0) >= DISCOVERY_MIN_VOLUME_RATIO));
  rules.push(rule('E9', 'Dynamic momentum', 'Daily EMA stack; block weak momentum / bearish hourly EMA', dynamicEntryOk, dynamicEntryOk ? `Logical entry — ${dynamic.momentum}${dynamic.gc9_active ? ' + GC9' : ''}${dynamic.golden_cross_active ? ' + golden cross' : ''}${dynamic.volume_surge ? ' + volume surge' : ''}. Stop: ${dynamic.stop_reason}.` : dynamic.momentum === MOMENTUM_WEAK ? 'Momentum weak — defer entry until EMA/MACD/volume align.' : dynamic.hourly_ema_bull === false ? 'Hourly EMA bearish — wait for intraday confirmation.' : 'Dynamic gate not met — check EMA stack and volume.'));

  const emaExtensionPct = ema21 !== null && ema21 > 0 && price > ema21 ? ((price - ema21) / ema21) * 100 : 0;
  const emaExtensionOk = nearEma21 || nearSma50 || emaExtensionPct <= ENTRY_EMA21_MAX_EXTENSION_PCT || Boolean(dynamic.gc9_active || dynamic.golden_cross_active || dynamic.volume_surge);
  rules.push(rule('E10', 'EMA-21 extension guard', `≤${ENTRY_EMA21_MAX_EXTENSION_PCT}% above EMA-21 unless GC9 / golden cross / volume surge`, emaExtensionOk, emaExtensionOk ? 'Within extension limits or momentum confirmed.' : `Chasing +${emaExtensionPct.toFixed(1)}% above EMA-21 — wait for pullback.`));

  const gc9State = fromTa(ta, price);
  const gc9Entry = Boolean(gc9State.gc9_entry);
  const gc9Structure = Boolean(gc9State.entry_ok);
  rules.push(rule('E11', 'GC9 entry', 'Daily SMA-9 > SMA-50 · fresh GC9 cross · price holds above SMA-9', gc9Entry ? true : gc9Structure ? null : false, gc9Entry ? gc9State.message : gc9Structure ? 'Bullish SMA-9/50 — wait for GC9 cross or clearer trigger.' : gc9State.message));

  const passed = rules.filter((r) => r.passed === true).length;
  const scored = rules.filter((r) => r.passed !== null).length;

  const plan = computeTradePlan(price, sma50, ema21, atrPct, dynamic);
  const stop = plan.effective_stop;
  const target = plan.profit_target;
  const rMultiple = plan.r_multiple;
  const targetPct = plan.target_pct ?? 0;
  const rOk = Boolean(plan.r_multiple_ok);

  const e1 = rules[0].passed === true;
  const e6 = rules[5].passed === true;
  const e7 = rules[6].passed === true;
  const liqStrictOk = avgValueCr !== null && avgValueCr >= MIN_AVG_DAILY_VALUE_CR_STRICT;
  const netEdgeOk = netEdgeOkFn(targetPct);

  const entryDraft = {
    rules,
    rules_passed: passed,
    r_multiple_ok: rOk,
    r_multiple: rMultiple ?? undefined,
    price_action: pa,
  };
  const entryScore = scoreEntry(entryDraft, ta, regime);

  const aboveEma21 = ema21 !== null && ema21 > 0 && price >= ema21;
  const rsiInBand = rsi !== null && rsi >= ENTRY_RSI_PULLBACK_MIN && rsi <= ENTRY_RSI_PULLBACK_MAX;
  const verdicts = resolveVerdicts(passed, e1, e7, e6, momentumOk, momentumStrong, aboveEma21, nearEma21, nearSma50, pullbackOk, rsiInBand, rOk, paHasData, paEntry, pa, entryScore, regime, liqStrictOk, netEdgeOk, targetPct, dynamicEntryOk, dynamicScore, dynamicVolumeOk, emaExtensionOk, gc9Entry, gc9Structure);

  return {
    engine_version: ENGINE_VERSION,
    verdict: verdicts.strict,
    discovery_verdict: verdicts.discovery,
    strict_verdict: verdicts.strict,
    strict_enter_ready: verdicts.strict_enter_ready,
    entry_score: entryScore.total,
    entry_score_detail: entryScore,
    rules_passed: passed,
    rules_scored: scored,
    rules,
    entry_price: Math.round(price * 100) / 100,
    stop_loss: stop,
    profit_target: target,
    r_multiple: rMultiple,
    r_multiple_ok: rOk,
    target_pct: targetPct,
    price_action: pa,
    dynamic,
    gc9: gc9State,
    regime,
    net_edge_ok: netEdgeOk,
    liquidity_strict: liqStrictOk,
  };
}

function rule(id: string, name: string, criterion: string, passed: boolean | null, detail: string): SwingRule {
  return { id, name, criterion, passed, detail };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function netEdgeOkFn(targetPct: number): boolean {
  return targetPct - ESTIMATED_ROUND_TRIP_CHARGE_PCT >= MIN_NET_EDGE_PCT;
}

export function computeStopLevels(price: number, sma50: number | null, ema21: number | null, atrPct: number | null, dynamic?: Record<string, unknown>) {
  if (price <= 0) return { hard_stop: null, structural_stop: null, effective_stop: null, effective_stop_pct: null };
  let hardPct = DEFAULT_STOP_LOSS_PCT;
  if (atrPct !== null && atrPct > 0) hardPct = Math.min(hardPct, ATR_STOP_MULTIPLIER * atrPct);
  const hardStop = Math.round(price * (1 - hardPct / 100) * 100) / 100;
  let structural = sma50 !== null && sma50 > 0 ? Math.round(sma50 * (1 - SMA50_STOP_BUFFER_PCT / 100) * 100) / 100 : null;
  const emaStructural = ema21 !== null && ema21 > 0 ? Math.round(ema21 * (1 - EMA21_STOP_BUFFER_PCT / 100) * 100) / 100 : null;
  if (emaStructural !== null && (structural === null || emaStructural > structural)) structural = emaStructural;
  let effective = hardStop;
  if (structural !== null && structural > hardStop) effective = structural;
  const dynStop = dynamic?.momentum === 'strong' ? num(dynamic.dynamic_stop) : null;
  if (dynStop !== null && dynStop > effective && dynStop < price) {
    effective = dynStop;
    structural = dynStop;
  }
  const maxTightStop = price * (1 - MIN_EFFECTIVE_RISK_PCT / 100);
  if (effective > maxTightStop) effective = Math.round(maxTightStop * 100) / 100;
  const effectivePct = price > effective ? Math.round(((price - effective) / price) * 10000) / 100 : DEFAULT_STOP_LOSS_PCT;
  return { hard_stop: hardStop, structural_stop: structural, effective_stop: effective, effective_stop_pct: effectivePct };
}

export function computeTradePlan(entryPrice: number, sma50: number | null, ema21: number | null, atrPct: number | null, dynamic?: Record<string, unknown>) {
  const stops = computeStopLevels(entryPrice, sma50, ema21, atrPct, dynamic);
  const effective = stops.effective_stop;
  const base = { ...stops, risk_pct: null as number | null, profit_target: null as number | null, target_pct: null as number | null, r_multiple: null as number | null, r_multiple_ok: false };
  if (entryPrice <= 0 || effective === null || effective >= entryPrice) {
    const floorPct = Math.max(MIN_TARGET_PCT, MIN_CHARGE_AWARE_TARGET_PCT);
    return { ...base, profit_target: Math.round(entryPrice * (1 + floorPct / 100) * 100) / 100, target_pct: floorPct, risk_pct: DEFAULT_STOP_LOSS_PCT };
  }
  const risk = entryPrice - effective;
  const riskPct = Math.round((risk / entryPrice) * 10000) / 100;
  let targetPct = Math.max(riskPct * TARGET_RR_RATIO, MIN_TARGET_PCT, MIN_CHARGE_AWARE_TARGET_PCT);
  targetPct = Math.min(targetPct, MAX_TARGET_PCT);
  const target = Math.round(entryPrice * (1 + targetPct / 100) * 100) / 100;
  const rMultiple = risk > 0 ? Math.round(((target - entryPrice) / risk) * 100) / 100 : null;
  return { ...base, risk_pct: riskPct, profit_target: target, target_pct: targetPct, r_multiple: rMultiple, r_multiple_ok: rMultiple !== null && rMultiple >= MIN_R_MULTIPLE };
}

function resolveVerdicts(
  passed: number,
  e1: boolean,
  e7: boolean,
  e6: boolean,
  momentumOk: boolean,
  momentumStrong: boolean,
  aboveEma21: boolean,
  nearEma21: boolean,
  nearSma50: boolean,
  pullbackOk: boolean,
  rsiInBand: boolean,
  rOk: boolean,
  paHasData: boolean,
  paEntry: boolean,
  pa: Record<string, unknown>,
  entryScore: { total: number },
  regime?: Record<string, unknown> | null,
  liqStrictOk = false,
  netEdgeOk = false,
  _targetPct = 0,
  dynamicEntryOk = false,
  dynamicScore = 0,
  dynamicVolumeOk = false,
  emaExtensionOk = true,
  gc9Entry = false,
  _gc9Structure = false,
) {
  const score = entryScore.total;
  const floor = strictFloor(regime);
  const regimeBlocks = Boolean(regime?.blocks_strict_enter);
  const paSoft = !paHasData || paEntry || Boolean(pa.higher_low || pa.bullish_candle || pa.support_rejection);
  const strictQuality = momentumStrong && aboveEma21 && (nearEma21 || nearSma50) && (rsiInBand || nearEma21 || nearSma50) && (!paHasData || paEntry);
  const paMandatory = !paHasData || paEntry;
  const scoreEnter = score >= floor && e1 && e6 && liqStrictOk && paMandatory && rOk && netEdgeOk && !regimeBlocks;
  const gc9Quality = gc9Entry && e1 && e6 && momentumOk && aboveEma21 && rOk && netEdgeOk && paSoft;

  let strict = 'AVOID';
  if (scoreEnter && e7 && (strictQuality || gc9Quality)) strict = 'ENTER';
  else if (score >= MIN_WATCHLIST && e1) strict = 'WATCH';
  else if (passed >= 4 && e1) strict = 'WATCH';

  const strictEnterReady = score >= floor && e1 && e6 && liqStrictOk && paMandatory && rOk && netEdgeOk && e7 && (strictQuality || gc9Quality);

  const discoveryQuality = momentumOk && (aboveEma21 || nearSma50) && (nearEma21 || nearSma50 || pullbackOk) && paSoft && rOk && e6 && dynamicEntryOk && dynamicScore >= DISCOVERY_MIN_DYNAMIC_SCORE && dynamicVolumeOk && emaExtensionOk;
  const gc9Discovery = gc9Entry && e1 && e7 && momentumOk && rOk && e6 && dynamicEntryOk && netEdgeOk && emaExtensionOk;

  let discovery = 'AVOID';
  if (score >= MIN_BUY && e1 && e7 && (discoveryQuality || gc9Discovery) && netEdgeOk && !regimeBlocks) discovery = 'ENTER';
  else if (passed >= DISCOVERY_MIN_ENTRY_RULES && e1 && e7 && (discoveryQuality || gc9Discovery)) discovery = 'ENTER';
  else if (score >= MIN_WATCHLIST && passed >= DISCOVERY_SETUP_MIN_RULES && e1 && (e7 || momentumOk) && (pullbackOk || rsiInBand || nearEma21 || nearSma50)) discovery = 'SETUP';
  else if (passed >= 4 && e1) discovery = 'WATCH';

  return { strict, discovery, strict_enter_ready: strictEnterReady };
}

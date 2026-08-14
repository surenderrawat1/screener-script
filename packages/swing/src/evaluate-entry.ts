import type { OhlcBar, SwingRule, TaMetrics } from './types.js';
import { atrPct14, priorMacdHistogram } from './ta-helper.js';
import { fromTa } from './gc9-dc9.js';
import { fromTa as sma20FromTa } from './sma20-stratzy.js';
import { analyzeDynamic, MOMENTUM_STRONG, MOMENTUM_WEAK } from './dynamic-signals.js';
import { priceActionMetrics } from './price-action.js';
import { entry52wBand } from './market-regime.js';
import { MIN_BUY, MIN_WATCHLIST, scoreEntry, strictFloor } from './entry-scorer.js';
import { summarizeHardSoftRules } from './entry-rule-tiers.js';

/** v3.16 — high-vol strict quality (hard≥7 + tape) + longer post-stop cooldown. */
export const ENGINE_VERSION = 'v3.18-real-fill-edge';
export const MIN_BARS_FOR_ENTER = 200;

export const TARGET_RR_RATIO = 3.0;
const DEFAULT_STOP_LOSS_PCT = 5.0;
/** Absolute minimum profit target from entry (%). */
export const MIN_TARGET_PCT = 7.0;
/** Absolute maximum profit target from entry (%). */
export const MAX_TARGET_PCT = 25.0;
const MIN_CHARGE_AWARE_TARGET_PCT = 4.0;
export const MIN_R_MULTIPLE = 3.0;
export const CHOP_NAV_DEPLOY_SCALE = 1.0;
export const BEAR_NAV_DEPLOY_SCALE = 0.8;
export const BULL_NAV_DEPLOY_SCALE = 1.8;
export const BULL_STRONG_MIN_DYNAMIC_SCORE = 50;
export const DISCOVERY_CHOP_MAX_RET60_PCT = 3.0;
export const DEFAULT_ENTRY_TIME_STOP_DAYS = 15;
const MIN_EFFECTIVE_RISK_PCT = 2.75;
const ATR_STOP_MULTIPLIER = 1.2;
/** ATR% / regime.high_vol — BSE/INDIGO-style chop needs stricter ENTER. */
export const HIGH_VOL_ATR_PCT = 2.5;
export const HIGH_VOL_MIN_HARD_PASSED = 7;
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
const DISCOVERY_MIN_ENTRY_RULES = 5;
const DISCOVERY_SETUP_MIN_RULES = 4;
/** Soft quality boost — no longer a hard discovery veto. */
const DISCOVERY_SOFT_DYNAMIC_SCORE = 40;
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

  const prevMacdHist =
    bars?.length && bars.length >= 2
      ? priorMacdHistogram(bars.map((b) => b.close))
      : null;
  const momentumOk =
    macdHist !== null && (macdHist >= 0 || (prevMacdHist !== null && macdHist > prevMacdHist));
  const momentumStrong = macdHist !== null && macdHist >= 0;
  rules.push(
    rule(
      'E3',
      'Momentum (MACD)',
      'Histogram ≥ 0 or turning up vs prior session',
      momentumOk,
      momentumStrong
        ? 'MACD histogram positive — momentum confirmed.'
        : momentumOk
          ? 'MACD turning up — early momentum.'
          : 'MACD not confirming — wait.',
    ),
  );

  const band = regime ? entry52wBand(regime) : { min: ENTRY_MIN_PCT_52W, max: ENTRY_MAX_PCT_52W };
  const regimeTag = regime?.bear ? ' (Bear)' : regime?.bull ? ' (Bull)' : regime?.sideways ? ' (Sideways)' : '';
  const rangeOk = pct52 !== null && pct52 >= band.min && pct52 <= band.max;
  rules.push(rule('E4', '52-week band', `${band.min}–${band.max}% of 252-session range${regimeTag}`, rangeOk, rangeOk ? 'Mid-range — not chasing 52w high.' : pct52 !== null && pct52 > band.max ? 'Too close to 52w high — chase risk.' : 'Too close to 52w low — trend may be broken.'));

  const extOk = (rsi === null || rsi < ENTRY_RSI_MAX) && (bbPct === null || bbPct < ENTRY_BB_PCT_B_MAX);
  rules.push(rule('E5', 'Not overextended', `RSI < ${ENTRY_RSI_MAX} and BB %B < ${ENTRY_BB_PCT_B_MAX}`, extOk, extOk ? 'No short-term exhaustion signal.' : 'Overbought / upper band — defer entry.'));

  const liquidityOk = avgValueCr !== null && avgValueCr >= MIN_AVG_DAILY_VALUE_CR;
  rules.push(rule('E6', 'Liquidity', `Avg daily value ≥ ₹${MIN_AVG_DAILY_VALUE_CR} cr (20 sessions)`, liquidityOk, liquidityOk ? `₹${avgValueCr?.toFixed(1)} cr avg daily value — liquid enough.` : avgValueCr !== null ? `₹${avgValueCr.toFixed(1)} cr avg — thin; reduce size or skip.` : 'Volume data missing — verify turnover on NSE before order.'));

  // E7: primary EMA trend only (short stack is confirmatory, not a hard veto — reduces E1∩E7 over-rule).
  const emaStackOk = ema9 !== null && ema21 !== null && ema50 !== null && ema9 > ema21 && ema21 > ema50;
  const emaTrendOk =
    price > 0 &&
    ema50 !== null &&
    ema200 !== null &&
    ema50 > 0 &&
    ema200 > 0 &&
    barCount >= MIN_BARS_FOR_ENTER &&
    price >= ema50 &&
    ema50 >= ema200;
  const emaOk = emaTrendOk;
  rules.push(
    rule(
      'E7',
      'EMA primary trend',
      'Price ≥ EMA-50 ≥ EMA-200 (short EMA stack confirmatory)',
      emaOk,
      emaOk
        ? emaStackOk
          ? 'EMA primary trend + short stack aligned.'
          : 'EMA primary trend OK — short stack still rebuilding (common on pullbacks).'
        : barCount < MIN_BARS_FOR_ENTER
          ? 'Insufficient history for EMA-200.'
          : 'EMA primary trend not aligned — wait for EMA-50/200.',
    ),
  );

  const pa = bars?.length ? priceActionMetrics(bars) : priceActionMetrics([]);
  const paHasData = Boolean(pa.has_data);
  const paEntry = Boolean(pa.entry_signal);
  const paPassed = paHasData ? paEntry : null;
  rules.push(rule('E8', 'Price action', 'Higher low + (higher high OR bullish reversal / support rejection candle)', paPassed, paEntry ? 'Price action confirms long swing entry.' : String(pa.structure_detail)));

  const dynamic = analyzeDynamic(ta, price, bars, hourlyBars);
  const dynamicEntryOk = Boolean(dynamic.entry_ok);
  const dynamicScore = Number(dynamic.momentum_score ?? 0);
  const dynamicVolumeOk = Boolean(
    dynamic.gc9_active ||
      dynamic.golden_cross_active ||
      dynamic.volume_surge ||
      Number(dynamic.volume_ratio ?? 0) >= DISCOVERY_MIN_VOLUME_RATIO,
  );
  // E9: soft — hard-fail only on weak momentum outside a pullback zone (E2).
  // Brief dips under EMA-21 during RSI/SMA50 pullbacks are advisory (null), not vetoes.
  const e9Passed = dynamicEntryOk
    ? true
    : dynamic.momentum === MOMENTUM_WEAK && !pullbackOk
      ? false
      : null;
  rules.push(
    rule(
      'E9',
      'Dynamic momentum',
      'Soft gate — hard-fail only on weak momentum outside pullback zone; hourly EMA advisory',
      e9Passed,
      dynamicEntryOk
        ? `Logical entry — ${dynamic.momentum}${dynamic.gc9_active ? ' + GC9' : ''}${dynamic.golden_cross_active ? ' + golden cross' : ''}${dynamic.volume_surge ? ' + volume surge' : ''}. Stop: ${dynamic.stop_reason}.`
        : dynamic.momentum === MOMENTUM_WEAK && pullbackOk
          ? 'Momentum soft during pullback (e.g. price under EMA-21) — advisory while E2 holds.'
          : dynamic.momentum === MOMENTUM_WEAK
            ? 'Momentum weak — defer until EMA/MACD/volume align.'
            : dynamic.hourly_ema_bull === false
              ? 'Hourly EMA bearish — advisory; daily thesis may still stand.'
              : 'Dynamic confirmation incomplete — advisory, not a hard veto.',
    ),
  );

  const emaExtensionPct = ema21 !== null && ema21 > 0 && price > ema21 ? ((price - ema21) / ema21) * 100 : 0;
  const emaExtensionOk =
    nearEma21 ||
    nearSma50 ||
    pullbackOk ||
    emaExtensionPct <= ENTRY_EMA21_MAX_EXTENSION_PCT ||
    Boolean(dynamic.gc9_active || dynamic.golden_cross_active || dynamic.volume_surge);
  // E10 soft when E2 already confirms pullback (same economic idea).
  const e10Passed = emaExtensionOk ? true : pullbackOk ? null : false;
  rules.push(
    rule(
      'E10',
      'EMA-21 extension guard',
      `≤${ENTRY_EMA21_MAX_EXTENSION_PCT}% above EMA-21 unless in pullback / GC9 / volume surge`,
      e10Passed,
      emaExtensionOk
        ? 'Within extension limits or pullback/momentum confirmed.'
        : pullbackOk
          ? 'Extension elevated but E2 pullback zone already OK — soft hold.'
          : `Chasing +${emaExtensionPct.toFixed(1)}% above EMA-21 — wait for pullback.`,
    ),
  );

  const gc9State = fromTa(ta, price);
  const gc9Entry = Boolean(gc9State.gc9_entry);
  const gc9Structure = Boolean(gc9State.entry_ok);
  rules.push(
    rule(
      'E11',
      'GC9 entry',
      'Optional catalyst — fresh GC9 · price above SMA-9 (structure soft)',
      gc9Entry ? true : gc9Structure ? null : false,
      gc9Entry ? gc9State.message : gc9Structure ? 'Bullish SMA-9/50 — wait for GC9 cross or clearer trigger.' : gc9State.message,
    ),
  );

  // E12: style rule — soft when structure holds; hard only on clear below-SMA-20. Strategy require_rules=[E12] needs entry_ok.
  const sma20State = sma20FromTa(ta, price);
  const sma20Entry = Boolean(sma20State.entry_ok);
  const sma20Structure = Boolean(sma20State.structure_ok);
  rules.push(
    rule(
      'E12',
      '20 MA Stratzy',
      'Style filter — soft above SMA-20; hard pass on ≤2.5% pullback (use require_rules for Stratzy scans)',
      sma20Entry ? true : sma20Structure ? null : false,
      sma20Entry
        ? sma20State.message
        : sma20Structure
          ? 'Above SMA-20 — soft OK; Stratzy hard entry waits for pullback to 20 DMA.'
          : sma20State.message,
    ),
  );

  const passed = rules.filter((r) => r.passed === true).length;
  const scored = rules.filter((r) => r.passed !== null).length;
  const hardSoft = summarizeHardSoftRules(rules);

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
  const volumeSurge = Boolean(dynamic.volume_surge);
  const brokeSwingHigh = Boolean(pa.broke_swing_high);
  const verdicts = resolveVerdicts(
    passed,
    e1,
    e7,
    e6,
    momentumOk,
    momentumStrong,
    aboveEma21,
    nearEma21,
    nearSma50,
    pullbackOk,
    rsiInBand,
    rOk,
    paHasData,
    paEntry,
    pa,
    entryScore,
    regime,
    liqStrictOk,
    netEdgeOk,
    targetPct,
    dynamicEntryOk,
    dynamicScore,
    dynamicVolumeOk,
    emaExtensionOk,
    gc9Entry,
    gc9Structure,
    hardSoft.hard_passed,
    atrPct,
    volumeSurge,
    brokeSwingHigh,
  );

  const highVolEntry =
    Boolean(regime?.high_vol) || (atrPct !== null && atrPct >= HIGH_VOL_ATR_PCT);

  return {
    engine_version: ENGINE_VERSION,
    verdict: verdicts.strict,
    discovery_verdict: verdicts.discovery,
    strict_verdict: verdicts.strict,
    strict_enter_ready: verdicts.strict_enter_ready,
    strict_floor: strictFloor(regime),
    entry_score: entryScore.total,
    entry_score_detail: entryScore,
    rules_passed: passed,
    rules_scored: scored,
    rules_hard_passed: hardSoft.hard_passed,
    rules_hard_total: hardSoft.hard_total,
    rules_soft_passed: hardSoft.soft_passed,
    rules_soft_total: hardSoft.soft_total,
    rules,
    entry_price: Math.round(price * 100) / 100,
    stop_loss: stop,
    hard_stop: plan.hard_stop,
    structural_stop: plan.structural_stop,
    stop_pct: plan.effective_stop_pct,
    risk_pct: plan.risk_pct,
    profit_target: target,
    r_multiple: rMultiple,
    r_multiple_ok: rOk,
    min_r_multiple: MIN_R_MULTIPLE,
    target_pct: targetPct,
    time_stop_days: DEFAULT_ENTRY_TIME_STOP_DAYS,
    deploy_scale: navDeployScaleForEntry(regime, dynamic),
    price_action: pa,
    dynamic,
    gc9: gc9State,
    sma20_stratzy: sma20State,
    regime,
    net_edge_ok: netEdgeOk,
    liquidity_strict: liqStrictOk,
    atr_pct: atrPct != null && Number.isFinite(atrPct) ? Math.round(atrPct * 100) / 100 : null,
    high_vol_entry: highVolEntry,
    volume_surge: volumeSurge,
    broke_swing_high: brokeSwingHigh,
  };
}

export function isDiscoveryChopRegime(regime: Record<string, unknown>): boolean {
  const weakNifty = Number(regime.return_20d_pct ?? 0) < 0;
  return Boolean(regime.sideways) || (weakNifty && Number(regime.return_60d_pct ?? 0) < DISCOVERY_CHOP_MAX_RET60_PCT);
}

export function navDeployScaleForEntry(
  regime?: Record<string, unknown> | null,
  dynamic?: Record<string, unknown> | null,
): number {
  if (!regime || Object.keys(regime).length === 0) return 1.0;
  if (isDiscoveryChopRegime(regime)) return CHOP_NAV_DEPLOY_SCALE;
  if (regime.bear) return BEAR_NAV_DEPLOY_SCALE;
  const momentum = String(dynamic?.momentum ?? '');
  const score = Number(dynamic?.momentum_score ?? 0);
  if (
    regime.bull &&
    Number(regime.return_20d_pct ?? 0) > 0 &&
    (momentum === MOMENTUM_STRONG || score >= BULL_STRONG_MIN_DYNAMIC_SCORE)
  ) {
    return BULL_NAV_DEPLOY_SCALE;
  }
  return 1.0;
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
    return {
      ...base,
      profit_target: Math.round(entryPrice * (1 + floorPct / 100) * 100) / 100,
      target_pct: floorPct,
      risk_pct: DEFAULT_STOP_LOSS_PCT,
      target_frozen: true,
    };
  }
  const risk = entryPrice - effective;
  const riskPct = Math.round((risk / entryPrice) * 10000) / 100;
  // Frozen entry target: exact 3R from stop, clamped to the absolute 7–25% band.
  // No momentum/golden boost — target must not drift after the entry fill.
  void dynamic;
  let targetPct = Math.max(riskPct * TARGET_RR_RATIO, MIN_TARGET_PCT, MIN_CHARGE_AWARE_TARGET_PCT);
  const targetCapped = targetPct > MAX_TARGET_PCT;
  targetPct = Math.min(targetPct, MAX_TARGET_PCT);
  targetPct = Math.round(targetPct * 100) / 100;
  const target = Math.round(entryPrice * (1 + targetPct / 100) * 100) / 100;
  const rMultiple = risk > 0 ? Math.round(((target - entryPrice) / risk) * 100) / 100 : null;

  return {
    ...base,
    risk_pct: riskPct,
    profit_target: target,
    target_pct: targetPct,
    r_multiple: rMultiple,
    r_multiple_ok: rMultiple !== null && rMultiple >= MIN_R_MULTIPLE,
    target_capped: targetCapped,
    target_frozen: true,
  };
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
  hardPassed = 0,
  atrPct: number | null = null,
  volumeSurge = false,
  brokeSwingHigh = false,
) {
  const score = entryScore.total;
  const floor = strictFloor(regime);
  const regimeBlocks = Boolean(regime?.blocks_strict_enter);
  const paSoft = !paHasData || paEntry || Boolean(pa.higher_low || pa.bullish_candle || pa.support_rejection);
  const paMandatory = !paHasData || paEntry;
  // Core trend = SMA stack (E1). EMA (E7) confirms but is no longer a second hard veto.
  const coreTrend = e1;
  const trendConfirmed = e1 || e7;

  // Strict quality: one proximity + momentum + PA — do not re-AND the whole E-ladder.
  const strictQuality =
    momentumStrong &&
    aboveEma21 &&
    (nearEma21 || nearSma50 || pullbackOk) &&
    (!paHasData || paEntry);
  const scoreEnter =
    score >= floor && coreTrend && e6 && liqStrictOk && paMandatory && rOk && netEdgeOk && !regimeBlocks;
  const gc9Quality = gc9Entry && coreTrend && e6 && momentumOk && aboveEma21 && rOk && netEdgeOk && paSoft;

  // High-vol names (BSE/INDIGO research): weak hard ladders + no tape → stop churn.
  const highVol =
    Boolean(regime?.high_vol) || (atrPct !== null && Number.isFinite(atrPct) && atrPct >= HIGH_VOL_ATR_PCT);
  const highVolTape = volumeSurge || brokeSwingHigh || dynamicVolumeOk;
  const highVolOk = !highVol || (hardPassed >= HIGH_VOL_MIN_HARD_PASSED && highVolTape);

  let strict = 'AVOID';
  if (scoreEnter && (strictQuality || gc9Quality) && highVolOk) strict = 'ENTER';
  else if (score >= MIN_WATCHLIST && coreTrend) strict = 'WATCH';
  else if (passed >= 4 && coreTrend) strict = 'WATCH';

  const strictEnterReady =
    score >= floor &&
    coreTrend &&
    e6 &&
    liqStrictOk &&
    paMandatory &&
    rOk &&
    netEdgeOk &&
    (strictQuality || gc9Quality) &&
    highVolOk;

  // Discovery: drop dynamicEntryOk / volume as hard vetoes — use as soft boost only.
  const dynamicSoft =
    dynamicEntryOk || dynamicScore >= DISCOVERY_SOFT_DYNAMIC_SCORE || dynamicVolumeOk;
  const discoveryQuality =
    momentumOk &&
    (aboveEma21 || nearSma50) &&
    (nearEma21 || nearSma50 || pullbackOk) &&
    paSoft &&
    rOk &&
    e6 &&
    emaExtensionOk;
  const gc9Discovery = gc9Entry && coreTrend && momentumOk && rOk && e6 && netEdgeOk && emaExtensionOk;

  let discovery = 'AVOID';
  if (
    score >= MIN_BUY &&
    coreTrend &&
    (discoveryQuality || gc9Discovery) &&
    netEdgeOk &&
    !regimeBlocks
  ) {
    discovery = 'ENTER';
  } else if (passed >= DISCOVERY_MIN_ENTRY_RULES && coreTrend && (discoveryQuality || gc9Discovery)) {
    discovery = 'ENTER';
  } else if (
    score >= MIN_WATCHLIST &&
    passed >= DISCOVERY_SETUP_MIN_RULES &&
    trendConfirmed &&
    (pullbackOk || rsiInBand || nearEma21 || nearSma50 || dynamicSoft)
  ) {
    discovery = 'SETUP';
  } else if (passed >= 4 && coreTrend) {
    discovery = 'WATCH';
  }

  return { strict, discovery, strict_enter_ready: strictEnterReady };
}

import type { OhlcBar, SwingRule, TaMetrics } from './types.js';
import { atrPct14 } from './ta-helper.js';
import { analyzeDynamic } from './dynamic-signals.js';
import { priceActionMetrics } from './price-action.js';
import { computeTradePlan, MIN_R_MULTIPLE } from './evaluate-entry.js';

export const DEFAULT_TIME_STOP_DAYS = 15;
export const SIDEWAYS_TIME_STOP_DAYS = 15;
export const DEFAULT_TRAIL_FROM_HIGH_PCT = 2.5;
export const TRAIL_FROM_HIGH_BEAR_PCT = 1.8;
export const TRAIL_FROM_HIGH_HIGH_VOL_PCT = 3.2;
export const DEFAULT_TRAIL_ARM_PCT = 2.0;
export const BREAKEVEN_ARM_PCT = 2.0;
export const BREAKEVEN_BUFFER_PCT = 0.35;
export const TIME_STOP_MIN_PROGRESS_PCT = 1.0;
export const SMA50_EXIT_BUFFER_PCT = 1.5;
export const EXIT_RSI_OVERBOUGHT = 65.0;
export const EXIT_RSI_MIN_GAIN_PCT = 5.0;
export const EXIT_PARTIAL_TARGET_FRACTION = 0.85;
export const EXIT_MACD_MIN_GAIN_PCT = 4.0;
export const EXIT_PA_MIN_GAIN_PCT = 5.0;
export const MIN_TARGET_PCT = 6.0;
export const MAX_TARGET_PCT = 24.0;

export const DEFAULT_STOP_LOSS_PCT = 5.0;

export function exitRuleDefinitions(): string[] {
  return [
    'X1 Stop-loss — dynamic EMA/ATR hard + breakeven trail',
    `X2 Profit target — logical 3R from dynamic stop (+${MIN_TARGET_PCT}–${MAX_TARGET_PCT}% band)`,
    'X3 Trend break — SMA-50 (bear) or EMA-21 + weak momentum',
    `X4 RSI overbought — RSI > ${EXIT_RSI_OVERBOUGHT} with gain ≥ ${Math.round(EXIT_PARTIAL_TARGET_FRACTION * 100)}% of target`,
    `X5 MACD — active when momentum weak + gain ≥ ${EXIT_MACD_MIN_GAIN_PCT}%`,
    'X6 Trailing stop — high % trail or EMA-9 after 50% of target',
    `X7 Time stop — active in sideways (${SIDEWAYS_TIME_STOP_DAYS} sessions); advisory otherwise`,
    `X8 Price action — LH/LL or bearish engulfing with gain ≥ ${EXIT_PA_MIN_GAIN_PCT}%`,
    'X9 Hourly EMA bearish — EMA-9 < EMA-21 with partial gain',
  ];
}

export function exitRuleSummary(): string {
  const partialPct = Math.round(EXIT_PARTIAL_TARGET_FRACTION * 100);
  return (
    `Exit when any active rule triggers: −${DEFAULT_STOP_LOSS_PCT}% hard stop (breakeven lifts after 50% of target) · ` +
    `target = ${MIN_R_MULTIPLE}R frozen at entry (min +${MIN_TARGET_PCT}%) · RSI partial exit only after ${partialPct}% of target · ` +
    'PA X8 · trail. X3/X5/X7 advisory.'
  );
}

export function trailFromHighPct(regime?: Record<string, unknown> | null): number {
  if (regime?.high_vol) return TRAIL_FROM_HIGH_HIGH_VOL_PCT;
  if (regime?.bear) return TRAIL_FROM_HIGH_BEAR_PCT;
  return DEFAULT_TRAIL_FROM_HIGH_PCT;
}

export function computeActiveStop(
  entryPrice: number,
  hardStop: number,
  gainPct: number,
  targetPct: number,
  dynamicStructural: number | null = null,
  ema9Trail: number | null = null,
) {
  let active = hardStop;
  const breakevenArm = Math.max(BREAKEVEN_ARM_PCT, Math.round(targetPct * 0.5 * 100) / 100);
  const breakevenArmed = gainPct >= breakevenArm;
  if (breakevenArmed) {
    const breakeven = Math.round(entryPrice * (1 + BREAKEVEN_BUFFER_PCT / 100) * 100) / 100;
    active = Math.max(active, breakeven);
  }
  if (dynamicStructural !== null && dynamicStructural > active && dynamicStructural < entryPrice) {
    active = dynamicStructural;
  }
  if (ema9Trail !== null && gainPct >= Math.round(targetPct * 0.5 * 100) / 100 && ema9Trail > active) {
    active = ema9Trail;
  }
  return {
    active_stop: Math.round(active * 100) / 100,
    breakeven_armed: breakevenArmed,
    breakeven_arm_pct: breakevenArm,
  };
}

export function computeTrailStop(
  entryPrice: number,
  gainPct: number,
  highWater: number,
  targetPct: number,
  ema9Trail: number | null = null,
  regime?: Record<string, unknown> | null,
  ratchetFloor: number | null = null,
) {
  void entryPrice;
  const trailArmPct = Math.max(DEFAULT_TRAIL_ARM_PCT, Math.round(targetPct * 0.5 * 100) / 100);
  const gainToArm = Math.max(0, Math.round((trailArmPct - gainPct) * 100) / 100);
  const fromHighPct = trailFromHighPct(regime);
  const trailArmed = gainPct >= trailArmPct;

  const fromHigh = trailArmed ? Math.round(highWater * (1 - fromHighPct / 100) * 100) / 100 : null;
  const ema9Component =
    ema9Trail !== null && gainPct >= Math.round(targetPct * 0.5 * 100) / 100 ? ema9Trail : null;

  let trailStop: number | null = fromHigh;
  if (ema9Component !== null) {
    trailStop = trailStop !== null ? Math.max(trailStop, ema9Component) : ema9Component;
  }
  if (ratchetFloor !== null && ratchetFloor > 0) {
    if (trailStop !== null) trailStop = Math.max(trailStop, ratchetFloor);
    else if (trailArmed) trailStop = ratchetFloor;
  }
  if (trailStop !== null && trailStop <= 0) trailStop = null;

  return {
    trail_stop: trailStop,
    trail_armed: trailArmed && trailStop !== null,
    trail_arm_pct: trailArmPct,
    trail_from_high_pct: fromHighPct,
    high_water: Math.round(highWater * 100) / 100,
    gain_to_arm_pct: gainToArm,
    ema9_component: ema9Component,
    from_high_component: fromHigh,
  };
}

export function tradingSessionsHeld(entryDate: string, asOfDate: string, bars?: OhlcBar[] | null): number {
  const entry = entryDate.slice(0, 10);
  const asOf = asOfDate.slice(0, 10);
  if (!entry || !asOf || !bars?.length) return calendarDaysBetween(entry, asOf);

  let sessions = 0;
  for (const bar of bars) {
    const d = String(bar.time ?? '').slice(0, 10);
    if (!d || d < entry) continue;
    if (d > asOf) break;
    sessions++;
  }
  return Math.max(0, sessions - 1);
}

function calendarDaysBetween(entryDate: string, asOfDate: string): number {
  if (!entryDate || !asOfDate) return 0;
  const a = new Date(entryDate);
  const b = new Date(asOfDate);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function evaluateExit(
  ta: TaMetrics & Record<string, unknown>,
  price: number,
  entryPrice: number,
  entryDate: string,
  chart?: Record<string, unknown> | null,
  highestSinceEntry: number | null = null,
  bars?: OhlcBar[] | null,
  paBars?: OhlcBar[] | null,
  frozenTargetPrice: number | null = null,
  frozenTargetPct: number | null = null,
  regime?: Record<string, unknown> | null,
  hourlyBars?: OhlcBar[] | null,
  frozenTrailFloor: number | null = null,
) {
  const sma50 = num(ta.ta_sma50);
  const ema21 = num(ta.ta_ema21);
  const rsi = num(ta.ta_rsi14);
  const macdHist = num(ta.ta_macd_hist);
  const prevHist = previousMacdHistogram(chart);

  let atrPct = num(ta.ta_atr_pct);
  if (atrPct === null && bars?.length) atrPct = atrPct14(bars);

  const dynamic = analyzeDynamic(ta, price, bars, hourlyBars);
  const plan = computeTradePlan(entryPrice, sma50, ema21, atrPct, dynamic);
  const entryStop = Number(plan.effective_stop ?? plan.hard_stop ?? Math.round(entryPrice * 0.95 * 100) / 100);
  const trailStructural = num(dynamic.dynamic_stop);
  const hardStop = entryStop;
  const targetPrice = frozenTargetPrice ?? Number(plan.profit_target ?? entryPrice);
  const targetPct = frozenTargetPct ?? Number(plan.target_pct ?? MIN_TARGET_PCT);
  const gainPct = entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;
  const minPartialGain = Math.max(
    EXIT_RSI_MIN_GAIN_PCT,
    4.0,
    Math.round(targetPct * EXIT_PARTIAL_TARGET_FRACTION * 100) / 100,
  );
  const asOfDate = String(ta.as_of_date ?? new Date().toISOString().slice(0, 10));
  const sessionsHeld = tradingSessionsHeld(entryDate, asOfDate, bars);

  const high = highestSinceEntry ?? Math.max(price, entryPrice);

  const stopMeta = computeActiveStop(
    entryPrice,
    hardStop,
    gainPct,
    targetPct,
    trailStructural,
    num(dynamic.ema9_trail),
  );
  const baseActiveStop = Number(stopMeta.active_stop ?? hardStop);

  const ema9Trail = num(dynamic.ema9_trail);
  const trailMeta = computeTrailStop(entryPrice, gainPct, high, targetPct, ema9Trail, regime, frozenTrailFloor);
  const trailStop = trailMeta.trail_stop;
  let activeStop = baseActiveStop;
  if (trailStop !== null && trailStop > activeStop) activeStop = trailStop;

  const rules: SwingRule[] = [];
  const stopHit = price > 0 && price <= activeStop;
  rules.push(
    rule(
      'X1',
      'Stop-loss',
      trailMeta.trail_armed
        ? `Trail/hard/breakeven floor (₹${activeStop.toFixed(2)})`
        : `−5% hard / breakeven / structural (₹${activeStop.toFixed(2)})`,
      stopHit,
      stopHit
        ? trailMeta.trail_armed
          ? `Trailing or structural stop hit at ₹${activeStop.toFixed(2)} — exit.`
          : stopMeta.breakeven_armed
            ? 'Breakeven or structural stop hit — exit.'
            : 'Hard stop hit — exit immediately.'
        : `Stop not triggered (active ₹${activeStop.toFixed(2)}).`,
    ),
  );

  const targetHit = price >= targetPrice;
  rules.push(
    rule(
      'X2',
      'Profit target',
      `+${targetPct}% (₹${targetPrice.toFixed(2)}) = ${MIN_R_MULTIPLE}R from stop`,
      targetHit,
      targetHit ? 'Target reached — book profits.' : 'Target not yet hit.',
    ),
  );

  const smaTrendBreak = sma50 !== null && sma50 > 0 && price < sma50 * (1 - SMA50_EXIT_BUFFER_PCT / 100);
  const ema21Break = ema21 !== null && ema21 > 0 && price < ema21;
  const momentumWeak = Boolean(dynamic.exit_momentum_weak);
  const bearRegime = Boolean(regime?.bear);
  const trendBreak =
    (bearRegime && smaTrendBreak) || (ema21Break && momentumWeak && gainPct >= EXIT_MACD_MIN_GAIN_PCT);
  rules.push(
    rule(
      'X3',
      'Trend break',
      `${bearRegime || momentumWeak ? 'Active — ' : 'Advisory — '}SMA-50 buffer or daily EMA-21 + weak momentum`,
      trendBreak,
      smaTrendBreak
        ? bearRegime
          ? 'Bear regime SMA-50 break — exit.'
          : 'SMA-50 break flagged — watch hard stop / target.'
        : ema21Break && momentumWeak
          ? 'Daily EMA-21 lost with weak momentum — exit.'
          : 'Above EMA/SMA support.',
    ),
  );

  const rsiExit = rsi !== null && rsi > EXIT_RSI_OVERBOUGHT && gainPct >= minPartialGain;
  rules.push(
    rule(
      'X4',
      'RSI overbought',
      `RSI-14 > ${EXIT_RSI_OVERBOUGHT} with gain ≥ ${minPartialGain}% (${Math.round(EXIT_PARTIAL_TARGET_FRACTION * 100)}% of target)`,
      rsiExit,
      rsiExit ? 'Overbought near target — book gains.' : `RSI exit deferred until ≥ ${minPartialGain}% gain.`,
    ),
  );

  const macdFading = macdHist !== null && macdHist < 0 && (prevHist === null || macdHist < prevHist);
  rules.push(
    rule(
      'X5',
      'MACD momentum loss',
      'Advisory — MACD negative & falling; exit via X3 EMA-21 when momentum weak',
      false,
      macdFading
        ? momentumWeak
          ? 'MACD fading with weak momentum — watch X3 EMA-21 break.'
          : 'MACD fading — hold while EMA stack intact.'
        : 'MACD still supportive or stabilizing.',
    ),
  );

  const trailHit = trailStop !== null && price <= trailStop;
  rules.push(
    rule(
      'X6',
      'Trailing stop',
      trailMeta.trail_armed
        ? `−${trailMeta.trail_from_high_pct}% from high ₹${(trailMeta.high_water ?? high).toFixed(2)} / EMA-9 after +${trailMeta.trail_arm_pct}%`
        : `Arms after +${trailMeta.trail_arm_pct}% gain`,
      trailHit,
      trailHit
        ? `Trailing stop at ₹${trailStop!.toFixed(2)} triggered.`
        : trailMeta.trail_armed
          ? `Trail armed at ₹${trailStop!.toFixed(2)} — not hit.`
          : `Trail not armed until +${(trailMeta.gain_to_arm_pct ?? 0).toFixed(1)}% more gain.`,
    ),
  );

  const sidewaysRegime = Boolean(regime?.sideways);
  const timeStopDays = sidewaysRegime ? SIDEWAYS_TIME_STOP_DAYS : DEFAULT_TIME_STOP_DAYS;
  const timeStopProgress = sidewaysRegime ? 0 : TIME_STOP_MIN_PROGRESS_PCT;
  const timeStopFlat = sessionsHeld >= timeStopDays && gainPct < timeStopProgress;
  const timeStopWeak = momentumWeak || ema21Break;
  const timeStop = sidewaysRegime && timeStopFlat && timeStopWeak;
  rules.push(
    rule(
      'X7',
      'Time stop',
      `${sidewaysRegime ? 'Active in sideways — ' : 'Advisory — '}≥${timeStopDays} sessions flat`,
      timeStop,
      timeStopFlat
        ? sidewaysRegime
          ? timeStopWeak
            ? `Sideways time stop — ${sessionsHeld} sessions without progress and weak EMA/momentum.`
            : 'Sideways flat but EMA/momentum intact — defer time stop.'
          : `Time stop advisory — ${sessionsHeld} sessions without target.`
        : `Within time window (${sessionsHeld} sessions).`,
    ),
  );

  const pa = priceActionMetrics(paBars ?? bars ?? []);
  const paExitFlag = Boolean(pa.has_data && pa.exit_signal);
  const paExit = paExitFlag && gainPct >= Math.max(EXIT_PA_MIN_GAIN_PCT, minPartialGain);
  rules.push(
    rule(
      'X8',
      'Price action exit',
      `LH/LL break or bearish engulfing with gain ≥ ${EXIT_PA_MIN_GAIN_PCT}%`,
      paExit,
      paExit
        ? `Bearish price action — book gains (${pa.structure_detail} ${pa.candle_detail}).`.trim()
        : paExitFlag
          ? `Bearish PA flagged but gain below ${EXIT_PA_MIN_GAIN_PCT}% — hold / watch X1.`
          : 'No bearish price-action breakdown.',
    ),
  );

  const hourlyBear =
    Boolean(dynamic.hourly_ready) &&
    dynamic.hourly_ema_bull === false &&
    gainPct >= minPartialGain;
  rules.push(
    rule(
      'X9',
      'Hourly EMA bearish',
      `Hourly EMA-9 < EMA-21 with gain ≥ ${minPartialGain}%`,
      hourlyBear,
      hourlyBear
        ? 'Intraday EMA flipped bearish — book swing gains.'
        : dynamic.hourly_ready
          ? 'Hourly EMA still supportive or gain below partial threshold.'
          : 'Hourly data unavailable — daily rules only.',
    ),
  );

  const triggered = rules.filter((r) => r.passed === true);
  const verdict = triggered.length > 0 ? 'EXIT' : 'HOLD';

  return {
    verdict,
    rules,
    triggered: triggered.map((r) => r.id),
    entry_price: Math.round(entryPrice * 100) / 100,
    current_price: Math.round(price * 100) / 100,
    gain_pct: Math.round(gainPct * 100) / 100,
    days_held: sessionsHeld,
    sessions_held: sessionsHeld,
    stop_loss: hardStop,
    base_active_stop: baseActiveStop,
    active_stop: Math.round(activeStop * 100) / 100,
    effective_stop: Math.round(activeStop * 100) / 100,
    breakeven_armed: stopMeta.breakeven_armed,
    structural_stop: plan.structural_stop,
    profit_target: targetPrice,
    target_pct: targetPct,
    trail_stop: trailStop,
    trail_armed: trailMeta.trail_armed,
    trail_arm_pct: trailMeta.trail_arm_pct,
    trail_from_high_pct: trailMeta.trail_from_high_pct,
    high_water: trailMeta.high_water ?? high,
    gain_to_arm_trail_pct: trailMeta.gain_to_arm_pct,
    trail_ema9: trailMeta.ema9_component,
    dynamic,
    exit_triggers: triggered.map((r) => r.id),
  };
}

function rule(id: string, name: string, criterion: string, passed: boolean, detail: string): SwingRule {
  return { id, name, criterion, passed, detail };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function previousMacdHistogram(chart?: Record<string, unknown> | null): number | null {
  if (!chart) return null;
  const hist = chart.macd_histogram;
  if (Array.isArray(hist) && hist.length >= 2) {
    const prev = hist[hist.length - 2];
    return typeof prev === 'number' ? prev : null;
  }
  return num(chart.prev_macd_hist);
}

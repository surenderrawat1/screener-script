import type { OhlcBar, SwingRule, TaMetrics } from './types.js';
import { atrPct14 } from './ta-helper.js';
import { analyzeDynamic } from './dynamic-signals.js';
import { priceActionMetrics } from './price-action.js';
import {
  computeTradePlan,
  MAX_TARGET_PCT,
  MIN_R_MULTIPLE,
  MIN_TARGET_PCT,
} from './evaluate-entry.js';

export { MIN_TARGET_PCT, MAX_TARGET_PCT };

export const DEFAULT_TIME_STOP_DAYS = 15;
export const SIDEWAYS_TIME_STOP_DAYS = 15;
export const DEFAULT_TRAIL_FROM_HIGH_PCT = 2.5;
export const TRAIL_FROM_HIGH_BEAR_PCT = 1.8;
export const TRAIL_FROM_HIGH_HIGH_VOL_PCT = 3.2;
/** Wider trail once peak gain reaches 75% of target — lets runners finish toward X2. */
export const TRAIL_FROM_HIGH_RUNNER_PCT = 3.5;
export const DEFAULT_TRAIL_ARM_PCT = 2.5;
/** Peak MFE % that lifts the stop to cost-to-cost (entry + buffer). */
export const BREAKEVEN_ARM_PCT = 1.0;
/** Small cushion above entry so CTC exit is not underwater after typical charges. */
export const BREAKEVEN_BUFFER_PCT = 0.35;
/** After this peak MFE, lock a guaranteed open profit (raises WR + protects expectancy). */
export const PROFIT_LOCK_ARM_PCT = 3.0;
export const PROFIT_LOCK_FLOOR_PCT = 1.5;
/** Scratch dead trades before full SL — never tagged +1% and still clearly red. */
export const SCRATCH_DEAD_SESSIONS = 5;
export const SCRATCH_DEAD_MAX_GAIN_PCT = -0.5;
export const TIME_STOP_MIN_PROGRESS_PCT = 1.0;
export const SMA50_EXIT_BUFFER_PCT = 1.5;
export const EXIT_RSI_OVERBOUGHT = 70.0;
export const EXIT_RSI_MIN_GAIN_PCT = 5.0;
export const EXIT_PARTIAL_TARGET_FRACTION = 0.92;
export const EXIT_MACD_MIN_GAIN_PCT = 4.0;
export const EXIT_PA_MIN_GAIN_PCT = 5.0;

export const DEFAULT_STOP_LOSS_PCT = 5.0;

export function exitRuleDefinitions(): string[] {
  return [
    'X1 Stop-loss — hard/structural; peak +1% → CTC; peak +3% → lock +1.5%',
    `X2 Profit target — frozen ${MIN_R_MULTIPLE}R at entry (+${MIN_TARGET_PCT}–${MAX_TARGET_PCT}% band)`,
    'X3 Trend break — SMA-50 (bear) or EMA-21 + weak momentum',
    `X4 RSI overbought — RSI > ${EXIT_RSI_OVERBOUGHT} with gain ≥ ${Math.round(EXIT_PARTIAL_TARGET_FRACTION * 100)}% of target`,
    `X5 MACD — exit when hist fading + weak momentum + gain ≥ ${EXIT_MACD_MIN_GAIN_PCT}%`,
    `X6 Trailing stop — arms from peak max(+${DEFAULT_TRAIL_ARM_PCT}%, 40% of target); floored at CTC/lock`,
    `X7 Time/scratch — sideways flat OR dead trade (≥${SCRATCH_DEAD_SESSIONS} sessions, peak < +${BREAKEVEN_ARM_PCT}%, gain ≤ ${SCRATCH_DEAD_MAX_GAIN_PCT}%)`,
    `X8 Price action — LH/LL or bearish engulfing with gain ≥ ${EXIT_PA_MIN_GAIN_PCT}%`,
    'X9 Hourly EMA bearish — EMA-9 < EMA-21 with partial gain',
  ];
}

export function exitRuleSummary(): string {
  const partialPct = Math.round(EXIT_PARTIAL_TARGET_FRACTION * 100);
  return (
    `Exit when any active rule triggers: −${DEFAULT_STOP_LOSS_PCT}% hard stop · ` +
    `peak +${BREAKEVEN_ARM_PCT}% → cost-to-cost · peak +${PROFIT_LOCK_ARM_PCT}% → lock +${PROFIT_LOCK_FLOOR_PCT}% · ` +
    `trail from peak +${DEFAULT_TRAIL_ARM_PCT}% · scratch dead trades after ${SCRATCH_DEAD_SESSIONS} sessions · ` +
    `target = ${MIN_R_MULTIPLE}R (+${MIN_TARGET_PCT}–${MAX_TARGET_PCT}%) · RSI partial after ${partialPct}% of target.`
  );
}

export function peakGainPct(entryPrice: number, highWater: number, currentGainPct = 0): number {
  if (!(entryPrice > 0) || !(highWater > 0)) return currentGainPct;
  const peak = ((highWater - entryPrice) / entryPrice) * 100;
  return Math.max(currentGainPct, Math.round(peak * 100) / 100);
}

export function trailFromHighPct(
  regime?: Record<string, unknown> | null,
  peakGain = 0,
  targetPct = MIN_TARGET_PCT,
): number {
  const runnerThreshold = Math.round(targetPct * 0.75 * 100) / 100;
  const runner = peakGain >= runnerThreshold;
  if (regime?.high_vol) return runner ? Math.max(TRAIL_FROM_HIGH_HIGH_VOL_PCT, 4.0) : TRAIL_FROM_HIGH_HIGH_VOL_PCT;
  if (regime?.bear) return runner ? 2.5 : TRAIL_FROM_HIGH_BEAR_PCT;
  return runner ? TRAIL_FROM_HIGH_RUNNER_PCT : DEFAULT_TRAIL_FROM_HIGH_PCT;
}

export function computeActiveStop(
  entryPrice: number,
  hardStop: number,
  gainPct: number,
  targetPct: number,
  dynamicStructural: number | null = null,
  ema9Trail: number | null = null,
  /** Peak/MFE gain — arms breakeven even after pullbacks from the high. */
  peakGain: number | null = null,
) {
  let active = hardStop;
  const armGain = Math.max(gainPct, peakGain ?? gainPct);
  // Cost-to-cost after peak +1% — do NOT wait for 50% of target (that delayed BE ~4%+).
  const breakevenArm = BREAKEVEN_ARM_PCT;
  const halfTarget = Math.round(targetPct * 0.5 * 100) / 100;
  const breakevenArmed = armGain >= breakevenArm;
  if (breakevenArmed) {
    const breakeven = Math.round(entryPrice * (1 + BREAKEVEN_BUFFER_PCT / 100) * 100) / 100;
    active = Math.max(active, breakeven);
  }
  // Profit lock: after peak +3%, floor at +1.5% open profit (WR + expectancy).
  const profitLockArmed = armGain >= PROFIT_LOCK_ARM_PCT;
  if (profitLockArmed) {
    const lockFloor = Math.round(entryPrice * (1 + PROFIT_LOCK_FLOOR_PCT / 100) * 100) / 100;
    active = Math.max(active, lockFloor);
  }
  if (dynamicStructural !== null && dynamicStructural > active && dynamicStructural < entryPrice) {
    active = dynamicStructural;
  }
  if (ema9Trail !== null && armGain >= halfTarget && ema9Trail > active) {
    active = ema9Trail;
  }
  return {
    active_stop: Math.round(active * 100) / 100,
    breakeven_armed: breakevenArmed,
    breakeven_arm_pct: breakevenArm,
    profit_lock_armed: profitLockArmed,
    arm_gain_pct: Math.round(armGain * 100) / 100,
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
  const peak = peakGainPct(entryPrice, highWater, gainPct);
  // Arm earlier than old 50%-of-target (~4%+), but not so early that runners are clipped.
  const trailArmPct = Math.max(DEFAULT_TRAIL_ARM_PCT, Math.round(targetPct * 0.4 * 100) / 100);
  const halfTarget = Math.round(targetPct * 0.5 * 100) / 100;
  const gainToArm = Math.max(0, Math.round((trailArmPct - peak) * 100) / 100);
  const fromHighPct = trailFromHighPct(regime, peak, targetPct);
  // Arm from peak MFE — a pullback after +5% must not disarm the trail.
  const trailArmed = peak >= trailArmPct;

  const fromHigh = trailArmed ? Math.round(highWater * (1 - fromHighPct / 100) * 100) / 100 : null;
  const ema9Component = ema9Trail !== null && peak >= halfTarget ? ema9Trail : null;

  let trailStop: number | null = fromHigh;
  if (ema9Component !== null) {
    trailStop = trailStop !== null ? Math.max(trailStop, ema9Component) : ema9Component;
  }
  if (ratchetFloor !== null && ratchetFloor > 0) {
    if (trailStop !== null) trailStop = Math.max(trailStop, ratchetFloor);
    else if (trailArmed) trailStop = ratchetFloor;
  }
  // Never let an early trail undercut CTC / profit-lock floors (was cutting winners into red).
  if (trailArmed && trailStop !== null && entryPrice > 0) {
    if (peak >= BREAKEVEN_ARM_PCT) {
      const ctc = Math.round(entryPrice * (1 + BREAKEVEN_BUFFER_PCT / 100) * 100) / 100;
      trailStop = Math.max(trailStop, ctc);
    }
    if (peak >= PROFIT_LOCK_ARM_PCT) {
      const lock = Math.round(entryPrice * (1 + PROFIT_LOCK_FLOOR_PCT / 100) * 100) / 100;
      trailStop = Math.max(trailStop, lock);
    }
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
  // Once a position stores profit_target, X2 and partial-exit thresholds use that
  // frozen level — never recompute a moving target from live TA.
  const targetPrice =
    frozenTargetPrice != null && frozenTargetPrice > entryPrice
      ? frozenTargetPrice
      : Number(plan.profit_target ?? entryPrice);
  const targetPct =
    frozenTargetPct != null && frozenTargetPct > 0
      ? frozenTargetPct
      : frozenTargetPrice != null && frozenTargetPrice > entryPrice && entryPrice > 0
        ? Math.round(((frozenTargetPrice - entryPrice) / entryPrice) * 10000) / 100
        : Number(plan.target_pct ?? MIN_TARGET_PCT);
  const gainPct = entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;
  const minPartialGain = Math.max(
    EXIT_RSI_MIN_GAIN_PCT,
    4.0,
    Math.round(targetPct * EXIT_PARTIAL_TARGET_FRACTION * 100) / 100,
  );
  const asOfDate = String(ta.as_of_date ?? new Date().toISOString().slice(0, 10));
  const sessionsHeld = tradingSessionsHeld(entryDate, asOfDate, bars);

  const high = highestSinceEntry ?? Math.max(price, entryPrice);
  const peak = peakGainPct(entryPrice, high, gainPct);

  const stopMeta = computeActiveStop(
    entryPrice,
    hardStop,
    gainPct,
    targetPct,
    trailStructural,
    num(dynamic.ema9_trail),
    peak,
  );
  const baseActiveStop = Number(stopMeta.active_stop ?? hardStop);

  const ema9Trail = num(dynamic.ema9_trail);
  const trailMeta = computeTrailStop(entryPrice, gainPct, high, targetPct, ema9Trail, regime, frozenTrailFloor);
  const trailStop = trailMeta.trail_stop;
  let activeStop = baseActiveStop;
  if (trailStop !== null && trailStop > activeStop) activeStop = trailStop;

  const rules: SwingRule[] = [];
  // X1 = hard / breakeven / profit-lock / structural only — do not fold trail into X1.
  const stopHit = price > 0 && price <= baseActiveStop;
  const x1Label = stopMeta.profit_lock_armed
    ? `Profit-lock +${PROFIT_LOCK_FLOOR_PCT}% (₹${baseActiveStop.toFixed(2)})`
    : stopMeta.breakeven_armed
      ? `Cost-to-cost after peak +${BREAKEVEN_ARM_PCT}% (₹${baseActiveStop.toFixed(2)})`
      : `−5% hard / structural (₹${baseActiveStop.toFixed(2)})`;
  rules.push(
    rule(
      'X1',
      'Stop-loss',
      x1Label,
      stopHit,
      stopHit
        ? stopMeta.profit_lock_armed
          ? 'Profit-lock floor hit — bank open gains.'
          : stopMeta.breakeven_armed
            ? 'Cost-to-cost / structural stop hit — exit near entry.'
            : 'Hard stop hit — exit immediately.'
        : `Stop not triggered (active ₹${baseActiveStop.toFixed(2)}).`,
    ),
  );

  const targetHit = price >= targetPrice;
  rules.push(
    rule(
      'X2',
      'Profit target',
      `+${targetPct}% (₹${targetPrice.toFixed(2)}) = frozen ${MIN_R_MULTIPLE}R at entry`,
      targetHit,
      targetHit ? 'Frozen entry target reached — book profits.' : 'Frozen entry target not yet hit.',
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
  const macdExit = macdFading && momentumWeak && gainPct >= EXIT_MACD_MIN_GAIN_PCT;
  rules.push(
    rule(
      'X5',
      'MACD momentum loss',
      `Exit when MACD hist fading + weak momentum + gain ≥ ${EXIT_MACD_MIN_GAIN_PCT}%`,
      macdExit,
      macdExit
        ? 'MACD fading with weak momentum — lock swing gains.'
        : macdFading
          ? momentumWeak
            ? 'MACD fading with weak momentum — watch X3 if gain still small.'
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
  // Once peak MFE earned a trail, do not dump near-flat via classic X7 — exit via X6 instead.
  const trailArmFloor = DEFAULT_TRAIL_ARM_PCT;
  const peakEarnedTrail = peak >= trailArmFloor;
  const sidewaysTimeStop = sidewaysRegime && timeStopFlat && timeStopWeak && !peakEarnedTrail;
  // Scratch dead trades: never reached +1% CTC arm and still red after N sessions →
  // exit before full −2.75%/−5% stop (raises WR + cuts expectancy drag).
  const deadTradeScratch =
    sessionsHeld >= SCRATCH_DEAD_SESSIONS &&
    peak < BREAKEVEN_ARM_PCT &&
    gainPct <= SCRATCH_DEAD_MAX_GAIN_PCT &&
    !peakEarnedTrail;
  const timeStop = sidewaysTimeStop || deadTradeScratch;
  rules.push(
    rule(
      'X7',
      'Time stop / scratch',
      deadTradeScratch
        ? `Scratch — ≥${SCRATCH_DEAD_SESSIONS} sessions, peak < +${BREAKEVEN_ARM_PCT}%, still red`
        : `${sidewaysRegime ? 'Active in sideways — ' : 'Advisory — '}≥${timeStopDays} sessions flat; skipped after trail earn`,
      timeStop,
      deadTradeScratch
        ? `Dead trade scratch — ${sessionsHeld} sessions without +${BREAKEVEN_ARM_PCT}% peak; exit before full stop.`
        : timeStopFlat
          ? peakEarnedTrail
            ? `Peak run +${peak.toFixed(1)}% already earned the trail — defer X7; manage via X6.`
            : sidewaysRegime
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
    profit_lock_armed: Boolean(stopMeta.profit_lock_armed),
    structural_stop: plan.structural_stop,
    profit_target: targetPrice,
    target_pct: targetPct,
    trail_stop: trailStop,
    trail_armed: trailMeta.trail_armed,
    trail_arm_pct: trailMeta.trail_arm_pct,
    trail_from_high_pct: trailMeta.trail_from_high_pct,
    high_water: trailMeta.high_water ?? high,
    peak_gain_pct: peak,
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

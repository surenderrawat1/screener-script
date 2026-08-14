/**
 * Walk-forward historical stats for chart patterns (no look-ahead).
 * Re-detects patterns on expanding windows, then simulates forward outcomes from the close at completion.
 */
import type { OhlcBar } from './types.js';
import {
  detectChartPatterns,
  type ChartPatternResult,
  type DetectedPattern,
  type PatternBacktestStat,
  type PatternConfig,
  type PatternKind,
  DEFAULT_PATTERN_CONFIG,
} from './chart-patterns.js';

export interface PatternBacktestOptions {
  step_bars: number;
  forward_horizon_bars: number;
  min_history_bars: number;
  max_kinds: number;
}

export const DEFAULT_PATTERN_BACKTEST_OPTIONS: PatternBacktestOptions = {
  step_bars: 5,
  forward_horizon_bars: 30,
  min_history_bars: 80,
  max_kinds: 2,
};

const KIND_LABELS: Record<PatternKind, string> = {
  double_bottom: 'Double Bottom',
  double_top: 'Double Top',
  head_and_shoulders: 'Head & Shoulders',
  inverse_head_and_shoulders: 'Inverse H&S',
  ascending_triangle: 'Ascending Triangle',
  descending_triangle: 'Descending Triangle',
  symmetrical_triangle: 'Symmetrical Triangle',
  rising_wedge: 'Rising Wedge',
  falling_wedge: 'Falling Wedge',
  bull_flag: 'Bull Flag',
  bear_flag: 'Bear Flag',
  bull_pennant: 'Bull Pennant',
  bear_pennant: 'Bear Pennant',
  cup_and_handle: 'Cup & Handle',
  rounding_bottom: 'Rounding Bottom',
  rounding_top: 'Rounding Top',
  rectangle: 'Rectangle',
  price_channel: 'Price Channel',
};

type ForwardResult = 'target' | 'stop' | 'open';

interface ForwardOutcome {
  result: ForwardResult;
  return_pct: number;
  bars: number;
  mfe_pct: number;
  mae_pct: number;
}

function simulateForward(
  bars: OhlcBar[],
  entryIdx: number,
  pattern: DetectedPattern,
  horizon: number,
): ForwardOutcome | null {
  if (pattern.type !== 'bullish' && pattern.type !== 'bearish') return null;
  if (pattern.target == null && pattern.stop_loss == null) return null;

  const entry = bars[entryIdx]!.close;
  const bullish = pattern.type === 'bullish';
  const lastIdx = Math.min(bars.length - 1, entryIdx + horizon);
  let mfePct = 0;
  let maePct = 0;

  for (let j = entryIdx + 1; j <= lastIdx; j += 1) {
    const b = bars[j]!;
    const favorable = bullish ? ((b.high - entry) / entry) * 100 : ((entry - b.low) / entry) * 100;
    const adverse = bullish ? ((entry - b.low) / entry) * 100 : ((b.high - entry) / entry) * 100;
    mfePct = Math.max(mfePct, favorable);
    maePct = Math.max(maePct, adverse);

    if (pattern.stop_loss != null) {
      if (bullish && b.low <= pattern.stop_loss) {
        return {
          result: 'stop',
          return_pct: ((pattern.stop_loss - entry) / entry) * 100,
          bars: j - entryIdx,
          mfe_pct: mfePct,
          mae_pct: maePct,
        };
      }
      if (!bullish && b.high >= pattern.stop_loss) {
        return {
          result: 'stop',
          return_pct: ((entry - pattern.stop_loss) / entry) * 100,
          bars: j - entryIdx,
          mfe_pct: mfePct,
          mae_pct: maePct,
        };
      }
    }

    if (pattern.target != null) {
      if (bullish && b.high >= pattern.target) {
        return {
          result: 'target',
          return_pct: ((pattern.target - entry) / entry) * 100,
          bars: j - entryIdx,
          mfe_pct: mfePct,
          mae_pct: maePct,
        };
      }
      if (!bullish && b.low <= pattern.target) {
        return {
          result: 'target',
          return_pct: ((entry - pattern.target) / entry) * 100,
          bars: j - entryIdx,
          mfe_pct: mfePct,
          mae_pct: maePct,
        };
      }
    }
  }

  const close = bars[lastIdx]!.close;
  const returnPct = bullish ? ((close - entry) / entry) * 100 : ((entry - close) / entry) * 100;
  return {
    result: 'open',
    return_pct: returnPct,
    bars: lastIdx - entryIdx,
    mfe_pct: mfePct,
    mae_pct: maePct,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function backtestPatternKind(
  bars: OhlcBar[],
  kind: PatternKind,
  partialConfig?: Partial<PatternConfig>,
  options: Partial<PatternBacktestOptions> = {},
): PatternBacktestStat {
  const config = { ...DEFAULT_PATTERN_CONFIG, ...partialConfig };
  const bt = { ...DEFAULT_PATTERN_BACKTEST_OPTIONS, ...options };
  const label = KIND_LABELS[kind];
  const disclaimer =
    'Historical walk-forward stats on this symbol only. Past pattern outcomes do not guarantee future results.';

  if (bars.length < bt.min_history_bars) {
    return {
      kind,
      label,
      timeframe: '1D',
      occurrences: 0,
      confirmed_breakouts: 0,
      target_hits: 0,
      stop_hits: 0,
      unresolved: 0,
      success_rate_pct: null,
      avg_return_pct: null,
      avg_mfe_pct: null,
      avg_mae_pct: null,
      avg_bars_to_outcome: null,
      lookback_bars: bars.length,
      forward_horizon_bars: bt.forward_horizon_bars,
      disclaimer,
    };
  }

  const seen = new Set<string>();
  let occurrences = 0;
  let confirmedBreakouts = 0;
  const outcomes: ForwardOutcome[] = [];

  const firstEnd = Math.max(config.min_pattern_bars + 10, bt.min_history_bars);
  const lastEnd = bars.length - bt.forward_horizon_bars - 1;

  for (let endIdx = firstEnd; endIdx <= lastEnd; endIdx += bt.step_bars) {
    const slice = bars.slice(0, endIdx + 1);
    const detected = detectChartPatterns(slice, {
      ...partialConfig,
      skip_mtf: true,
      skip_backtest: true,
      max_patterns: 20,
    });

    for (const pattern of detected.patterns) {
      if (pattern.kind !== kind) continue;
      if (pattern.end_date !== bars[endIdx]!.time) continue;

      const key = `${pattern.kind}:${pattern.start_date}:${pattern.end_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      occurrences += 1;

      if (pattern.status === 'breakout' || pattern.status === 'confirmed') {
        confirmedBreakouts += 1;
        const outcome = simulateForward(bars, endIdx, pattern, bt.forward_horizon_bars);
        if (outcome) outcomes.push(outcome);
      }
    }
  }

  const targetHits = outcomes.filter((o) => o.result === 'target').length;
  const stopHits = outcomes.filter((o) => o.result === 'stop').length;
  const unresolved = outcomes.filter((o) => o.result === 'open').length;
  const resolved = targetHits + stopHits;
  const successRate = resolved > 0 ? Math.round((targetHits / resolved) * 1000) / 10 : null;

  return {
    kind,
    label,
    timeframe: '1D',
    occurrences,
    confirmed_breakouts: confirmedBreakouts,
    target_hits: targetHits,
    stop_hits: stopHits,
    unresolved,
    success_rate_pct: successRate,
    avg_return_pct: avg(outcomes.map((o) => o.return_pct)),
    avg_mfe_pct: avg(outcomes.map((o) => o.mfe_pct)),
    avg_mae_pct: avg(outcomes.map((o) => o.mae_pct)),
    avg_bars_to_outcome: avg(outcomes.map((o) => o.bars)),
    lookback_bars: bars.length,
    forward_horizon_bars: bt.forward_horizon_bars,
    disclaimer,
  };
}

/** Attach walk-forward backtest stats for the top detected pattern kinds. */
export function attachPatternBacktest(
  bars: OhlcBar[],
  result: ChartPatternResult,
  partialConfig?: Partial<PatternConfig>,
  options?: Partial<PatternBacktestOptions>,
): ChartPatternResult {
  if (!result.ready || result.patterns.length === 0) return result;

  const bt = { ...DEFAULT_PATTERN_BACKTEST_OPTIONS, ...options };
  if (bars.length < bt.min_history_bars) return result;

  const kinds = [
    ...new Set(result.patterns.slice(0, bt.max_kinds).map((p) => p.kind)),
  ] as PatternKind[];

  return {
    ...result,
    backtest: kinds.map((kind) => backtestPatternKind(bars, kind, partialConfig, bt)),
  };
}

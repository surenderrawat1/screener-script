/**
 * Chart pattern detection (MVP).
 * Detects classic reversal patterns from OHLCV using swing highs/lows.
 * Status is forming | breakout | confirmed — never claims confirmation without a close beyond the level.
 */
import type { OhlcBar } from './types.js';
import { atr14 } from './ta-helper.js';
import { applyPatternIndicatorConfirmation, hourlyTrendFrame, intradayTrendFrame } from './chart-pattern-indicators.js';
import { refinePatternsForAccuracy } from './chart-pattern-accuracy.js';

export type PatternKind =
  | 'double_bottom'
  | 'double_top'
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders'
  | 'ascending_triangle'
  | 'descending_triangle'
  | 'symmetrical_triangle'
  | 'rising_wedge'
  | 'falling_wedge'
  | 'bull_flag'
  | 'bear_flag'
  | 'bull_pennant'
  | 'bear_pennant'
  | 'cup_and_handle'
  | 'rounding_bottom'
  | 'rounding_top'
  | 'rectangle'
  | 'price_channel';

export type PatternBias = 'bullish' | 'bearish' | 'neutral';
export type PatternStatus = 'forming' | 'breakout' | 'confirmed' | 'failed';

export interface PatternConfig {
  swing_lookback: number;
  min_pattern_bars: number;
  max_pattern_bars: number;
  /** Relative price tolerance for twin peaks/troughs (0.02 = 2%). */
  price_tolerance: number;
  /** Extra buffer beyond neckline for confirmation close (0.005 = 0.5%). */
  breakout_buffer: number;
  volume_confirmation_multiplier: number;
  /** Minimum swing amplitude as fraction of ATR. */
  min_swing_atr: number;
  /** Keep at most this many patterns (highest confidence first). */
  max_patterns: number;
  /** Flag / pennant pole length (bars). */
  pole_min_bars: number;
  pole_max_bars: number;
  /** Minimum pole move as fraction of price (0.05 = 5%). */
  pole_min_pct: number;
  consolidation_min_bars: number;
  consolidation_max_bars: number;
  /** Cup depth as fraction of rim (0.12 = 12%). */
  cup_min_depth_pct: number;
  cup_max_depth_pct: number;
  cup_min_bars: number;
  /** Max handle length after right rim (bars). */
  handle_max_bars: number;
  /** Max handle retrace as fraction of cup depth (0.5 = half the cup). */
  handle_max_retrace_pct: number;
  /** Min edge-to-center depth for rounding patterns. */
  rounding_min_depth_pct: number;
  /** When true, skip weekly MTF attachment (internal). */
  skip_mtf?: boolean;
  /** When true, skip historical backtest attachment (internal). */
  skip_backtest?: boolean;
  /** Confirmed status requires volume surge on the confirming close (doc §8). */
  require_volume_for_confirm: boolean;
  /** Drop / demote patterns with measured-move R:R below this floor. */
  min_reward_risk: number;
}

export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  swing_lookback: 5,
  min_pattern_bars: 20,
  max_pattern_bars: 150,
  price_tolerance: 0.02,
  breakout_buffer: 0.005,
  volume_confirmation_multiplier: 1.2,
  min_swing_atr: 0.6,
  max_patterns: 12,
  pole_min_bars: 5,
  pole_max_bars: 12,
  pole_min_pct: 0.05,
  consolidation_min_bars: 5,
  consolidation_max_bars: 18,
  cup_min_depth_pct: 0.08,
  cup_max_depth_pct: 0.45,
  cup_min_bars: 18,
  handle_max_bars: 22,
  handle_max_retrace_pct: 0.5,
  rounding_min_depth_pct: 0.08,
  require_volume_for_confirm: true,
  min_reward_risk: 1.5,
};

export interface SwingPoint {
  index: number;
  time: string;
  price: number;
  kind: 'high' | 'low';
}

export interface DetectedPattern {
  id: string;
  pattern: string;
  kind: PatternKind;
  type: PatternBias;
  status: PatternStatus;
  confidence: number;
  timeframe: string;
  start_date: string;
  end_date: string;
  support: number | null;
  resistance: number | null;
  breakout: number | null;
  target: number | null;
  stop_loss: number | null;
  volume_confirmed: boolean;
  rsi_confirmed?: boolean;
  macd_confirmed?: boolean;
  points: Record<string, number | string>;
  detail: string;
}

export interface PatternBacktestStat {
  kind: PatternKind;
  label: string;
  timeframe: string;
  occurrences: number;
  confirmed_breakouts: number;
  target_hits: number;
  stop_hits: number;
  unresolved: number;
  success_rate_pct: number | null;
  avg_return_pct: number | null;
  avg_mfe_pct: number | null;
  avg_mae_pct: number | null;
  avg_bars_to_outcome: number | null;
  lookback_bars: number;
  forward_horizon_bars: number;
  disclaimer: string;
}

export interface ChartPatternResult {
  ready: boolean;
  timeframe: string;
  patterns: DetectedPattern[];
  swing_count: { highs: number; lows: number };
  config: PatternConfig;
  disclaimer: string;
  mtf?: PatternMtfSummary;
  backtest?: PatternBacktestStat[];
}

export interface PatternMtfFrame {
  timeframe: string;
  label: string;
  pattern: string | null;
  type: PatternBias;
  status: PatternStatus | 'trend';
  confidence: number;
}

export interface PatternMtfSummary {
  overall_signal: PatternBias;
  overall_confidence: number;
  strength_label: string;
  frames: PatternMtfFrame[];
  detail: string;
}

const DISCLAIMER =
  'Chart patterns are research timing context only — not investment advice. Confirmed means a historical close beyond the level, not a guarantee of future moves.';

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function withinTol(a: number, b: number, tol: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / ((a + b) / 2) <= tol;
}

function avgVolume(bars: OhlcBar[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i <= Math.min(bars.length - 1, to); i++) {
    const v = bars[i]?.volume ?? 0;
    if (v > 0) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

export function detectSwingPoints(
  bars: OhlcBar[],
  config: PatternConfig = DEFAULT_PATTERN_CONFIG,
): SwingPoint[] {
  const n = config.swing_lookback;
  if (bars.length < n * 2 + 3) return [];

  const atr = atr14(bars) ?? 0;
  const minMove = atr > 0 ? atr * config.min_swing_atr : 0;
  const raw: SwingPoint[] = [];

  for (let i = n; i < bars.length - n; i++) {
    const bar = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (bars[j]!.high >= bar.high) isHigh = false;
      if (bars[j]!.low <= bar.low) isLow = false;
    }
    if (isHigh) {
      raw.push({ index: i, time: bar.time, price: bar.high, kind: 'high' });
    } else if (isLow) {
      raw.push({ index: i, time: bar.time, price: bar.low, kind: 'low' });
    }
  }

  // Collapse consecutive same-kind swings; keep extremes. Filter tiny moves.
  const filtered: SwingPoint[] = [];
  for (const sw of raw) {
    const prev = filtered[filtered.length - 1];
    if (!prev) {
      filtered.push(sw);
      continue;
    }
    if (prev.kind === sw.kind) {
      if (sw.kind === 'high' && sw.price >= prev.price) filtered[filtered.length - 1] = sw;
      if (sw.kind === 'low' && sw.price <= prev.price) filtered[filtered.length - 1] = sw;
      continue;
    }
    if (minMove > 0 && Math.abs(sw.price - prev.price) < minMove) continue;
    filtered.push(sw);
  }
  return filtered;
}

function statusFromBreak(
  lastClose: number,
  level: number,
  direction: 'above' | 'below',
  buffer: number,
  piercedIntraday: boolean,
): PatternStatus {
  const buf = level * buffer;
  if (direction === 'above') {
    if (lastClose >= level + buf) return 'confirmed';
    if (piercedIntraday || lastClose >= level) return 'breakout';
    return 'forming';
  }
  if (lastClose <= level - buf) return 'confirmed';
  if (piercedIntraday || lastClose <= level) return 'breakout';
  return 'forming';
}

function volumeConfirmed(
  bars: OhlcBar[],
  breakIndex: number,
  lookbackStart: number,
  mult: number,
): boolean {
  if (breakIndex <= 0 || breakIndex >= bars.length) return false;
  const base = avgVolume(bars, lookbackStart, breakIndex - 1);
  const vol = bars[breakIndex]?.volume ?? 0;
  return base > 0 && vol >= base * mult;
}

function confidenceBase(status: PatternStatus, volumeOk: boolean, geometryScore: number): number {
  let c = Math.round(55 + geometryScore * 30);
  if (status === 'breakout') c += 8;
  if (status === 'confirmed') c += 18;
  if (volumeOk) c += 6;
  if (status === 'forming') c = Math.min(c, 72);
  return Math.max(40, Math.min(95, c));
}

function detectDoubleBottoms(
  bars: OhlcBar[],
  swings: SwingPoint[],
  config: PatternConfig,
): DetectedPattern[] {
  const lows = swings.filter((s) => s.kind === 'low');
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;

  for (let i = 0; i < lows.length - 1; i++) {
    // Prefer consecutive twins; allow one intervening higher low (noise).
    for (let k = i + 1; k <= Math.min(i + 2, lows.length - 1); k++) {
    const l1 = lows[i]!;
    const l2 = lows[k]!;
    const span = l2.index - l1.index;
    if (span < config.min_pattern_bars / 2 || span > config.max_pattern_bars) continue;
    if (!withinTol(l1.price, l2.price, config.price_tolerance)) continue;
    if (l2.price < l1.price * (1 - config.price_tolerance * 1.5)) continue;
    if (k > i + 1) {
      const mid = lows[i + 1]!;
      if (mid.price <= Math.min(l1.price, l2.price) * 1.005) continue;
    }

    let neck = -Infinity;
    let neckIdx = l1.index;
    for (let j = l1.index; j <= l2.index; j++) {
      if (bars[j]!.high > neck) {
        neck = bars[j]!.high;
        neckIdx = j;
      }
    }
    if (!(neck > Math.max(l1.price, l2.price) * 1.01)) continue;

    const patternLow = Math.min(l1.price, l2.price);
    const height = neck - patternLow;
    if (height / neck < 0.015) continue;

    let pierceIdx = -1;
    for (let j = l2.index + 1; j < bars.length; j++) {
      if (bars[j]!.high >= neck) {
        pierceIdx = j;
        break;
      }
    }
    const status = statusFromBreak(
      last.close,
      neck,
      'above',
      config.breakout_buffer,
      pierceIdx >= 0,
    );
    const volOk =
      pierceIdx >= 0
        ? volumeConfirmed(bars, pierceIdx, l1.index, config.volume_confirmation_multiplier)
        : false;
    const geo = 1 - Math.abs(l1.price - l2.price) / ((l1.price + l2.price) / 2) / config.price_tolerance;

    out.push({
      id: `double_bottom:${l1.time}:${l2.time}`,
      pattern: 'Double Bottom',
      kind: 'double_bottom',
      type: 'bullish',
      status,
      confidence: confidenceBase(status, volOk, Math.max(0, Math.min(1, geo))),
      timeframe: '1D',
      start_date: l1.time,
      end_date: last.time,
      support: round(patternLow),
      resistance: round(neck),
      breakout: round(neck),
      target: round(neck + height),
      stop_loss: round(patternLow * (1 - config.breakout_buffer)),
      volume_confirmed: volOk,
      points: {
        low_1: round(l1.price),
        low_1_date: l1.time,
        low_2: round(l2.price),
        low_2_date: l2.time,
        neckline: round(neck),
        neckline_date: bars[neckIdx]!.time,
        geometry_score: Math.max(0, Math.min(1, geo)),
      },
      detail:
        status === 'confirmed'
          ? `Neckline ${round(neck)} cleared — measured move target ${round(neck + height)}.`
          : status === 'breakout'
            ? `Testing neckline ${round(neck)}; await decisive close for confirmation.`
            : `Twin lows near ${round(patternLow)}; neckline ${round(neck)} still intact.`,
    });
    }
  }
  return out;
}

function detectDoubleTops(
  bars: OhlcBar[],
  swings: SwingPoint[],
  config: PatternConfig,
): DetectedPattern[] {
  const highs = swings.filter((s) => s.kind === 'high');
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;

  for (let i = 0; i < highs.length - 1; i++) {
    for (let k = i + 1; k <= Math.min(i + 2, highs.length - 1); k++) {
    const h1 = highs[i]!;
    const h2 = highs[k]!;
    const span = h2.index - h1.index;
    if (span < config.min_pattern_bars / 2 || span > config.max_pattern_bars) continue;
    if (!withinTol(h1.price, h2.price, config.price_tolerance)) continue;
    if (h2.price > h1.price * (1 + config.price_tolerance * 1.5)) continue;
    if (k > i + 1) {
      const mid = highs[i + 1]!;
      if (mid.price >= Math.max(h1.price, h2.price) * 0.995) continue;
    }

    let neck = Infinity;
    let neckIdx = h1.index;
    for (let j = h1.index; j <= h2.index; j++) {
      if (bars[j]!.low < neck) {
        neck = bars[j]!.low;
        neckIdx = j;
      }
    }
    if (!(neck < Math.min(h1.price, h2.price) * 0.99)) continue;

    const patternHigh = Math.max(h1.price, h2.price);
    const height = patternHigh - neck;
    if (height / patternHigh < 0.015) continue;

    let pierceIdx = -1;
    for (let j = h2.index + 1; j < bars.length; j++) {
      if (bars[j]!.low <= neck) {
        pierceIdx = j;
        break;
      }
    }
    const status = statusFromBreak(
      last.close,
      neck,
      'below',
      config.breakout_buffer,
      pierceIdx >= 0,
    );
    const volOk =
      pierceIdx >= 0
        ? volumeConfirmed(bars, pierceIdx, h1.index, config.volume_confirmation_multiplier)
        : false;
    const geo = 1 - Math.abs(h1.price - h2.price) / ((h1.price + h2.price) / 2) / config.price_tolerance;

    out.push({
      id: `double_top:${h1.time}:${h2.time}`,
      pattern: 'Double Top',
      kind: 'double_top',
      type: 'bearish',
      status,
      confidence: confidenceBase(status, volOk, Math.max(0, Math.min(1, geo))),
      timeframe: '1D',
      start_date: h1.time,
      end_date: last.time,
      support: round(neck),
      resistance: round(patternHigh),
      breakout: round(neck),
      target: round(neck - height),
      stop_loss: round(patternHigh * (1 + config.breakout_buffer)),
      volume_confirmed: volOk,
      points: {
        high_1: round(h1.price),
        high_1_date: h1.time,
        high_2: round(h2.price),
        high_2_date: h2.time,
        neckline: round(neck),
        neckline_date: bars[neckIdx]!.time,
        geometry_score: Math.max(0, Math.min(1, geo)),
      },
      detail:
        status === 'confirmed'
          ? `Support ${round(neck)} broken — measured move target ${round(neck - height)}.`
          : status === 'breakout'
            ? `Testing support ${round(neck)}; await decisive close for confirmation.`
            : `Twin highs near ${round(patternHigh)}; support ${round(neck)} still holding.`,
    });
    }
  }
  return out;
}

function detectHeadAndShoulders(
  bars: OhlcBar[],
  swings: SwingPoint[],
  config: PatternConfig,
  inverse: boolean,
): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;
  const needed = inverse ? 'low' : 'high';
  const troughKind = inverse ? 'high' : 'low';

  for (let i = 0; i < swings.length - 4; i++) {
    const a = swings[i]!;
    const b = swings[i + 1]!;
    const c = swings[i + 2]!;
    const d = swings[i + 3]!;
    const e = swings[i + 4]!;
    if (a.kind !== needed || c.kind !== needed || e.kind !== needed) continue;
    if (b.kind !== troughKind || d.kind !== troughKind) continue;

    const span = e.index - a.index;
    if (span < config.min_pattern_bars || span > config.max_pattern_bars) continue;

    if (inverse) {
      // Inverse H&S: head is lowest; shoulders similar
      if (!(c.price < a.price && c.price < e.price)) continue;
      if (!withinTol(a.price, e.price, config.price_tolerance * 1.5)) continue;
    } else {
      if (!(c.price > a.price && c.price > e.price)) continue;
      if (!withinTol(a.price, e.price, config.price_tolerance * 1.5)) continue;
    }

    // Neckline through intervening troughs (or peaks for inverse)
    const n1 = b.price;
    const n2 = d.price;
    const neck = (n1 + n2) / 2;
    if (inverse) {
      if (!(neck > c.price)) continue;
    } else {
      if (!(neck < c.price)) continue;
    }

    const height = Math.abs(c.price - neck);
    if (height / neck < 0.015) continue;

    let pierceIdx = -1;
    for (let j = e.index + 1; j < bars.length; j++) {
      if (inverse ? bars[j]!.high >= neck : bars[j]!.low <= neck) {
        pierceIdx = j;
        break;
      }
    }

    const status = statusFromBreak(
      last.close,
      neck,
      inverse ? 'above' : 'below',
      config.breakout_buffer,
      pierceIdx >= 0,
    );
    const volOk =
      pierceIdx >= 0
        ? volumeConfirmed(bars, pierceIdx, a.index, config.volume_confirmation_multiplier)
        : false;
    const shoulderGeo =
      1 - Math.abs(a.price - e.price) / ((a.price + e.price) / 2) / (config.price_tolerance * 1.5);

    const kind: PatternKind = inverse ? 'inverse_head_and_shoulders' : 'head_and_shoulders';
    const label = inverse ? 'Inverse Head & Shoulders' : 'Head & Shoulders';
    const target = inverse ? neck + height : neck - height;

    out.push({
      id: `${kind}:${a.time}:${e.time}`,
      pattern: label,
      kind,
      type: inverse ? 'bullish' : 'bearish',
      status,
      confidence: confidenceBase(status, volOk, Math.max(0, Math.min(1, shoulderGeo))),
      timeframe: '1D',
      start_date: a.time,
      end_date: last.time,
      support: inverse ? round(c.price) : round(neck),
      resistance: inverse ? round(neck) : round(c.price),
      breakout: round(neck),
      target: round(target),
      stop_loss: inverse
        ? round(c.price * (1 - config.breakout_buffer))
        : round(c.price * (1 + config.breakout_buffer)),
      volume_confirmed: volOk,
      points: {
        left_shoulder: round(a.price),
        left_shoulder_date: a.time,
        head: round(c.price),
        head_date: c.time,
        right_shoulder: round(e.price),
        right_shoulder_date: e.time,
        neckline: round(neck),
      },
      detail:
        status === 'confirmed'
          ? `Neckline ${round(neck)} cleared — measured move target ${round(target)}.`
          : status === 'breakout'
            ? `Price probing neckline ${round(neck)}.`
            : `${label} structure with neckline near ${round(neck)}.`,
    });
  }
  return out;
}

function linReg(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } {
  if (points.length < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumYY - (sumY * sumY) / n;
  const ssRes = points.reduce((acc, p) => {
    const pred = intercept + slope * p.x;
    return acc + (p.y - pred) ** 2;
  }, 0);
  const r2 =
    ssRes < 1e-8 ? 1 : ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope, intercept, r2 };
}

function lineAt(reg: { slope: number; intercept: number }, x: number): number {
  return reg.intercept + reg.slope * x;
}

function slopeFlat(slope: number, refPrice: number, refIndex: number, tol: number): boolean {
  if (refPrice <= 0) return false;
  const pctPerBar = Math.abs(slope * refIndex) / refPrice;
  return pctPerBar <= tol * 0.35;
}

function detectTrianglesAndWedges(
  bars: OhlcBar[],
  swings: SwingPoint[],
  config: PatternConfig,
): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;

  for (let start = 0; start < swings.length - 3; start++) {
    for (let end = start + 3; end < swings.length; end++) {
      const window = swings.slice(start, end + 1);
      const firstIdx = window[0]!.index;
      const lastSwingIdx = window[window.length - 1]!.index;
      const span = lastSwingIdx - firstIdx;
      if (span < config.min_pattern_bars || span > config.max_pattern_bars) continue;

      const highs = window.filter((s) => s.kind === 'high');
      const lows = window.filter((s) => s.kind === 'low');
      if (highs.length < 2 || lows.length < 2) continue;

      const highPts = highs.map((s) => ({ x: s.index, y: s.price }));
      const lowPts = lows.map((s) => ({ x: s.index, y: s.price }));
      const hiReg = linReg(highPts);
      const loReg = linReg(lowPts);
      if (hiReg.r2 < 0.55 || loReg.r2 < 0.55) continue;

      const refPrice = (highs[highs.length - 1]!.price + lows[lows.length - 1]!.price) / 2;
      const resAtStart = lineAt(hiReg, firstIdx);
      const supAtStart = lineAt(loReg, firstIdx);
      const resAtEnd = lineAt(hiReg, lastSwingIdx);
      const supAtEnd = lineAt(loReg, lastSwingIdx);
      const widthStart = resAtStart - supAtStart;
      const widthEnd = resAtEnd - supAtEnd;
      if (widthStart <= 0 || widthEnd <= 0) continue;
      if (widthEnd >= widthStart * 0.92) continue; // must converge

      const flatHigh = slopeFlat(hiReg.slope, refPrice, lastSwingIdx, config.price_tolerance);
      const flatLow = slopeFlat(loReg.slope, refPrice, lastSwingIdx, config.price_tolerance);
      const risingHigh = hiReg.slope > 0 && !flatHigh;
      const risingLow = loReg.slope > 0 && !flatLow;
      const fallingHigh = hiReg.slope < 0 && !flatHigh;
      const fallingLow = loReg.slope < 0 && !flatLow;

      type Candidate = {
        kind: PatternKind;
        label: string;
        type: PatternBias;
        resistance: number;
        support: number;
        breakDir: 'above' | 'below';
        target: number;
        stop: number;
        detailForming: string;
      };

      let cand: Candidate | null = null;
      const height = widthStart;

      if (flatHigh && risingLow) {
        cand = {
          kind: 'ascending_triangle',
          label: 'Ascending Triangle',
          type: 'bullish',
          resistance: resAtEnd,
          support: supAtEnd,
          breakDir: 'above',
          target: resAtEnd + height,
          stop: supAtEnd * (1 - config.breakout_buffer),
          detailForming: `Flat resistance ~${round(resAtEnd)} with rising support.`,
        };
      } else if (flatLow && fallingHigh) {
        cand = {
          kind: 'descending_triangle',
          label: 'Descending Triangle',
          type: 'bearish',
          resistance: resAtEnd,
          support: supAtEnd,
          breakDir: 'below',
          target: supAtEnd - height,
          stop: resAtEnd * (1 + config.breakout_buffer),
          detailForming: `Flat support ~${round(supAtEnd)} with falling resistance.`,
        };
      } else if (fallingHigh && risingLow) {
        cand = {
          kind: 'symmetrical_triangle',
          label: 'Symmetrical Triangle',
          type: 'neutral',
          resistance: resAtEnd,
          support: supAtEnd,
          breakDir: last.close >= resAtEnd ? 'above' : last.close <= supAtEnd ? 'below' : 'above',
          target: last.close >= (resAtEnd + supAtEnd) / 2 ? resAtEnd + height : supAtEnd - height,
          stop: last.close >= (resAtEnd + supAtEnd) / 2 ? supAtEnd : resAtEnd,
          detailForming: `Converging highs/lows between ${round(supAtEnd)} and ${round(resAtEnd)}.`,
        };
      } else if (risingHigh && risingLow && hiReg.slope < loReg.slope) {
        cand = {
          kind: 'rising_wedge',
          label: 'Rising Wedge',
          type: 'bearish',
          resistance: resAtEnd,
          support: supAtEnd,
          breakDir: 'below',
          target: supAtEnd - height,
          stop: resAtEnd * (1 + config.breakout_buffer),
          detailForming: `Rising converging wedge — bearish bias below ${round(supAtEnd)}.`,
        };
      } else if (fallingHigh && fallingLow && hiReg.slope > loReg.slope) {
        cand = {
          kind: 'falling_wedge',
          label: 'Falling Wedge',
          type: 'bullish',
          resistance: resAtEnd,
          support: supAtEnd,
          breakDir: 'above',
          target: resAtEnd + height,
          stop: supAtEnd * (1 - config.breakout_buffer),
          detailForming: `Falling converging wedge — bullish bias above ${round(resAtEnd)}.`,
        };
      }
      if (!cand) continue;

      const breakLevel = cand.breakDir === 'above' ? cand.resistance : cand.support;
      let pierceIdx = -1;
      for (let j = lastSwingIdx + 1; j < bars.length; j++) {
        if (cand.breakDir === 'above' ? bars[j]!.high >= breakLevel : bars[j]!.low <= breakLevel) {
          pierceIdx = j;
          break;
        }
      }
      const status = statusFromBreak(
        last.close,
        breakLevel,
        cand.breakDir,
        config.breakout_buffer,
        pierceIdx >= 0,
      );
      const volOk =
        pierceIdx >= 0
          ? volumeConfirmed(bars, pierceIdx, firstIdx, config.volume_confirmation_multiplier)
          : false;
      const geo = Math.min(hiReg.r2, loReg.r2);
      let type = cand.type;
      if (cand.kind === 'symmetrical_triangle' && status !== 'forming') {
        type = cand.breakDir === 'above' ? 'bullish' : 'bearish';
      }

      out.push({
        id: `${cand.kind}:${window[0]!.time}:${window[window.length - 1]!.time}`,
        pattern: cand.label,
        kind: cand.kind,
        type,
        status,
        confidence: confidenceBase(status, volOk, geo),
        timeframe: '1D',
        start_date: bars[firstIdx]!.time,
        end_date: last.time,
        support: round(cand.support),
        resistance: round(cand.resistance),
        breakout: round(breakLevel),
        target: round(cand.target),
        stop_loss: round(cand.stop),
        volume_confirmed: volOk,
        points: {
          width_start: round(widthStart),
          width_end: round(widthEnd),
          high_slope: round(hiReg.slope, 4),
          low_slope: round(loReg.slope, 4),
        },
        detail:
          status === 'confirmed'
            ? `${cand.label} ${cand.breakDir === 'above' ? 'breakout' : 'breakdown'} confirmed — target ${round(cand.target)}.`
            : status === 'breakout'
              ? `${cand.label} testing ${round(breakLevel)}; await close for confirmation.`
              : cand.detailForming,
      });
    }
  }
  return out;
}

function slopesParallel(
  hiSlope: number,
  loSlope: number,
  refPrice: number,
  refIndex: number,
  tol: number,
): boolean {
  if (refPrice <= 0) return false;
  const hiPct = Math.abs(hiSlope * refIndex) / refPrice;
  const loPct = Math.abs(loSlope * refIndex) / refPrice;
  return Math.abs(hiPct - loPct) <= tol;
}

function detectFlagsAndPennants(bars: OhlcBar[], config: PatternConfig): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;
  const lastIdx = bars.length - 1;
  const slopeTol = config.price_tolerance * 0.4;

  for (let consolEnd = lastIdx; consolEnd >= config.consolidation_min_bars + config.pole_min_bars; consolEnd--) {
    for (
      let consolLen = config.consolidation_min_bars;
      consolLen <= config.consolidation_max_bars;
      consolLen++
    ) {
      const consolStart = consolEnd - consolLen + 1;
      if (consolStart < config.pole_min_bars) continue;

      for (let poleLen = config.pole_min_bars; poleLen <= config.pole_max_bars; poleLen++) {
        const poleStart = consolStart - poleLen;
        if (poleStart < 0) continue;

        const poleOpen = bars[poleStart]!.close;
        const poleClose = bars[consolStart - 1]!.close;
        const poleMove = poleClose - poleOpen;
        const polePct = Math.abs(poleMove) / poleOpen;
        if (polePct < config.pole_min_pct) continue;

        const bullish = poleMove > 0;
        const bearish = poleMove < 0;
        if (!bullish && !bearish) continue;

        const slice = bars.slice(consolStart, consolEnd + 1);
        if (slice.length < config.consolidation_min_bars) continue;

        const highPts = slice.map((b, i) => ({ x: consolStart + i, y: b.high }));
        const lowPts = slice.map((b, i) => ({ x: consolStart + i, y: b.low }));
        const hiReg = linReg(highPts);
        const loReg = linReg(lowPts);
        if (hiReg.r2 < 0.45 || loReg.r2 < 0.45) continue;

        const resAtStart = lineAt(hiReg, consolStart);
        const supAtStart = lineAt(loReg, consolStart);
        const resAtEnd = lineAt(hiReg, consolEnd);
        const supAtEnd = lineAt(loReg, consolEnd);
        const widthStart = resAtStart - supAtStart;
        const widthEnd = resAtEnd - supAtEnd;
        if (widthStart <= 0 || widthEnd <= 0) continue;

        const refPrice = (resAtEnd + supAtEnd) / 2;
        const parallel = slopesParallel(hiReg.slope, loReg.slope, refPrice, consolEnd, slopeTol);
        const converging = widthEnd < widthStart * 0.82;
        const poleHeight = Math.abs(poleMove);

        // Bull flag: slight drift down or flat channel after up-pole
        if (bullish && parallel && hiReg.slope <= 0 && loReg.slope <= 0) {
          const breakLevel = resAtEnd;
          let pierceIdx = -1;
          for (let j = consolEnd + 1; j < bars.length; j++) {
            if (bars[j]!.high >= breakLevel) {
              pierceIdx = j;
              break;
            }
          }
          const status = statusFromBreak(
            last.close,
            breakLevel,
            'above',
            config.breakout_buffer,
            pierceIdx >= 0,
          );
          const volOk =
            pierceIdx >= 0
              ? volumeConfirmed(bars, pierceIdx, poleStart, config.volume_confirmation_multiplier)
              : false;
          out.push({
            id: `bull_flag:${bars[poleStart]!.time}:${bars[consolEnd]!.time}`,
            pattern: 'Bull Flag',
            kind: 'bull_flag',
            type: 'bullish',
            status,
            confidence: confidenceBase(status, volOk, Math.min(hiReg.r2, loReg.r2)),
            timeframe: '1D',
            start_date: bars[poleStart]!.time,
            end_date: last.time,
            support: round(supAtEnd),
            resistance: round(resAtEnd),
            breakout: round(breakLevel),
            target: round(breakLevel + poleHeight),
            stop_loss: round(supAtEnd * (1 - config.breakout_buffer)),
            volume_confirmed: volOk,
            points: {
              pole_start: round(poleOpen),
              pole_end: round(poleClose),
              pole_pct: round(polePct * 100, 1),
            },
            detail:
              status === 'confirmed'
                ? `Bull flag breakout — pole ${round(polePct * 100, 1)}%, target ${round(breakLevel + poleHeight)}.`
                : `Up-pole then parallel drift; resistance ~${round(resAtEnd)}.`,
          });
        }

        // Bear flag: slight drift up channel after down-pole
        if (bearish && parallel && hiReg.slope >= 0 && loReg.slope >= 0) {
          const breakLevel = supAtEnd;
          let pierceIdx = -1;
          for (let j = consolEnd + 1; j < bars.length; j++) {
            if (bars[j]!.low <= breakLevel) {
              pierceIdx = j;
              break;
            }
          }
          const status = statusFromBreak(
            last.close,
            breakLevel,
            'below',
            config.breakout_buffer,
            pierceIdx >= 0,
          );
          const volOk =
            pierceIdx >= 0
              ? volumeConfirmed(bars, pierceIdx, poleStart, config.volume_confirmation_multiplier)
              : false;
          out.push({
            id: `bear_flag:${bars[poleStart]!.time}:${bars[consolEnd]!.time}`,
            pattern: 'Bear Flag',
            kind: 'bear_flag',
            type: 'bearish',
            status,
            confidence: confidenceBase(status, volOk, Math.min(hiReg.r2, loReg.r2)),
            timeframe: '1D',
            start_date: bars[poleStart]!.time,
            end_date: last.time,
            support: round(supAtEnd),
            resistance: round(resAtEnd),
            breakout: round(breakLevel),
            target: round(breakLevel - poleHeight),
            stop_loss: round(resAtEnd * (1 + config.breakout_buffer)),
            volume_confirmed: volOk,
            points: {
              pole_start: round(poleOpen),
              pole_end: round(poleClose),
              pole_pct: round(polePct * 100, 1),
            },
            detail:
              status === 'confirmed'
                ? `Bear flag breakdown — pole ${round(polePct * 100, 1)}%, target ${round(breakLevel - poleHeight)}.`
                : `Down-pole then parallel drift; support ~${round(supAtEnd)}.`,
          });
        }

        // Pennants: converging consolidation after pole (shorter than full triangle)
        if (bullish && converging && consolLen <= 14) {
          const breakLevel = resAtEnd;
          let pierceIdx = -1;
          for (let j = consolEnd + 1; j < bars.length; j++) {
            if (bars[j]!.high >= breakLevel) {
              pierceIdx = j;
              break;
            }
          }
          const status = statusFromBreak(
            last.close,
            breakLevel,
            'above',
            config.breakout_buffer,
            pierceIdx >= 0,
          );
          const volOk =
            pierceIdx >= 0
              ? volumeConfirmed(bars, pierceIdx, poleStart, config.volume_confirmation_multiplier)
              : false;
          out.push({
            id: `bull_pennant:${bars[poleStart]!.time}:${bars[consolEnd]!.time}`,
            pattern: 'Bull Pennant',
            kind: 'bull_pennant',
            type: 'bullish',
            status,
            confidence: confidenceBase(status, volOk, widthEnd / widthStart),
            timeframe: '1D',
            start_date: bars[poleStart]!.time,
            end_date: last.time,
            support: round(supAtEnd),
            resistance: round(resAtEnd),
            breakout: round(breakLevel),
            target: round(breakLevel + poleHeight),
            stop_loss: round(supAtEnd * (1 - config.breakout_buffer)),
            volume_confirmed: volOk,
            points: { pole_pct: round(polePct * 100, 1) },
            detail: `Bull pennant after ${round(polePct * 100, 1)}% pole — apex near ${round((resAtEnd + supAtEnd) / 2)}.`,
          });
        }

        if (bearish && converging && consolLen <= 14) {
          const breakLevel = supAtEnd;
          let pierceIdx = -1;
          for (let j = consolEnd + 1; j < bars.length; j++) {
            if (bars[j]!.low <= breakLevel) {
              pierceIdx = j;
              break;
            }
          }
          const status = statusFromBreak(
            last.close,
            breakLevel,
            'below',
            config.breakout_buffer,
            pierceIdx >= 0,
          );
          const volOk =
            pierceIdx >= 0
              ? volumeConfirmed(bars, pierceIdx, poleStart, config.volume_confirmation_multiplier)
              : false;
          out.push({
            id: `bear_pennant:${bars[poleStart]!.time}:${bars[consolEnd]!.time}`,
            pattern: 'Bear Pennant',
            kind: 'bear_pennant',
            type: 'bearish',
            status,
            confidence: confidenceBase(status, volOk, widthEnd / widthStart),
            timeframe: '1D',
            start_date: bars[poleStart]!.time,
            end_date: last.time,
            support: round(supAtEnd),
            resistance: round(resAtEnd),
            breakout: round(breakLevel),
            target: round(breakLevel - poleHeight),
            stop_loss: round(resAtEnd * (1 + config.breakout_buffer)),
            volume_confirmed: volOk,
            points: { pole_pct: round(polePct * 100, 1) },
            detail: `Bear pennant after ${round(polePct * 100, 1)}% pole — apex near ${round((resAtEnd + supAtEnd) / 2)}.`,
          });
        }
      }
    }
  }
  return out;
}

function monotonicScore(values: number[], direction: 'down' | 'up'): number {
  if (values.length < 2) return 0;
  let ok = 0;
  for (let i = 1; i < values.length; i++) {
    if (direction === 'down' && values[i]! <= values[i - 1]! * 1.008) ok++;
    if (direction === 'up' && values[i]! >= values[i - 1]! * 0.992) ok++;
  }
  return ok / (values.length - 1);
}

function detectCupAndHandle(
  bars: OhlcBar[],
  swings: SwingPoint[],
  config: PatternConfig,
): DetectedPattern[] {
  const highs = swings.filter((s) => s.kind === 'high');
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;

  for (let li = 0; li < highs.length - 1; li++) {
    const leftRim = highs[li]!;
    for (let ri = li + 1; ri < highs.length; ri++) {
      const rightRim = highs[ri]!;
      const cupSpan = rightRim.index - leftRim.index;
      if (cupSpan < config.cup_min_bars || cupSpan > config.max_pattern_bars) continue;
      if (!withinTol(leftRim.price, rightRim.price, config.price_tolerance * 1.5)) continue;

      let bottomIdx = leftRim.index;
      let bottomPrice = bars[leftRim.index]!.low;
      for (let j = leftRim.index + 1; j < rightRim.index; j++) {
        if (bars[j]!.low < bottomPrice) {
          bottomPrice = bars[j]!.low;
          bottomIdx = j;
        }
      }

      const rim = Math.max(leftRim.price, rightRim.price);
      const depth = rim - bottomPrice;
      const depthPct = depth / rim;
      if (depthPct < config.cup_min_depth_pct || depthPct > config.cup_max_depth_pct) continue;

      const relPos = (bottomIdx - leftRim.index) / cupSpan;
      if (relPos < 0.25 || relPos > 0.75) continue;

      const leftLows = bars.slice(leftRim.index, bottomIdx + 1).map((b) => b.low);
      const rightLows = bars.slice(bottomIdx, rightRim.index + 1).map((b) => b.low);
      if (monotonicScore(leftLows, 'down') < 0.5 || monotonicScore(rightLows, 'up') < 0.5) continue;

      const handleStart = rightRim.index;
      if (handleStart >= bars.length - 2) continue;

      const handleEnd = Math.min(bars.length - 1, handleStart + config.handle_max_bars);
      let handleLow = Infinity;
      let handleHigh = bars[handleStart]!.high;
      for (let j = handleStart; j <= handleEnd; j++) {
        handleLow = Math.min(handleLow, bars[j]!.low);
        handleHigh = Math.max(handleHigh, bars[j]!.high);
      }

      const handleRetrace = depth > 0 ? (rim - handleLow) / depth : 1;
      if (handleRetrace > config.handle_max_retrace_pct) continue;
      if (handleLow < bottomPrice + depth * 0.45) continue;

      const breakoutLevel = Math.max(rim, handleHigh);
      let pierceIdx = -1;
      for (let j = handleStart; j < bars.length; j++) {
        if (bars[j]!.high >= breakoutLevel) {
          pierceIdx = j;
          break;
        }
      }
      const status = statusFromBreak(
        last.close,
        breakoutLevel,
        'above',
        config.breakout_buffer,
        pierceIdx >= 0,
      );
      const volOk =
        pierceIdx >= 0
          ? volumeConfirmed(bars, pierceIdx, leftRim.index, config.volume_confirmation_multiplier)
          : false;
      const rimSym = 1 - Math.abs(leftRim.price - rightRim.price) / rim / (config.price_tolerance * 1.5);
      const geo = Math.max(0, Math.min(1, (rimSym + (1 - handleRetrace)) / 2));

      out.push({
        id: `cup_handle:${leftRim.time}:${rightRim.time}`,
        pattern: 'Cup & Handle',
        kind: 'cup_and_handle',
        type: 'bullish',
        status,
        confidence: confidenceBase(status, volOk, geo),
        timeframe: '1D',
        start_date: leftRim.time,
        end_date: last.time,
        support: round(handleLow),
        resistance: round(rim),
        breakout: round(breakoutLevel),
        target: round(rim + depth),
        stop_loss: round(handleLow * (1 - config.breakout_buffer)),
        volume_confirmed: volOk,
        points: {
          left_rim: round(leftRim.price),
          right_rim: round(rightRim.price),
          cup_bottom: round(bottomPrice),
          cup_depth_pct: round(depthPct * 100, 1),
          handle_low: round(handleLow),
        },
        detail:
          status === 'confirmed'
            ? `Cup & handle breakout — rim ${round(rim)}, measured target ${round(rim + depth)}.`
            : status === 'breakout'
              ? `Testing cup rim ${round(breakoutLevel)}; handle low ${round(handleLow)}.`
              : `U-shaped base (${round(depthPct * 100, 1)}% depth) with handle forming under ${round(rim)}.`,
      });
    }
  }
  return out;
}

function detectRoundingPatterns(
  bars: OhlcBar[],
  config: PatternConfig,
  variant: 'bottom' | 'top',
): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;
  const edgeBars = 5;
  const bullish = variant === 'bottom';

  for (
    let winLen = config.min_pattern_bars;
    winLen <= Math.min(config.max_pattern_bars, bars.length);
    winLen += 4
  ) {
    const start = bars.length - winLen;
    const window = bars.slice(start);
    if (window.length < edgeBars * 2 + 8) continue;

    const edgeSeries = (slice: OhlcBar[]) =>
      bullish
        ? slice.reduce((s, b) => s + b.low, 0) / slice.length
        : slice.reduce((s, b) => s + b.high, 0) / slice.length;

    const leftEdge = edgeSeries(window.slice(0, edgeBars));
    const rightAnchor = Math.max(edgeBars, Math.floor(window.length * 0.82) - edgeBars);
    const rightEdge = edgeSeries(window.slice(rightAnchor, rightAnchor + edgeBars));

    let extremeIdx = edgeBars;
    let extremeVal = bullish ? window[edgeBars]!.low : window[edgeBars]!.high;
    for (let i = edgeBars; i < window.length - edgeBars; i++) {
      const v = bullish ? window[i]!.low : window[i]!.high;
      if (bullish ? v < extremeVal : v > extremeVal) {
        extremeVal = v;
        extremeIdx = i;
      }
    }

    const rim = (leftEdge + rightEdge) / 2;
    const depth = bullish ? (rim - extremeVal) / rim : (extremeVal - rim) / rim;
    if (depth < config.rounding_min_depth_pct) continue;

    const relPos = extremeIdx / (window.length - 1);
    if (relPos < 0.32 || relPos > 0.68) continue;
    if (!withinTol(leftEdge, rightEdge, config.price_tolerance * 2)) continue;

    const curve = window.map((b) => (bullish ? b.low : b.high));
    const third = Math.floor(curve.length / 3);
    const leftAvg = curve.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const midAvg = curve.slice(third, third * 2).reduce((a, b) => a + b, 0) / third;
    const rightAvg = curve.slice(third * 2).reduce((a, b) => a + b, 0) / (curve.length - third * 2);
    const uOk = bullish ? leftAvg > midAvg && rightAvg > midAvg : leftAvg < midAvg && rightAvg < midAvg;
    if (!uOk) continue;

    const breakoutLevel = bullish
      ? Math.max(...window.slice(-edgeBars).map((b) => b.high))
      : Math.min(...window.slice(-edgeBars).map((b) => b.low));
    const height = Math.abs(rim - extremeVal);

    let pierceIdx = -1;
    for (let j = start; j < bars.length; j++) {
      if (bullish && bars[j]!.high >= breakoutLevel) {
        pierceIdx = j;
        break;
      }
      if (!bullish && bars[j]!.low <= breakoutLevel) {
        pierceIdx = j;
        break;
      }
    }

    const status = statusFromBreak(
      last.close,
      breakoutLevel,
      bullish ? 'above' : 'below',
      config.breakout_buffer,
      pierceIdx >= 0,
    );
    const volOk =
      pierceIdx >= 0
        ? volumeConfirmed(bars, pierceIdx, start, config.volume_confirmation_multiplier)
        : false;
    const geo = Math.max(0, Math.min(1, depth / config.rounding_min_depth_pct / 2));

    out.push({
      id: `${variant === 'bottom' ? 'rounding_bottom' : 'rounding_top'}:${window[0]!.time}:${last.time}`,
      pattern: variant === 'bottom' ? 'Rounding Bottom' : 'Rounding Top',
      kind: variant === 'bottom' ? 'rounding_bottom' : 'rounding_top',
      type: bullish ? 'bullish' : 'bearish',
      status,
      confidence: confidenceBase(status, volOk, geo),
      timeframe: '1D',
      start_date: window[0]!.time,
      end_date: last.time,
      support: round(bullish ? extremeVal : breakoutLevel),
      resistance: round(bullish ? breakoutLevel : extremeVal),
      breakout: round(breakoutLevel),
      target: round(bullish ? breakoutLevel + height : breakoutLevel - height),
      stop_loss: round(
        bullish
          ? extremeVal * (1 - config.breakout_buffer)
          : extremeVal * (1 + config.breakout_buffer),
      ),
      volume_confirmed: volOk,
      points: {
        rim: round(rim),
        extreme: round(extremeVal),
        depth_pct: round(depth * 100, 1),
      },
      detail:
        status === 'confirmed'
          ? `${variant === 'bottom' ? 'Rounding bottom' : 'Rounding top'} breakout — target ${round(bullish ? breakoutLevel + height : breakoutLevel - height)}.`
          : `${variant === 'bottom' ? 'Curved base' : 'Curved top'} forming; ${round(depth * 100, 1)}% depth, rim ~${round(rim)}.`,
    });
  }
  return out;
}

function detectRectanglesAndChannels(bars: OhlcBar[], config: PatternConfig): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const last = bars[bars.length - 1]!;
  const lastIdx = bars.length - 1;
  const slopeTol = config.price_tolerance * 0.4;

  for (
    let winLen = config.min_pattern_bars;
    winLen <= Math.min(config.max_pattern_bars, bars.length);
    winLen += 5
  ) {
    const start = bars.length - winLen;
    const end = lastIdx;
    const slice = bars.slice(start);
    if (slice.length < 15) continue;

    const highPts = slice.map((b, i) => ({ x: start + i, y: b.high }));
    const lowPts = slice.map((b, i) => ({ x: start + i, y: b.low }));
    const hiReg = linReg(highPts);
    const loReg = linReg(lowPts);
    if (hiReg.r2 < 0.55 || loReg.r2 < 0.55) continue;

    const resAtEnd = lineAt(hiReg, end);
    const supAtEnd = lineAt(loReg, end);
    const width = resAtEnd - supAtEnd;
    const mid = (resAtEnd + supAtEnd) / 2;
    if (width <= 0 || width / mid < 0.012) continue;

    if (!slopesParallel(hiReg.slope, loReg.slope, mid, end, slopeTol)) continue;

    const flatHigh = slopeFlat(hiReg.slope, mid, end, config.price_tolerance);
    const flatLow = slopeFlat(loReg.slope, mid, end, config.price_tolerance);
    const isRectangle = flatHigh && flatLow;

    let kind: PatternKind = isRectangle ? 'rectangle' : 'price_channel';
    let label = isRectangle ? 'Rectangle' : 'Price Channel';
    let type: PatternBias = 'neutral';

    if (!isRectangle) {
      if (hiReg.slope > 0 && loReg.slope > 0) {
        label = 'Ascending Channel';
        type = 'bullish';
      } else if (hiReg.slope < 0 && loReg.slope < 0) {
        label = 'Descending Channel';
        type = 'bearish';
      }
    }

    const breakUp = last.close > resAtEnd;
    const breakDn = last.close < supAtEnd;
    const breakDir: 'above' | 'below' =
      breakUp || (!breakDn && last.close >= mid) ? 'above' : 'below';
    const breakLevel = breakDir === 'above' ? resAtEnd : supAtEnd;

    let pierceIdx = -1;
    for (let j = start; j < bars.length; j++) {
      if (breakDir === 'above' && bars[j]!.high >= breakLevel) {
        pierceIdx = j;
        break;
      }
      if (breakDir === 'below' && bars[j]!.low <= breakLevel) {
        pierceIdx = j;
        break;
      }
    }

    const status = statusFromBreak(
      last.close,
      breakLevel,
      breakDir,
      config.breakout_buffer,
      pierceIdx >= 0,
    );
    const volOk =
      pierceIdx >= 0
        ? volumeConfirmed(bars, pierceIdx, start, config.volume_confirmation_multiplier)
        : false;
    const geo = Math.min(hiReg.r2, loReg.r2);
    const target = breakDir === 'above' ? resAtEnd + width : supAtEnd - width;
    const stop =
      breakDir === 'above'
        ? supAtEnd * (1 - config.breakout_buffer)
        : resAtEnd * (1 + config.breakout_buffer);

    if (isRectangle && status !== 'forming') {
      type = breakDir === 'above' ? 'bullish' : 'bearish';
    }

    out.push({
      id: `${kind}:${bars[start]!.time}:${last.time}`,
      pattern: label,
      kind,
      type,
      status,
      confidence: confidenceBase(status, volOk, geo),
      timeframe: '1D',
      start_date: bars[start]!.time,
      end_date: last.time,
      support: round(supAtEnd),
      resistance: round(resAtEnd),
      breakout: round(breakLevel),
      target: round(target),
      stop_loss: round(stop),
      volume_confirmed: volOk,
      points: {
        width: round(width),
        high_slope: round(hiReg.slope, 4),
        low_slope: round(loReg.slope, 4),
      },
      detail:
        status === 'confirmed'
          ? `${label} ${breakDir === 'above' ? 'breakout' : 'breakdown'} — target ${round(target)}.`
          : status === 'breakout'
            ? `${label} testing ${round(breakLevel)}; range ${round(supAtEnd)}–${round(resAtEnd)}.`
            : `${label} between ${round(supAtEnd)} and ${round(resAtEnd)} (${round(width)} wide).`,
    });
  }

  return out;
}

function dedupePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
  const byKind = new Map<string, DetectedPattern>();
  for (const p of patterns) {
    const key = `${p.kind}:${p.start_date}`;
    const prev = byKind.get(key);
    if (!prev || p.confidence > prev.confidence) byKind.set(key, p);
  }
  // Also keep best per kind overall if overlapping windows
  const bestByKindLatest = new Map<PatternKind, DetectedPattern>();
  for (const p of byKind.values()) {
    const prev = bestByKindLatest.get(p.kind);
    if (!prev) {
      bestByKindLatest.set(p.kind, p);
      continue;
    }
    const statusRank = { confirmed: 3, breakout: 2, forming: 1, failed: 0 } as const;
    if (
      statusRank[p.status] > statusRank[prev.status] ||
      (statusRank[p.status] === statusRank[prev.status] && p.confidence >= prev.confidence)
    ) {
      bestByKindLatest.set(p.kind, p);
    }
  }
  return [...bestByKindLatest.values()];
}

/** Resample daily OHLCV into calendar-week bars (week ends on last trading day in bucket). */
export function resampleBarsToWeekly(bars: OhlcBar[]): OhlcBar[] {
  if (!bars.length) return [];
  const buckets = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const d = new Date(`${b.time}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getUTCDay() || 7;
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - day);
    const year = thursday.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86_400_000 + jan1.getUTCDay() + 1) / 7);
    const key = `${year}-W${String(week).padStart(2, '0')}`;
    const group = buckets.get(key) ?? [];
    group.push(b);
    buckets.set(key, group);
  }
  const out: OhlcBar[] = [];
  for (const key of [...buckets.keys()].sort()) {
    const group = buckets.get(key)!;
    out.push({
      time: group[group.length - 1]!.time,
      open: group[0]!.open,
      high: Math.max(...group.map((g) => g.high)),
      low: Math.min(...group.map((g) => g.low)),
      close: group[group.length - 1]!.close,
      volume: group.reduce((s, g) => s + (g.volume ?? 0), 0),
    });
  }
  return out;
}

function statusWeight(status: PatternStatus | 'trend'): number {
  if (status === 'confirmed') return 1.5;
  if (status === 'breakout') return 1.2;
  if (status === 'trend') return 1.0;
  return 0.85;
}

function biasSign(type: PatternBias): number {
  if (type === 'bullish') return 1;
  if (type === 'bearish') return -1;
  return 0;
}

function strengthLabel(confidence: number): string {
  if (confidence >= 85) return 'Very Strong';
  if (confidence >= 70) return 'Strong';
  if (confidence >= 50) return 'Moderate';
  return 'Weak';
}

function weeklyTrendFrame(weeklyBars: OhlcBar[]): PatternMtfFrame {
  if (weeklyBars.length < 12) {
    return {
      timeframe: '1W',
      label: 'Weekly trend',
      pattern: null,
      type: 'neutral',
      status: 'trend',
      confidence: 50,
    };
  }
  const closes = weeklyBars.map((b) => b.close);
  const sma = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const last = closes[closes.length - 1]!;
  let type: PatternBias = 'neutral';
  let label = 'Price near weekly SMA-20';
  if (last > sma * 1.01) {
    type = 'bullish';
    label = 'Bullish trend — above weekly SMA-20';
  } else if (last < sma * 0.99) {
    type = 'bearish';
    label = 'Bearish trend — below weekly SMA-20';
  }
  const dist = Math.abs(last - sma) / sma;
  const confidence = Math.round(Math.min(78, 55 + dist * 400));
  return {
    timeframe: '1W',
    label,
    pattern: null,
    type,
    status: 'trend',
    confidence,
  };
}

function frameFromResult(timeframe: string, result: ChartPatternResult): PatternMtfFrame {
  const top = result.patterns[0];
  if (!top) {
    return {
      timeframe,
      label: `No ${timeframe} pattern`,
      pattern: null,
      type: 'neutral',
      status: 'forming',
      confidence: 45,
    };
  }
  return {
    timeframe,
    label: `${top.pattern} — ${top.status}`,
    pattern: top.pattern,
    type: top.type,
    status: top.status,
    confidence: top.confidence,
  };
}

export interface ChartPatternDetectOptions {
  /** Optional 5m bars for intraday MTF frame (5d Yahoo 5m). */
  fiveMinBars?: OhlcBar[];
  /** Optional 15m bars for intraday MTF frame (5d Yahoo 15m). */
  fifteenMinBars?: OhlcBar[];
  /** Optional 4H bars for intraday MTF frame (60d Yahoo 240m). */
  fourHourBars?: OhlcBar[];
  /** Optional 1H bars for intraday MTF frame (60d Yahoo hourly). */
  hourlyBars?: OhlcBar[];
}

export function buildPatternMtfSummary(
  daily: ChartPatternResult,
  weekly: ChartPatternResult,
  weeklyBars: OhlcBar[],
  fiveMin?: ChartPatternResult,
  fiveMinBars?: OhlcBar[],
  fifteenMin?: ChartPatternResult,
  fifteenMinBars?: OhlcBar[],
  fourHour?: ChartPatternResult,
  fourHourBars?: OhlcBar[],
  hourly?: ChartPatternResult,
  hourlyBars?: OhlcBar[],
): PatternMtfSummary {
  const dailyFrame = frameFromResult('1D', daily);
  const weeklyFrame =
    weekly.patterns.length > 0 ? frameFromResult('1W', weekly) : weeklyTrendFrame(weeklyBars);
  const frames: PatternMtfFrame[] = [dailyFrame];

  if (fiveMin !== undefined) {
    const fiveFrame =
      fiveMin.patterns.length > 0 ? frameFromResult('5m', fiveMin) : intradayTrendFrame(fiveMinBars ?? [], '5m');
    frames.push(fiveFrame);
  }
  if (fifteenMin !== undefined) {
    const fifteenFrame =
      fifteenMin.patterns.length > 0
        ? frameFromResult('15m', fifteenMin)
        : intradayTrendFrame(fifteenMinBars ?? [], '15m');
    frames.push(fifteenFrame);
  }
  if (hourly !== undefined) {
    const hourlyFrame =
      hourly.patterns.length > 0 ? frameFromResult('1H', hourly) : hourlyTrendFrame(hourlyBars ?? []);
    frames.push(hourlyFrame);
  }

  if (fourHour !== undefined) {
    const fourFrame =
      fourHour.patterns.length > 0 ? frameFromResult('4H', fourHour) : intradayTrendFrame(fourHourBars ?? [], '4H');
    frames.push(fourFrame);
  }

  frames.push(weeklyFrame);

  let score = 0;
  let weight = 0;
  for (const f of frames) {
    const w = statusWeight(f.status);
    score += biasSign(f.type) * f.confidence * w;
    weight += f.confidence * w;
  }
  const norm = weight > 0 ? score / weight : 0;
  const overall_confidence = Math.round(Math.min(95, Math.max(40, 50 + Math.abs(norm) * 45)));
  let overall_signal: PatternBias = 'neutral';
  if (norm > 0.15) overall_signal = 'bullish';
  else if (norm < -0.15) overall_signal = 'bearish';

  const typed = frames.filter((f) => f.type !== 'neutral');
  const allSame =
    typed.length >= 2 && typed.every((f) => f.type === typed[0]!.type);
  const anyConflict =
    typed.some((f) => f.type === 'bullish') && typed.some((f) => f.type === 'bearish');

  const agree = allSame ? 'aligned' : anyConflict ? 'mixed' : 'partial';
  const tfLabel =
    frames.length >= 6
      ? 'Daily, 5m/15m/1H/4H, and weekly'
      : frames.length >= 5
        ? 'Daily, 5m/15m/1H, and weekly'
        : frames.length > 2
          ? 'Daily, intraday, and weekly'
          : 'Daily and weekly';

  const detail =
    agree === 'aligned'
      ? `${tfLabel} ${overall_signal} — ${strengthLabel(overall_confidence)} confluence.`
      : agree === 'mixed'
        ? `MTF conflict across timeframes — treat as ${strengthLabel(overall_confidence)} ${overall_signal} until resolved.`
        : `Partial MTF read — ${strengthLabel(overall_confidence)} ${overall_signal} bias.`;

  return {
    overall_signal,
    overall_confidence,
    strength_label: strengthLabel(overall_confidence),
    frames,
    detail,
  };
}

export function detectChartPatterns(
  bars: OhlcBar[],
  partialConfig: Partial<PatternConfig> = {},
  detectOptions: ChartPatternDetectOptions = {},
): ChartPatternResult {
  const config = { ...DEFAULT_PATTERN_CONFIG, ...partialConfig };
  if (bars.length < config.min_pattern_bars) {
    return {
      ready: false,
      timeframe: '1D',
      patterns: [],
      swing_count: { highs: 0, lows: 0 },
      config,
      disclaimer: DISCLAIMER,
    };
  }

  const swings = detectSwingPoints(bars, config);
  const highs = swings.filter((s) => s.kind === 'high').length;
  const lows = swings.filter((s) => s.kind === 'low').length;

  const raw = [
    ...detectDoubleBottoms(bars, swings, config),
    ...detectDoubleTops(bars, swings, config),
    ...detectHeadAndShoulders(bars, swings, config, false),
    ...detectHeadAndShoulders(bars, swings, config, true),
    ...detectTrianglesAndWedges(bars, swings, config),
    ...detectFlagsAndPennants(bars, config),
    ...detectCupAndHandle(bars, swings, config),
    ...detectRoundingPatterns(bars, config, 'bottom'),
    ...detectRoundingPatterns(bars, config, 'top'),
    ...detectRectanglesAndChannels(bars, config),
  ];

  const patterns = applyPatternIndicatorConfirmation(
    bars,
    refinePatternsForAccuracy(
      bars,
      dedupePatterns(raw).sort((a, b) => {
        const rank = { confirmed: 3, breakout: 2, forming: 1, failed: 0 } as const;
        return rank[b.status] - rank[a.status] || b.confidence - a.confidence;
      }),
      config,
    )
      .sort((a, b) => {
        const rank = { confirmed: 3, breakout: 2, forming: 1, failed: 0 } as const;
        return rank[b.status] - rank[a.status] || b.confidence - a.confidence;
      })
      .slice(0, config.max_patterns),
  );

  const base: ChartPatternResult = {
    ready: true,
    timeframe: '1D',
    patterns,
    swing_count: { highs, lows },
    config,
    disclaimer: DISCLAIMER,
  };

  if (!config.skip_mtf && bars.length >= 60) {
    const weeklyBars = resampleBarsToWeekly(bars);
    if (weeklyBars.length >= 8) {
      const weekly = detectChartPatterns(weeklyBars, {
        ...partialConfig,
        skip_mtf: true,
        min_pattern_bars: 8,
        max_pattern_bars: 52,
        swing_lookback: 3,
        pole_min_pct: 0.08,
        consolidation_min_bars: 4,
        consolidation_max_bars: 14,
      });
      const fiveMinBars = detectOptions.fiveMinBars;
      const fifteenMinBars = detectOptions.fifteenMinBars;
      const fourHourBars = detectOptions.fourHourBars;
      const hourlyBars = detectOptions.hourlyBars;

      let fiveMin: ChartPatternResult | undefined;
      let fifteenMin: ChartPatternResult | undefined;
      let fourHour: ChartPatternResult | undefined;
      let hourly: ChartPatternResult | undefined;

      if (fiveMinBars && fiveMinBars.length >= 60) {
        fiveMin = detectChartPatterns(fiveMinBars, {
          ...partialConfig,
          skip_mtf: true,
          skip_backtest: true,
          min_pattern_bars: 20,
          max_pattern_bars: 80,
          swing_lookback: 2,
          pole_min_pct: 0.02,
          consolidation_min_bars: 3,
          consolidation_max_bars: 10,
          max_patterns: Math.min(partialConfig.max_patterns ?? config.max_patterns, 8),
        });
      }
      if (fifteenMinBars && fifteenMinBars.length >= 40) {
        fifteenMin = detectChartPatterns(fifteenMinBars, {
          ...partialConfig,
          skip_mtf: true,
          skip_backtest: true,
          min_pattern_bars: 18,
          max_pattern_bars: 90,
          swing_lookback: 2,
          pole_min_pct: 0.02,
          consolidation_min_bars: 3,
          consolidation_max_bars: 12,
          max_patterns: Math.min(partialConfig.max_patterns ?? config.max_patterns, 8),
        });
      }
      if (hourlyBars && hourlyBars.length >= 24) {
        hourly = detectChartPatterns(hourlyBars, {
          ...partialConfig,
          skip_mtf: true,
          skip_backtest: true,
          min_pattern_bars: 10,
          max_pattern_bars: 100,
          swing_lookback: 2,
          pole_min_pct: 0.025,
          consolidation_min_bars: 3,
          consolidation_max_bars: 10,
        });
      }
      if (fourHourBars && fourHourBars.length >= 50) {
        fourHour = detectChartPatterns(fourHourBars, {
          ...partialConfig,
          skip_mtf: true,
          skip_backtest: true,
          min_pattern_bars: 12,
          max_pattern_bars: 90,
          swing_lookback: 2,
          pole_min_pct: 0.03,
          consolidation_min_bars: 3,
          consolidation_max_bars: 12,
          max_patterns: Math.min(partialConfig.max_patterns ?? config.max_patterns, 8),
        });
      }

      base.mtf = buildPatternMtfSummary(
        base,
        weekly,
        weeklyBars,
        fiveMin,
        fiveMinBars,
        fifteenMin,
        fifteenMinBars,
        fourHour,
        fourHourBars,
        hourly,
        hourlyBars,
      );
    }
  }

  return base;
}

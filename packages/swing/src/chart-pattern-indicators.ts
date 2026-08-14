/**
 * RSI / MACD alignment for chart pattern confidence (doc §9 — up to 10% boost).
 */
import { rsi, macd, ema } from './ta-helper.js';
import type { OhlcBar } from './types.js';
import type { DetectedPattern, PatternBias } from './chart-patterns.js';

export interface IndicatorConfirmation {
  rsi14: number | null;
  macd_histogram: number | null;
  rsi_aligned: boolean;
  macd_aligned: boolean;
  score_boost: number;
}

export function patternIndicatorConfirmation(
  bias: PatternBias,
  rsi14: number | null,
  macdHist: number | null,
): IndicatorConfirmation {
  if (bias === 'neutral') {
    return {
      rsi14,
      macd_histogram: macdHist,
      rsi_aligned: false,
      macd_aligned: false,
      score_boost: 0,
    };
  }
  const bullish = bias === 'bullish';
  // Require clear momentum (not near-neutral 48/52) to cut soft false boosts.
  const rsi_aligned = rsi14 != null && (bullish ? rsi14 >= 55 : rsi14 <= 45);
  const macd_aligned =
    macdHist != null &&
    (bullish ? macdHist > 0.05 : macdHist < -0.05);
  let score_boost = 0;
  if (rsi_aligned) score_boost += 5;
  if (macd_aligned) score_boost += 5;
  return { rsi14, macd_histogram: macdHist, rsi_aligned, macd_aligned, score_boost };
}

export function applyPatternIndicatorConfirmation(
  bars: OhlcBar[],
  patterns: DetectedPattern[],
): DetectedPattern[] {
  if (!patterns.length) return patterns;
  const closes = bars.map((b) => b.close);
  const rsi14 = rsi(closes);
  const macdVal = macd(closes);
  const macdHist = macdVal?.histogram ?? null;

  return patterns.map((p) => {
    const conf = patternIndicatorConfirmation(p.type, rsi14, macdHist);
    const notes: string[] = [];
    if (conf.rsi_aligned) notes.push('RSI ✓');
    if (conf.macd_aligned) notes.push('MACD ✓');
    return {
      ...p,
      confidence: Math.min(95, p.confidence + conf.score_boost),
      rsi_confirmed: conf.rsi_aligned,
      macd_confirmed: conf.macd_aligned,
      points: {
        ...p.points,
        ...(rsi14 != null ? { rsi14 } : {}),
        ...(macdHist != null ? { macd_hist: Math.round(macdHist * 1000) / 1000 } : {}),
      },
      detail: notes.length > 0 ? `${p.detail} (${notes.join(', ')})` : p.detail,
    };
  });
}

export function intradayTrendFrame(
  bars: OhlcBar[],
  timeframe: '5m' | '15m' | '1H' | '4H',
): {
  timeframe: string;
  label: string;
  pattern: string | null;
  type: PatternBias;
  status: 'trend';
  confidence: number;
} {
  if (bars.length < 21) {
    return {
      timeframe,
      label: `${timeframe} trend`,
      pattern: null,
      type: 'neutral',
      status: 'trend',
      confidence: 50,
    };
  }
  const closes = bars.map((b) => b.close);
  const ema21 = ema(closes, 21);
  const last = closes[closes.length - 1]!;
  let type: PatternBias = 'neutral';
  let label = `Price near ${timeframe} EMA-21`;
  if (ema21 != null) {
    if (last > ema21 * 1.002) {
      type = 'bullish';
      label = `Bullish — above ${timeframe} EMA-21`;
    } else if (last < ema21 * 0.998) {
      type = 'bearish';
      label = `Bearish — below ${timeframe} EMA-21`;
    }
  }
  const ref = ema21 ?? last;
  const dist = ref > 0 ? Math.abs(last - ref) / ref : 0;
  const confidence = Math.round(Math.min(76, 52 + dist * 500));
  return {
    timeframe,
    label,
    pattern: null,
    type,
    status: 'trend',
    confidence,
  };
}

/** 1H trend fallback when no intraday pattern is detected. */
export function hourlyTrendFrame(hourlyBars: OhlcBar[]) {
  return intradayTrendFrame(hourlyBars, '1H');
}

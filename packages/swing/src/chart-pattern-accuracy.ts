/**
 * Accuracy refinements for chart patterns (doc §8–§9):
 * volume-gated confirmation, failed breakouts, trend context, min R:R, weighted confidence.
 */
import { ema, sma } from './ta-helper.js';
import type { OhlcBar } from './types.js';
import type {
  DetectedPattern,
  PatternBias,
  PatternConfig,
  PatternStatus,
} from './chart-patterns.js';

export function rewardRisk(pattern: DetectedPattern): number | null {
  const entry = pattern.breakout ?? (pattern.type === 'bullish' ? pattern.resistance : pattern.support);
  const stop = pattern.stop_loss;
  const target = pattern.target;
  if (entry == null || stop == null || target == null) return null;
  if (!(entry > 0) || !(stop > 0) || !(target > 0)) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward = Math.abs(target - entry);
  return Math.round((reward / risk) * 100) / 100;
}

/** SMA-50 / EMA-21 stack vs last close — trend context for confidence. */
export function patternTrendContext(
  bars: OhlcBar[],
  bias: PatternBias,
): { aligned: boolean; score: number; label: string } {
  if (bias === 'neutral' || bars.length < 30) {
    return { aligned: false, score: 0.35, label: 'Trend n/a' };
  }
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const sma50 = sma(closes, Math.min(50, closes.length));
  const ema21 = ema(closes, 21);
  if (sma50 == null || ema21 == null) {
    return { aligned: false, score: 0.35, label: 'Trend n/a' };
  }

  const bullishStack = last > ema21 && ema21 >= sma50 * 0.998;
  const bearishStack = last < ema21 && ema21 <= sma50 * 1.002;
  if (bias === 'bullish') {
    if (bullishStack) return { aligned: true, score: 1, label: 'Above EMA-21 / SMA-50' };
    if (last > sma50) return { aligned: true, score: 0.65, label: 'Above SMA-50' };
    if (last > ema21) return { aligned: false, score: 0.4, label: 'Above EMA-21 only' };
    return { aligned: false, score: 0.15, label: 'Counter-trend (below MAs)' };
  }
  if (bearishStack) return { aligned: true, score: 1, label: 'Below EMA-21 / SMA-50' };
  if (last < sma50) return { aligned: true, score: 0.65, label: 'Below SMA-50' };
  if (last < ema21) return { aligned: false, score: 0.4, label: 'Below EMA-21 only' };
  return { aligned: false, score: 0.15, label: 'Counter-trend (above MAs)' };
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

function volumeAtBarOk(bars: OhlcBar[], barIndex: number, lookbackStart: number, mult: number): boolean {
  if (barIndex <= 0 || barIndex >= bars.length) return false;
  const base = avgVolume(bars, lookbackStart, barIndex - 1);
  const vol = bars[barIndex]?.volume ?? 0;
  return base > 0 && vol >= base * mult;
}

function beyondClose(close: number, level: number, direction: 'above' | 'below', buffer: number): boolean {
  const buf = level * buffer;
  return direction === 'above' ? close >= level + buf : close <= level - buf;
}

function reclaimedClose(close: number, level: number, direction: 'above' | 'below', buffer: number): boolean {
  const buf = level * buffer;
  return direction === 'above' ? close < level - buf * 0.25 : close > level + buf * 0.25;
}

/** Volume on the latest confirming close, else any recent beyond-level bar. */
export function volumeConfirmedRecent(
  bars: OhlcBar[],
  level: number,
  direction: 'above' | 'below',
  buffer: number,
  mult: number,
  lookbackBars = 20,
): boolean {
  const start = Math.max(1, bars.length - lookbackBars);
  const baseStart = Math.max(0, start - 30);
  for (let j = bars.length - 1; j >= start; j--) {
    if (!beyondClose(bars[j]!.close, level, direction, buffer)) continue;
    if (volumeAtBarOk(bars, j, baseStart, mult)) return true;
  }
  // Pierce bar volume (wick) — weaker but still counts for breakout status.
  for (let j = bars.length - 1; j >= start; j--) {
    const hit = direction === 'above' ? bars[j]!.high >= level : bars[j]!.low <= level;
    if (!hit) continue;
    if (volumeAtBarOk(bars, j, baseStart, mult)) return true;
  }
  return false;
}

/**
 * Demote confirmed/breakout → failed when price closed beyond the level then reclaimed it.
 */
export function detectFailedBreakout(
  bars: OhlcBar[],
  status: PatternStatus,
  level: number,
  direction: 'above' | 'below',
  buffer: number,
): boolean {
  if (status !== 'confirmed' && status !== 'breakout') return false;
  const start = Math.max(0, bars.length - 20);
  let sawBeyond = false;
  for (let j = start; j < bars.length; j++) {
    if (beyondClose(bars[j]!.close, level, direction, buffer)) sawBeyond = true;
  }
  const last = bars[bars.length - 1]!;
  return sawBeyond && reclaimedClose(last.close, level, direction, buffer);
}

/** Doc §9 weighted confidence (geometry / breakout / volume / trend / structure). RSI/MACD adds later. */
export function scorePatternConfidence(input: {
  geometryScore: number;
  status: PatternStatus;
  volumeOk: boolean;
  trendScore: number;
  structureScore?: number;
}): number {
  const geo = Math.max(0, Math.min(1, input.geometryScore));
  const breakout =
    input.status === 'confirmed'
      ? 1
      : input.status === 'breakout'
        ? 0.55
        : input.status === 'failed'
          ? 0
          : 0.2;
  const volume = input.volumeOk ? 1 : input.status === 'forming' ? 0.35 : 0.1;
  const trend = Math.max(0, Math.min(1, input.trendScore));
  const structure = Math.max(0, Math.min(1, input.structureScore ?? 0.6));

  const raw = geo * 30 + breakout * 20 + volume * 15 + trend * 15 + structure * 10;
  let c = Math.round(raw);
  if (input.status === 'forming') c = Math.min(c, 68);
  if (input.status === 'failed') c = Math.min(c, 48);
  return Math.max(35, Math.min(90, c));
}

function estimateGeometry(pattern: DetectedPattern): number {
  const stored = Number(pattern.points.geometry_score);
  if (Number.isFinite(stored) && stored > 0) return Math.max(0, Math.min(1, stored));
  // Reverse rough geometry from prior confidenceBase scoring.
  const prior = pattern.confidence;
  const statusBump = pattern.status === 'confirmed' ? 18 : pattern.status === 'breakout' ? 8 : 0;
  const volBump = pattern.volume_confirmed ? 6 : 0;
  const geo = (prior - 55 - statusBump - volBump) / 30;
  return Math.max(0.35, Math.min(1, geo));
}

export function refinePatternsForAccuracy(
  bars: OhlcBar[],
  patterns: DetectedPattern[],
  config: PatternConfig,
): DetectedPattern[] {
  if (!patterns.length) return patterns;
  const out: DetectedPattern[] = [];

  for (const p of patterns) {
    const level = p.breakout ?? (p.type === 'bullish' ? p.resistance : p.support);
    if (level == null || !(level > 0) || p.type === 'neutral') {
      out.push(p);
      continue;
    }

    const direction: 'above' | 'below' = p.type === 'bullish' ? 'above' : 'below';
    let status: PatternStatus = p.status;

    if (detectFailedBreakout(bars, status, level, direction, config.breakout_buffer)) {
      status = 'failed';
    }

    const volumeOk = volumeConfirmedRecent(
      bars,
      level,
      direction,
      config.breakout_buffer,
      config.volume_confirmation_multiplier,
    );

    if (status === 'confirmed' && config.require_volume_for_confirm && !volumeOk) {
      status = 'breakout';
    }

    const trend = patternTrendContext(bars, p.type);
    const rr = rewardRisk({ ...p, status });
    const entry = p.breakout ?? (p.type === 'bullish' ? p.resistance : p.support);
    const target = p.target;
    const rewardPct =
      entry != null && target != null && entry > 0 ? Math.abs(target - entry) / entry : null;

    // Drop only when the measured target is essentially noise (<0.8% from entry).
    if (rewardPct != null && rewardPct < 0.008) continue;

    // Soft demote thin R:R confirms (keep structure for research; lower conviction).
    if (rr != null && rr < config.min_reward_risk && status === 'confirmed') {
      status = 'breakout';
    }

    // Strong counter-trend "confirmed" without volume — demote (likely false break).
    if (!trend.aligned && trend.score <= 0.2 && !volumeOk && status === 'confirmed') {
      status = 'breakout';
    }

    const confidence = scorePatternConfidence({
      geometryScore: estimateGeometry(p),
      status,
      volumeOk,
      trendScore: trend.score,
      structureScore: rr != null ? Math.min(1, rr / 3) : 0.55,
    });

    const notes: string[] = [];
    if (volumeOk) notes.push('Vol ✓');
    else if (status === 'confirmed' || status === 'breakout') notes.push('Vol weak');
    if (trend.aligned) notes.push('Trend ✓');
    else if (trend.score <= 0.2) notes.push('Counter-trend');
    if (rr != null) notes.push(`R:R ${rr}`);

    let detail = p.detail.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    if (status === 'failed') {
      detail = `Failed ${direction === 'above' ? 'breakout' : 'breakdown'} of ${level} — price reclaimed the level.`;
    } else if (notes.length) {
      detail = `${detail} [${notes.join(' · ')}]`;
    }

    out.push({
      ...p,
      status,
      confidence,
      volume_confirmed: volumeOk,
      points: {
        ...p.points,
        geometry_score: estimateGeometry(p),
        ...(rr != null ? { reward_risk: rr } : {}),
        trend_score: trend.score,
        trend_label: trend.label,
      },
      detail,
    });
  }

  return out;
}

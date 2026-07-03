import { macd, metricsFromBars, pctFrom52wRange, rsi, sma } from './ta-helper.js';
import type { OhlcBar, TaMetrics } from './types.js';

/** Fill TA gaps from fundamentals when Yahoo chart is partial or missing. */
export function mergeTaFundamentalFallback(
  ta: TaMetrics,
  fundamentals: { price?: number; high_52w?: number; low_52w?: number },
): TaMetrics {
  const price = Number(fundamentals.price ?? ta.ta_price ?? 0);
  const high = Number(fundamentals.high_52w ?? 0);
  const low = Number(fundamentals.low_52w ?? 0);
  const pct = pctFrom52wRange(price, low, high);

  return {
    ...ta,
    ta_price: price > 0 ? price : ta.ta_price,
    ta_pct_52w: typeof ta.ta_pct_52w === 'number' ? ta.ta_pct_52w : pct,
    ta_ready: Boolean(ta.ta_ready) || typeof pct === 'number',
    ta_source: ta.ta_source || (pct !== null ? 'fundamentals_52w' : ''),
  };
}

export function bollingerBands(closes: number[], period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const price = closes[closes.length - 1];
  if (upper <= lower) return null;
  const pct_b = ((price - lower) / (upper - lower)) * 100;
  return {
    middle: Math.round(mid * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    pct_b: Math.round(pct_b * 10) / 10,
  };
}

export function bottomOutHint(metrics: TaMetrics): {
  score: number;
  hint: boolean;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];

  const rsiVal = typeof metrics.ta_rsi14 === 'number' ? metrics.ta_rsi14 : null;
  if (rsiVal !== null) {
    if (rsiVal >= 25 && rsiVal <= 45) {
      score += 2;
      reasons.push('RSI recovery/oversold band');
    } else if (rsiVal < 25) {
      score += 1;
      reasons.push('RSI deeply oversold');
    }
  }

  const pct52 = typeof metrics.ta_pct_52w === 'number' ? metrics.ta_pct_52w : null;
  if (pct52 !== null && pct52 <= 35) {
    score += 1;
    reasons.push('near lower 52w range');
  }

  const bb = typeof metrics.ta_bb_pct_b === 'number' ? metrics.ta_bb_pct_b : null;
  if (bb !== null && bb <= 35) {
    score += 1;
    reasons.push('near lower Bollinger band');
  }

  const macdHist = typeof metrics.ta_macd_hist === 'number' ? metrics.ta_macd_hist : null;
  if (macdHist !== null && macdHist > 0) {
    score += 1;
    reasons.push('MACD histogram stabilizing');
  } else if (metrics.ta_macd_bullish === true) {
    score += 1;
    reasons.push('MACD bullish');
  }

  return { score, hint: score >= 3, reasons };
}

/** Full TA metrics for Stock Details (parity with PHP metricsForStock). */
export function enrichDetailTa(bars: OhlcBar[], price?: number): TaMetrics {
  const closes = bars.map((b) => b.close);
  const px = price && price > 0 ? price : closes.length ? closes[closes.length - 1] : 0;
  const base = metricsFromBars(bars, '', true);
  const sma20 = sma(closes, 20);
  const sma50 = typeof base.ta_sma50 === 'number' ? base.ta_sma50 : sma(closes, 50);
  const sma200 = typeof base.ta_sma200 === 'number' ? base.ta_sma200 : sma(closes, 200);
  const macdVal = closes.length ? macd(closes) : null;
  const bb = closes.length ? bollingerBands(closes) : null;

  const merged: TaMetrics = {
    ...base,
    ta_rsi14: typeof base.ta_rsi14 === 'number' ? base.ta_rsi14 : rsi(closes),
    ta_sma20: sma20,
    ta_sma50: sma50,
    ta_sma200: sma200,
    ta_above_sma20: sma20 && px > 0 ? px >= sma20 : null,
    ta_above_sma50: sma50 && px > 0 ? px >= sma50 : null,
    ta_above_sma200: sma200 && px > 0 ? px >= sma200 : null,
    ta_macd: macdVal?.line ?? null,
    ta_macd_signal: macdVal?.signal ?? null,
    ta_macd_hist: macdVal?.histogram ?? null,
    ta_macd_bullish: macdVal ? macdVal.histogram > 0 : null,
    ta_bb_mid: bb?.middle ?? null,
    ta_bb_upper: bb?.upper ?? null,
    ta_bb_lower: bb?.lower ?? null,
    ta_bb_pct_b: bb?.pct_b ?? base.ta_bb_pct_b ?? null,
    ta_below_bb_lower: bb ? bb.pct_b < 0 : null,
    ta_source: bars.length >= 50 ? 'yahoo_chart' : '',
  };

  const bottom = bottomOutHint(merged);
  merged.ta_bottom_out_score = bottom.score;
  merged.ta_bottom_out_hint = bottom.hint;
  merged.ta_bottom_out_reasons = bottom.reasons;
  return merged;
}

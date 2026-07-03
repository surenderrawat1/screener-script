import type { OhlcBar, TaMetrics } from './types.js';

const CROSS_LOOKBACK = 30;

export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

export function emaSeries(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = [ema];
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function emaSeriesIndexed(closes: number[], period: number): Map<number, number> {
  if (closes.length < period) return new Map();
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = new Map<number, number>();
  out.set(period - 1, ema);
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.set(i, ema);
  }
  return out;
}

export function ema(closes: number[], period: number): number | null {
  const series = emaSeries(closes, period);
  if (series.length === 0) return null;
  return Math.round(series[series.length - 1] * 100) / 100;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { line: number; signal: number; histogram: number } | null {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fastMap = emaSeriesIndexed(closes, fastPeriod);
  const slowMap = emaSeriesIndexed(closes, slowPeriod);
  const macdLine: number[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const fast = fastMap.get(i);
    const slow = slowMap.get(i);
    if (fast !== undefined && slow !== undefined) {
      macdLine.push(fast - slow);
    }
  }
  if (macdLine.length < signalPeriod) return null;

  const signalSeries = emaSeries(macdLine, signalPeriod);
  if (signalSeries.length === 0) return null;

  const line = macdLine[macdLine.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  if (!Number.isFinite(line) || !Number.isFinite(signal)) return null;

  return {
    line: Math.round(line * 1000) / 1000,
    signal: Math.round(signal * 1000) / 1000,
    histogram: Math.round((line - signal) * 1000) / 1000,
  };
}

export function bollinger(closes: number[], period = 20): { pct_b: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mid + 2 * std;
  const lower = mid - 2 * std;
  const price = closes[closes.length - 1];
  const pct_b = upper !== lower ? ((price - lower) / (upper - lower)) * 100 : 50;
  return { pct_b: Math.round(pct_b * 10) / 10 };
}

export function atr14(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

export function atrPct14(bars: OhlcBar[]): number | null {
  const atr = atr14(bars);
  const close = bars[bars.length - 1]?.close ?? 0;
  if (!atr || close <= 0) return null;
  return Math.round((atr / close) * 10000) / 100;
}

export function avgDailyValueCr(bars: OhlcBar[], period = 20): number | null {
  const slice = bars.slice(-Math.min(period, bars.length));
  const values: number[] = [];
  for (const bar of slice) {
    if (bar.close > 0 && bar.volume > 0) {
      values.push((bar.close * bar.volume) / 1e7);
    }
  }
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function volumeSurgeRatio(bars: OhlcBar[], period = 20): number | null {
  if (bars.length < period + 1) return null;
  const latest = bars[bars.length - 1].volume;
  const prior = bars.slice(-period - 1, -1);
  const avg =
    prior.reduce((s, b) => s + b.volume, 0) / (prior.length || 1);
  if (avg <= 0) return null;
  return Math.round((latest / avg) * 100) / 100;
}

export function pctFrom52wRange(price: number, low52: number, high52: number): number | null {
  if (price <= 0 || high52 <= low52) return null;
  return Math.round(((price - low52) / (high52 - low52)) * 1000) / 10;
}

export function rolling52WeekRange(bars: OhlcBar[], sessions = 252) {
  if (bars.length === 0) return null;
  const slice = bars.slice(-Math.min(sessions, bars.length));
  let maxHigh = 0;
  let minLow = Infinity;
  let highDate: string | null = null;
  let lowDate: string | null = null;
  for (const bar of slice) {
    if (bar.high > maxHigh) {
      maxHigh = bar.high;
      highDate = bar.time;
    }
    if (bar.low > 0 && bar.low < minLow) {
      minLow = bar.low;
      lowDate = bar.time;
    }
  }
  if (maxHigh <= 0 || minLow === Infinity) return null;
  const chart_zone =
    lowDate && highDate ? (lowDate > highDate ? 'green' : highDate > lowDate ? 'red' : null) : null;
  return { high: maxHigh, low: minLow, high_date: highDate, low_date: lowDate, chart_zone };
}

function smaLineSeries(closes: number[], times: string[], period: number) {
  const out: { time: string; value: number }[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    out.push({ time: times[i], value: slice.reduce((a, b) => a + b, 0) / period });
  }
  return out;
}

function findRecentMaCross(
  fastSeries: { time: string; value: number }[],
  slowSeries: { time: string; value: number }[],
  lookback: number,
): { type: 'golden' | 'death'; time: string } | null {
  const slowByTime = new Map(slowSeries.map((p) => [p.time, p.value]));
  const aligned: { time: string; fast: number; slow: number }[] = [];
  for (const point of fastSeries) {
    const slow = slowByTime.get(point.time);
    if (slow !== undefined) aligned.push({ time: point.time, fast: point.value, slow });
  }
  if (aligned.length < 2) return null;
  const slice = aligned.slice(-Math.max(2, lookback));
  for (let i = slice.length - 1; i >= 1; i--) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (prev.fast <= prev.slow && curr.fast > curr.slow) {
      return { type: 'golden', time: curr.time };
    }
    if (prev.fast >= prev.slow && curr.fast < curr.slow) {
      return { type: 'death', time: curr.time };
    }
  }
  return null;
}

export function maCrossoverMetrics(bars: OhlcBar[], lookback = CROSS_LOOKBACK): TaMetrics {
  if (bars.length === 0) return emptyCrossoverMetrics();
  const closes = bars.map((b) => b.close);
  const times = bars.map((b) => b.time);
  const s9 = sma(closes, 9);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const bullStack = s9 !== null && s50 !== null && s200 !== null ? s9 > s50 && s50 > s200 : null;
  const bearStack = s9 !== null && s50 !== null && s200 !== null ? s9 < s50 && s50 < s200 : null;
  const window = Math.min(closes.length, lookback + 200);
  const sliceCloses = closes.slice(-window);
  const sliceTimes = times.slice(-window);
  const sma9Tail = smaLineSeries(sliceCloses, sliceTimes, 9);
  const sma50Tail = smaLineSeries(sliceCloses, sliceTimes, 50);
  const cross950 = findRecentMaCross(sma9Tail, sma50Tail, lookback);
  const cross50200 = findRecentMaCross(
    smaLineSeries(sliceCloses, sliceTimes, 50),
    smaLineSeries(sliceCloses, sliceTimes, 200),
    lookback,
  );
  return {
    ta_golden_cross_50_200: cross50200?.type === 'golden',
    ta_death_cross_50_200: cross50200?.type === 'death',
    ta_golden_cross_9_50: cross950?.type === 'golden',
    ta_death_cross_9_50: cross950?.type === 'death',
    ta_bull_ma_stack: bullStack,
    ta_bear_ma_stack: bearStack,
    ta_cross_50_200_time: cross50200?.time ?? null,
    ta_cross_9_50_time: cross950?.time ?? null,
  };
}

function emptyCrossoverMetrics(): TaMetrics {
  return {
    ta_golden_cross_50_200: null,
    ta_death_cross_50_200: null,
    ta_golden_cross_9_50: null,
    ta_death_cross_9_50: null,
    ta_bull_ma_stack: null,
    ta_bear_ma_stack: null,
    ta_cross_50_200_time: null,
    ta_cross_9_50_time: null,
  };
}

export function emaMetricsFromCloses(closes: number[], _price: number): TaMetrics {
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const bullStack = e9 !== null && e21 !== null && e50 !== null ? e9 > e21 && e21 > e50 : null;
  const bearStack = e9 !== null && e21 !== null && e50 !== null ? e9 < e21 && e21 < e50 : null;
  return {
    ta_ema9: e9,
    ta_ema21: e21,
    ta_ema50: e50,
    ta_ema200: e200,
    ta_ema_bull_stack: bullStack,
    ta_ema_bear_stack: bearStack,
  };
}

export function metricsFromBars(bars: OhlcBar[], _symbol: string, withCrossovers = true): TaMetrics {
  const closes = bars.map((b) => b.close);
  const price = closes.length ? closes[closes.length - 1] : 0;
  const range52 = rolling52WeekRange(bars);
  const high52 = range52?.high ?? 0;
  const low52 = range52?.low ?? 0;
  const pct52w = pctFrom52wRange(price, low52, high52);
  const macdVal = closes.length ? macd(closes) : null;
  const bb = closes.length ? bollinger(closes) : null;
  const cross = withCrossovers ? maCrossoverMetrics(bars) : emptyCrossoverMetrics();
  const volRatio = volumeSurgeRatio(bars);

  return {
    ta_rsi14: rsi(closes),
    ta_sma9: sma(closes, 9),
    ta_sma50: sma(closes, 50),
    ta_sma200: sma(closes, 200),
    ta_pct_52w: pct52w,
    ta_52w_high_date: range52?.high_date ?? null,
    ta_52w_low_date: range52?.low_date ?? null,
    ta_52w_chart_zone: range52?.chart_zone ?? null,
    ta_macd_hist: macdVal?.histogram ?? null,
    ta_bb_pct_b: bb?.pct_b ?? null,
    ta_atr_pct: atrPct14(bars),
    ta_avg_value_cr: avgDailyValueCr(bars),
    ta_volume_ratio: volRatio,
    ta_bar_count: bars.length,
    ta_ready: bars.length >= 50,
    ta_price: price,
    ...emaMetricsFromCloses(closes, price),
    ...cross,
  };
}

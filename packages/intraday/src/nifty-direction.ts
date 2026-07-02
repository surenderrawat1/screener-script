import { ema, rsi, sma, maCrossoverMetrics } from '@sv/swing';
import { buildTradePlan } from './trade-plan.js';
import { classify, currentSessionBars } from './session-regime.js';
import { entryWindow, barMinutesIst, DEFAULT_MIN_ENTRY_MIN } from './session-clock.js';
import { grade as gradeSetup } from './signal-quality.js';
import { fromAnalysis as ema50FromAnalysis } from './ema50-bias.js';
import { fromAnalysis as gc9FromAnalysis } from './gc9-dc9.js';

export const INDEX_LABEL = 'Nifty 50';
export const INTERVAL = '15m';
export const REFRESH_SEC = 60;
export const INTERVALS = ['5m', '15m'] as const;
export const YAHOO_SYMBOLS = ['^NSEI', 'NIFTYBEES'];

export type IntradayBar = {
  time?: number | string;
  time_label?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type IntradayChart = {
  symbol?: string;
  yahoo?: string;
  interval?: string;
  bars: IntradayBar[];
  closes?: number[];
  index_label?: string;
  index_id?: string;
};

export function normalizeInterval(interval: string): '5m' | '15m' {
  const iv = interval.toLowerCase().trim();
  return (INTERVALS as readonly string[]).includes(iv) ? (iv as '5m' | '15m') : '15m';
}

export function analyze(chart: IntradayChart | null | undefined, interval = '15m') {
  let iv = normalizeInterval(interval);
  if (chart?.interval) iv = normalizeInterval(chart.interval);

  if (!chart?.bars?.length) {
    return emptyResult(`${iv} chart data unavailable from Yahoo Finance.`, iv);
  }

  const bars = chart.bars;
  const closes = chart.closes?.length ? chart.closes : bars.map((b) => b.close);
  const n = bars.length;
  const minBars = iv === '5m' ? 50 : 20;
  if (n < minBars) {
    return emptyResult(`Not enough ${iv} bars for direction model (need ≥ ${minBars}).`, iv);
  }

  const lastBar = bars[n - 1];
  const price = lastBar.close;
  const prevClose = closes[n - 2] ?? price;
  const barChangePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = iv === '5m' ? ema(closes, 50) : null;
  const sma9 = iv === '5m' ? sma(closes, 9) : null;
  const sma50 = iv === '5m' ? sma(closes, 50) : null;
  const crossMetrics = iv === '5m' ? maCrossoverMetrics(bars as Parameters<typeof maCrossoverMetrics>[0], 12) : {};
  const rsi14 = rsi(closes);
  const emaStackBull = ema9 !== null && ema21 !== null && price > ema9 && ema9 > ema21;
  const emaStackBear = ema9 !== null && ema21 !== null && price < ema9 && ema9 < ema21;
  const emaSlope = emaSlope9(closes);
  const structure = priceStructure(bars);

  let bull = 0;
  let bear = 0;
  const signals: Array<{ key: string; label: string; side: string }> = [];

  if (ema9 !== null && ema21 !== null) {
    if (price > ema9 && ema9 > ema21) {
      bull += 28;
      signals.push({ key: 'ema_stack', label: 'Price above rising EMA-9 > EMA-21', side: 'bull' });
    } else if (price < ema9 && ema9 < ema21) {
      bear += 28;
      signals.push({ key: 'ema_stack', label: 'Price below falling EMA-9 < EMA-21', side: 'bear' });
    } else if (price > ema21) {
      bull += 12;
      signals.push({ key: 'above_ema21', label: 'Price holding above EMA-21', side: 'bull' });
    } else if (price < ema21) {
      bear += 12;
      signals.push({ key: 'below_ema21', label: 'Price below EMA-21', side: 'bear' });
    }
  }

  if (rsi14 !== null) {
    if (rsi14 >= 58) {
      bull += 14;
      signals.push({ key: 'rsi', label: `RSI-14 ${rsi14} — bullish momentum`, side: 'bull' });
    } else if (rsi14 <= 42) {
      bear += 14;
      signals.push({ key: 'rsi', label: `RSI-14 ${rsi14} — bearish momentum`, side: 'bear' });
    } else if (rsi14 >= 50) {
      bull += 6;
      signals.push({ key: 'rsi', label: `RSI-14 ${rsi14} — mild bullish bias`, side: 'bull' });
    } else {
      bear += 6;
      signals.push({ key: 'rsi', label: `RSI-14 ${rsi14} — mild bearish bias`, side: 'bear' });
    }
  }

  if (iv === '5m' && crossMetrics.ta_golden_cross_9_50) {
    bull += 22;
    signals.push({ key: 'gc9', label: 'GC9 — SMA-9 crossed above SMA-50 on 5m', side: 'bull' });
  } else if (iv === '5m' && crossMetrics.ta_death_cross_9_50) {
    bear += 22;
    signals.push({ key: 'dc9', label: 'DC9 — SMA-9 crossed below SMA-50 on 5m', side: 'bear' });
  } else if (iv === '5m' && sma9 !== null && sma50 !== null) {
    if (sma9 > sma50) {
      bull += 10;
      signals.push({ key: 'sma9_50_bull', label: '5m SMA-9 > SMA-50 — bullish structure', side: 'bull' });
    } else if (sma9 < sma50) {
      bear += 10;
      signals.push({ key: 'sma9_50_bear', label: '5m SMA-9 < SMA-50 — bearish structure', side: 'bear' });
    }
  }

  if (n >= 5) {
    const slice = closes.slice(-4);
    const first = slice[0] ?? price;
    const net = price - first;
    if (net > 0) {
      bull += 16;
      signals.push({ key: 'recent', label: `Last 4×${iv} candles net higher`, side: 'bull' });
    } else if (net < 0) {
      bear += 16;
      signals.push({ key: 'recent', label: `Last 4×${iv} candles net lower`, side: 'bear' });
    }
  }

  const session = sessionMetrics(bars, iv);
  if (session.change_pct !== null) {
    const chg = session.change_pct;
    if (chg >= 0.25) {
      bull += 12;
      signals.push({ key: 'session', label: `Session ${fmtSignedPct(chg)}`, side: 'bull' });
    } else if (chg <= -0.25) {
      bear += 12;
      signals.push({ key: 'session', label: `Session ${fmtSignedPct(chg)}`, side: 'bear' });
    }
  }

  const net = bull - bear;
  const direction = directionFromNet(net);
  const confidence = Math.min(100, Math.max(bull, bear));
  const sessionRegime = classify(currentSessionBars(bars), iv);
  const barMin = barMinutesIst(lastBar);

  const base: Record<string, unknown> = {
    ok: true,
    index: chart.index_label ?? INDEX_LABEL,
    index_id: chart.index_id ?? 'nifty50',
    interval: iv,
    direction,
    direction_label: directionLabel(direction),
    tone: directionTone(direction),
    confidence,
    bull_score: bull,
    bear_score: bear,
    net_score: net,
    price: Math.round(price * 100) / 100,
    bar_change_pct: Math.round(barChangePct * 1000) / 1000,
    session_change_pct: session.change_pct,
    session_open: session.open,
    ema9: ema9 !== null ? Math.round(ema9 * 100) / 100 : null,
    ema21: ema21 !== null ? Math.round(ema21 * 100) / 100 : null,
    ema50: ema50 !== null ? Math.round(ema50 * 100) / 100 : null,
    sma9: sma9 !== null ? Math.round(sma9 * 100) / 100 : null,
    sma50: sma50 !== null ? Math.round(sma50 * 100) / 100 : null,
    gc9_active: Boolean(crossMetrics.ta_golden_cross_9_50),
    dc9_active: Boolean(crossMetrics.ta_death_cross_9_50),
    cross_9_50_time: crossMetrics.ta_cross_9_50_time ?? null,
    ema_stack_bull: emaStackBull,
    ema_stack_bear: emaStackBear,
    ema_slope_bull: emaSlope > 0,
    ema_slope_bear: emaSlope < 0,
    structure_bull: structure === 'bull',
    structure_bear: structure === 'bear',
    rsi14: rsi14 !== null ? Math.round(rsi14 * 10) / 10 : null,
    signals,
    summary: buildSummary(direction, confidence, signals, iv),
    as_of: lastBar.time_label ?? '',
    bar_minutes_ist: barMin,
    entry_window: entryWindow(barMin, { min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN }),
    yahoo: chart.yahoo ?? '',
    bar_count: n,
    session_regime: sessionRegime,
  };

  base.trade_plan = buildTradePlan(bars, base);
  base.setup_quality = gradeSetup(base, (base.trade_plan as Record<string, unknown>) ?? {}, null);
  if (iv === '5m') {
    base.ema50_bias = ema50FromAnalysis(base);
    base.gc9_dc9_bias = gc9FromAnalysis(base);
  }
  return base;
}

export function emptyResult(message: string, interval = '15m') {
  const iv = normalizeInterval(interval);
  return {
    ok: false,
    index: INDEX_LABEL,
    interval: iv,
    direction: 'unknown',
    direction_label: 'Unavailable',
    tone: 'neutral',
    confidence: 0,
    message,
    signals: [],
    summary: message,
    trade_plan: buildTradePlan([], { ok: false, message, interval: iv, confidence: 0 }),
  };
}

function sessionMetrics(bars: IntradayBar[], interval: string) {
  if (!bars.length) return { open: null as number | null, change_pct: null as number | null };
  const last = bars[bars.length - 1];
  const sessionDate = (last.time_label ?? '').slice(0, 10);
  let sessionBars = bars.filter((b) => (b.time_label ?? '').startsWith(sessionDate));
  if (!sessionBars.length) {
    const fallback = interval === '5m' ? 78 : 26;
    sessionBars = bars.slice(-fallback);
  }
  const open = sessionBars[0].open || sessionBars[0].close;
  const close = last.close;
  if (open <= 0 || close <= 0) return { open: null, change_pct: null };
  return { open: Math.round(open * 100) / 100, change_pct: Math.round(((close - open) / open) * 1000) / 1000 };
}

function directionFromNet(net: number): string {
  if (net >= 26) return 'bullish';
  if (net <= -26) return 'bearish';
  if (Math.abs(net) < 10) return 'sideways';
  return net > 0 ? 'lean_bull' : 'lean_bear';
}

export function directionLabel(direction: string): string {
  const labels: Record<string, string> = {
    bullish: 'Bullish',
    bearish: 'Bearish',
    lean_bull: 'Lean bullish',
    lean_bear: 'Lean bearish',
    sideways: 'Sideways / range',
    unknown: 'Unavailable',
  };
  return labels[direction] ?? 'Unavailable';
}

export function directionTone(direction: string): string {
  if (['bullish', 'lean_bull'].includes(direction)) return 'success';
  if (['bearish', 'lean_bear'].includes(direction)) return 'danger';
  if (direction === 'sideways') return 'warning';
  return 'neutral';
}

function buildSummary(direction: string, confidence: number, signals: Array<{ label: string }>, interval: string): string {
  const top = signals.slice(0, 3).map((s) => s.label).join(' · ');
  return `${directionLabel(direction)} on ${interval} (${confidence}% confidence)${top ? ` — ${top}` : ''}`;
}

function emaSlope9(closes: number[]): number {
  const e1 = ema(closes.slice(0, -1), 9);
  const e2 = ema(closes, 9);
  if (e1 === null || e2 === null) return 0;
  return e2 - e1;
}

function priceStructure(bars: IntradayBar[]): 'bull' | 'bear' | 'neutral' {
  if (bars.length < 6) return 'neutral';
  const recent = bars.slice(-6);
  const highs = recent.map((b) => b.high);
  const lows = recent.map((b) => b.low);
  const hh = highs[highs.length - 1] > highs[0];
  const hl = lows[lows.length - 1] > lows[0];
  const lh = highs[highs.length - 1] < highs[0];
  const ll = lows[lows.length - 1] < lows[0];
  if (hh && hl) return 'bull';
  if (lh && ll) return 'bear';
  return 'neutral';
}

function fmtSignedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

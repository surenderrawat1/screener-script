function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return Math.round(prev * 100) / 100;
}

export const MIN_BARS_15M = 6;
export const MIN_BARS_5M = 18;

export function currentSessionBars(bars: Array<{ time_label?: string }>) {
  if (!bars.length) return [];
  const lastLabel = String(bars[bars.length - 1].time_label ?? '');
  const sessionDate = lastLabel.slice(0, 10);
  if (!sessionDate) return bars;
  const session = bars.filter((b) => String(b.time_label ?? '').startsWith(sessionDate));
  return session.length ? session : bars;
}

export function classify(sessionBars: Record<string, unknown>[], interval = '15m') {
  const iv = interval.toLowerCase();
  const minBars = iv === '5m' ? MIN_BARS_5M : MIN_BARS_15M;
  const n = sessionBars.length;
  if (n < minBars) {
    return pack('unknown', 'Session warming up', 'neutral', 'Need more intraday bars before regime is reliable.', 0, { bars: n, min_bars: minBars });
  }

  const open = Number(sessionBars[0].open ?? 0);
  const close = Number(sessionBars[n - 1].close ?? 0);
  if (open <= 0 || close <= 0) {
    return pack('unknown', 'Insufficient OHLC', 'neutral', 'Missing session prices.', 0, {});
  }

  let high = open;
  let low = open;
  for (const bar of sessionBars) {
    high = Math.max(high, Number(bar.high ?? 0));
    low = Math.min(low, Number(bar.low ?? 0));
  }

  const rangePts = Math.max(0, high - low);
  const rangePct = (rangePts / open) * 100;
  const trendPts = close - open;
  const trendPct = (trendPts / open) * 100;
  const efficiency = rangePts > 0 ? Math.abs(trendPts) / rangePts : 0;

  const closes = sessionBars.map((b) => Number(b.close ?? 0));
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const bullStack = ema9 !== null && ema21 !== null && close > ema9 && ema9 > ema21;
  const bearStack = ema9 !== null && ema21 !== null && close < ema9 && ema9 < ema21;

  let reversals = 0;
  for (let i = 2; i < n; i++) {
    const d1 = closes[i] - closes[i - 1];
    const d0 = closes[i - 1] - closes[i - 2];
    if (d1 * d0 < 0) reversals++;
  }
  const reversalRate = n > 2 ? reversals / (n - 2) : 0;

  const orSlice = sessionBars.slice(0, Math.min(3, n));
  let orHigh = open;
  let orLow = open;
  for (const bar of orSlice) {
    orHigh = Math.max(orHigh, Number(bar.high ?? 0));
    orLow = Math.min(orLow, Number(bar.low ?? 0));
  }
  const orBreakUp = close > orHigh && trendPct > 0.08;
  const orBreakDown = close < orLow && trendPct < -0.08;

  const metrics = {
    bars: n,
    range_pct: Math.round(rangePct * 1000) / 1000,
    trend_pct: Math.round(trendPct * 1000) / 1000,
    efficiency: Math.round(efficiency * 1000) / 1000,
    reversal_rate: Math.round(reversalRate * 1000) / 1000,
  };

  if (rangePct < 0.35 && Math.abs(trendPct) < 0.12) {
    return pack('range', 'Range day', 'warning', 'Tight session range — fade extremes or stand aside.', 20, metrics);
  }
  if (reversalRate >= 0.42 && efficiency < 0.42) {
    return pack('chop', 'Choppy session', 'warning', 'Frequent reversals — trend entries have low edge.', 15, metrics);
  }
  if (efficiency >= 0.48 && trendPct >= 0.1 && (bullStack || orBreakUp)) {
    return pack('trend_up', 'Trend up day', 'success', 'Directional upside session — long setups favoured.', 85, metrics);
  }
  if (efficiency >= 0.48 && trendPct <= -0.1 && (bearStack || orBreakDown)) {
    return pack('trend_down', 'Trend down day', 'success', 'Directional downside session — short setups favoured.', 85, metrics);
  }
  if (trendPct >= 0.05) {
    return pack('lean_up', 'Mild up', 'success', 'Session leaning up — long bias with caution.', 60, metrics);
  }
  if (trendPct <= -0.05) {
    return pack('lean_down', 'Mild down', 'warning', 'Session leaning down — short bias with caution.', 60, metrics);
  }
  return pack('mixed', 'Mixed session', 'neutral', 'No clear trend — wait for structure.', 40, metrics);
}

export function gateReasons(regime: Record<string, unknown>, bias: string, options: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const key = String(regime.key ?? 'unknown');

  if (options.skip_range_regime && ['range', 'chop', 'unknown'].includes(key)) {
    reasons.push(`Session regime: ${String(regime.label ?? key)}`);
  }
  if (options.skip_warming_regime && key === 'unknown') {
    reasons.push('Session still warming up — wait past opening range');
  }
  const skipKeys = options.skip_regime_keys;
  if (Array.isArray(skipKeys) && skipKeys.includes(key)) {
    reasons.push(`Regime blocked: ${String(regime.label ?? key)}`);
  }
  if (options.require_trend_regime) {
    if (bias === 'long' && !['trend_up', 'lean_up'].includes(key)) {
      reasons.push(`Long needs trend-up session (now ${String(regime.label ?? key)})`);
    }
    if (bias === 'short' && !['trend_down', 'lean_down'].includes(key)) {
      reasons.push(`Short needs trend-down session (now ${String(regime.label ?? key)})`);
    }
  }
  const longKeys = options.regime_long_keys;
  if (Array.isArray(longKeys) && bias === 'long' && !longKeys.includes(key)) {
    reasons.push(`Long blocked in regime ${String(regime.label ?? key)}`);
  }
  const shortKeys = options.regime_short_keys;
  if (Array.isArray(shortKeys) && bias === 'short' && !shortKeys.includes(key)) {
    reasons.push(`Short blocked in regime ${String(regime.label ?? key)}`);
  }
  return reasons;
}

function pack(key: string, label: string, tone: string, message: string, score: number, metrics: Record<string, unknown>) {
  return { key, label, tone, message, score, metrics };
}

import { describe, expect, it } from 'vitest';
import { ema } from '@sv/swing';
import {
  NIFTY_DEFAULT_INTERVAL,
  NIFTY_INTRADAY_REFRESH_SEC,
  analyzeNiftyDirection,
  mtfConfluence,
  normalizeInterval,
} from './index.js';
import { INTERVALS } from './nifty-direction.js';

function buildUptrendChart(interval: '5m' | '15m') {
  const bars = [];
  const closes: number[] = [];
  let price = 23500;
  const stepSec = interval === '5m' ? 300 : 900;
  const t0 = Math.floor(Date.now() / 1000) - 3600 * 30;

  for (let i = 0; i < 55; i++) {
    price += 4 + (i % 4);
    const unix = t0 + i * stepSec;
    bars.push({
      time: unix,
      time_label: new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' '),
      open: Math.round((price - 3) * 100) / 100,
      high: Math.round((price + 5) * 100) / 100,
      low: Math.round((price - 6) * 100) / 100,
      close: Math.round(price * 100) / 100,
      volume: 1200,
    });
    closes.push(price);
  }

  return {
    symbol: 'NIFTY50',
    yahoo: '^NSEI',
    interval,
    range: '5d',
    bars,
    closes,
    ema9: ema(closes, 9) !== null ? closes.map((_, i) => ema(closes.slice(0, i + 1), 9)) : [],
    ema21: ema(closes, 21) !== null ? closes.map((_, i) => ema(closes.slice(0, i + 1), 21)) : [],
    fetched_at: new Date().toISOString(),
  };
}

describe('nifty direction parity', () => {
  it('constants match PHP Nifty15mDirection', () => {
    expect(NIFTY_DEFAULT_INTERVAL).toBe('15m');
    expect(normalizeInterval('5m')).toBe('5m');
    expect(normalizeInterval('bad')).toBe('15m');
    expect(INTERVALS).toContain('5m');
    expect(NIFTY_INTRADAY_REFRESH_SEC).toBe(60);
  });

  it('uptrend fixture analyzes bullish with trade plan', () => {
    const chart = buildUptrendChart('15m');
    const analysis = analyzeNiftyDirection(chart, '15m') as Record<string, unknown>;
    expect(analysis.ok).toBe(true);
    expect(['bullish', 'lean_bull']).toContain(String(analysis.direction));
    expect(Number(analysis.confidence ?? 0)).toBeGreaterThanOrEqual(20);
    const plan = analysis.trade_plan as Record<string, unknown>;
    expect(plan?.ok).toBe(true);
    expect(['long', 'range']).toContain(String(plan.bias));
    expect(plan.exit_rules ?? plan.exits).toBeTruthy();
    expect((plan.trigger as Record<string, unknown> | undefined)?.status).toBeTruthy();
    expect((analysis.session_regime as Record<string, unknown> | undefined)?.key).toBeTruthy();
  });

  it('5m analyze includes EMA/SMA and GC9 bias', () => {
    const chart5 = buildUptrendChart('5m');
    const analysis5 = analyzeNiftyDirection(chart5, '5m') as Record<string, unknown>;
    expect(analysis5.ok).toBe(true);
    expect(analysis5.interval).toBe('5m');
    expect(analysis5.ema50).toBeTypeOf('number');
    expect(analysis5.sma9).toBeTypeOf('number');
    expect(analysis5.sma50).toBeTypeOf('number');
    expect(analysis5.gc9_dc9_bias).toBeTypeOf('object');
  });

  it('MTF confluence summarizes both timeframes', () => {
    const chart15 = buildUptrendChart('15m');
    const chart5 = buildUptrendChart('5m');
    const analysis15 = analyzeNiftyDirection(chart15, '15m');
    const analysis5 = analyzeNiftyDirection(chart5, '5m');
    const mtf = mtfConfluence(analysis5, analysis15);
    expect(mtf.ok).toBe(true);
    expect(mtf.timeframes?.['5m']).toBeTruthy();
    expect(mtf.timeframes?.['15m']).toBeTruthy();
  });

  it('null chart returns unavailable', () => {
    const empty = analyzeNiftyDirection(null, '5m');
    expect(empty.ok).toBeFalsy();
  });
});

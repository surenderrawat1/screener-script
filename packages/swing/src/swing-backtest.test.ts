import { describe, expect, it } from 'vitest';
import {
  collectBacktestSignals,
  forwardOutcome,
  prepareBacktestBars,
  simulateExitTrades,
  type SwingBacktestSignal,
} from './swing-backtest.js';
import type { OhlcBar } from './types.js';

function makeBars(n: number, start = 100, year = 2024): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(year, 0, 1 + i));
    const open = px;
    const close = px + (i % 5 === 0 ? -2 : 1.5);
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    bars.push({
      time: d.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
    px = close;
  }
  return bars;
}

describe('prepareBacktestBars', () => {
  it('keeps last 3y tradeable window plus warmup prefix', () => {
    const bars = makeBars(1800, 100, 2020);
    const prepared = prepareBacktestBars(bars, 3, 220);
    expect(prepared.bars.length).toBeGreaterThan(220);
    expect(prepared.bars.length).toBeLessThan(bars.length);
    const firstTradeable = prepared.bars[220]?.time.slice(0, 10) ?? '';
    const end = new Date(`${prepared.chart_to}T00:00:00Z`);
    const start = new Date(`${firstTradeable}T00:00:00Z`);
    const years = (end.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(2.7);
    expect(years).toBeLessThan(3.2);
    expect(prepared.chart_from).toBe(firstTradeable);
  });
});

describe('historical regime option', () => {
  it('accepts omitted regime and still attaches entry_why when signals fire', () => {
    const bars = makeBars(400, 100, 2023);
    for (let i = 220; i < 300; i++) {
      bars[i].close = 100 + (i - 220) * 2;
      bars[i].high = bars[i].close + 1;
      bars[i].low = bars[i].close - 1;
      bars[i].open = bars[i].close;
    }
    const signals = collectBacktestSignals('TEST', bars, { min_verdict: 'ALL', warmup: 220 });
    expect(Array.isArray(signals)).toBe(true);
    for (const s of signals.slice(0, 3)) {
      expect(s.entry_why?.summary).toBeTruthy();
    }
  });
});

describe('simulateExitTrades', () => {
  it('closes on stop hit (next-bar open fill)', () => {
    const bars = makeBars(30, 100);
    // Signal @ bars[10]; fill @ bars[11] open; stop prints same fill day.
    bars[11].open = 100;
    bars[11].high = 101;
    bars[11].low = 90;
    bars[11].close = 91;
    const signals: SwingBacktestSignal[] = [
      {
        date: bars[10].time,
        price: 100,
        verdict: 'ENTER',
        strict_verdict: 'ENTER',
        rules_passed: 9,
        stop_loss: 95,
        profit_target: 115,
        r_multiple: 3,
        forward_return_pct: null,
        hit_target: false,
        hit_stop: true,
      },
    ];
    const trades = simulateExitTrades('TEST', bars, signals, { max_trades: 5 });
    expect(trades.length).toBe(1);
    expect(trades[0].exit_reason).toBe('stop');
    expect(trades[0].exit_path).toMatch(/X1/);
    expect(trades[0].exit_triggers).toContain('X1');
    expect(trades[0].exit_why.triggers).toContain('X1');
    expect(trades[0].exit_why.summary.toLowerCase()).toMatch(/stop/);
    expect(trades[0].pnl_pct).toBeLessThan(0);
    expect(trades[0].realized_r).toBeLessThan(0);
    expect(trades[0].entry_date).toBe(bars[11].time.slice(0, 10));
  });

  it('skips gap-through-stop (no fill for follower)', () => {
    const bars = makeBars(30, 100);
    bars[11].open = 94;
    bars[11].high = 95;
    bars[11].low = 90;
    bars[11].close = 92;
    const signals: SwingBacktestSignal[] = [
      {
        date: bars[10].time,
        price: 100,
        verdict: 'ENTER',
        strict_verdict: 'ENTER',
        rules_passed: 9,
        stop_loss: 95,
        profit_target: 115,
        r_multiple: 3,
        forward_return_pct: null,
        hit_target: false,
        hit_stop: true,
      },
    ];
    const trades = simulateExitTrades('TEST', bars, signals, { max_trades: 5 });
    expect(trades.length).toBe(0);
  });

  it('closes on target hit', () => {
    const bars = makeBars(30, 100);
    // Hit full 3R target on the fill bar
    bars[11].high = 120;
    bars[11].open = 100;
    bars[11].low = 99.5;
    bars[11].close = 118;
    const signals: SwingBacktestSignal[] = [
      {
        date: bars[10].time,
        price: 100,
        verdict: 'ENTER',
        strict_verdict: 'ENTER',
        rules_passed: 9,
        stop_loss: 95,
        profit_target: 115,
        r_multiple: 3,
        forward_return_pct: null,
        hit_target: true,
        hit_stop: false,
      },
    ];
    const trades = simulateExitTrades('TEST', bars, signals, {
      max_trades: 5,
      entry_slippage_bps: 0,
    });
    expect(trades.length).toBe(1);
    expect(trades[0].exit_reason).toBe('target');
    expect(trades[0].exit_path).toMatch(/T1/);
    expect(trades[0].exit_path).toMatch(/T2/);
    expect(trades[0].exit_path).toMatch(/T3/);
    // risk=5 → T1/T2/T3 = 105/110/115 → 0.4*1 + 0.4*2 + 0.2*3 = 1.8R
    expect(trades[0].realized_r).toBeCloseTo(1.8, 5);
    expect(trades[0].exit_triggers).toContain('X2');
    expect(trades[0].exit_why.triggers).toContain('X2');
    expect(trades[0].exit_why.trigger_labels.join(' ')).toMatch(/target/i);
    expect(trades[0].pnl_pct).toBeGreaterThan(0);
  });

  it('books T1 then protects runner with BE/trail (not full −1R)', () => {
    const bars = makeBars(30, 100);
    bars[11].high = 106;
    bars[11].low = 100.2;
    bars[11].open = 100;
    bars[11].close = 105;
    bars[12].high = 105;
    bars[12].low = 99;
    bars[12].open = 104;
    bars[12].close = 99.5;
    const signals: SwingBacktestSignal[] = [
      {
        date: bars[10].time,
        price: 100,
        verdict: 'ENTER',
        strict_verdict: 'ENTER',
        rules_passed: 9,
        stop_loss: 95,
        profit_target: 115,
        r_multiple: 3,
        forward_return_pct: null,
        hit_target: false,
        hit_stop: false,
      },
    ];
    const trades = simulateExitTrades('TEST', bars, signals, {
      max_trades: 5,
      entry_slippage_bps: 0,
    });
    expect(trades.length).toBe(1);
    expect(trades[0].exit_path).toMatch(/T1/);
    expect(trades[0].exit_path).toMatch(/X1/);
    // Booked T1; runner exits at BE or raised trail — better than full −1R stop.
    expect(trades[0].realized_r).toBeGreaterThan(0);
    expect(trades[0].realized_r!).toBeLessThan(1);
    expect(trades[0].pnl_pct).toBeGreaterThan(-5);
  });
});

describe('forwardOutcome', () => {
  it('uses stop-first when a daily bar crosses stop and target', () => {
    const outcome = forwardOutcome(100, 95, 115, [
      { time: '2024-01-02', open: 100, high: 120, low: 90, close: 110, volume: 1_000 },
    ]);
    expect(outcome).toEqual({ return_pct: -5, hit_target: false, hit_stop: true });
  });

  it('uses the first target fill instead of the period-end close', () => {
    const outcome = forwardOutcome(100, 95, 115, [
      { time: '2024-01-02', open: 100, high: 116, low: 99, close: 114, volume: 1_000 },
      { time: '2024-01-03', open: 114, high: 130, low: 110, close: 125, volume: 1_000 },
    ]);
    expect(outcome).toEqual({ return_pct: 15, hit_target: true, hit_stop: false });
  });
});

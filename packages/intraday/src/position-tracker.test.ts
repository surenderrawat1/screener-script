import { describe, expect, it } from 'vitest';
import {
  closedTradeMetrics,
  countIntradayExitSignals,
  evaluateIntradayPosition,
  isUrgentIntradayAction,
} from './position-tracker.js';

const basePosition = {
  id: 'abc',
  instrument_id: 'nifty50',
  instrument_label: 'Nifty 50',
  symbol: 'NIFTY50',
  side: 'long',
  timeframe: '15m',
  entry_price: 24000,
  stop_loss: 23950,
  effective_stop: 23950,
  target_t1: 24100,
  quantity: 50,
  remaining_pct: 100,
  t1_booked: false,
  t2_booked: false,
  breakeven_armed: false,
};

const bars = [
  { close: 23900, high: 23920, low: 23890, time_label: '2026-07-02 14:30' },
];

describe('evaluateIntradayPosition', () => {
  it('flags EXIT when stop is hit', () => {
    const row = evaluateIntradayPosition(basePosition, bars);
    expect(row.ok).toBe(true);
    expect(row.exit_verdict).toBe('EXIT');
    expect(row.position_action).toBe('EXIT_NOW');
    expect(row.gain_pct).toBeLessThan(0);
  });

  it('exits at session time stop', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24020, high: 24030, low: 24000, time_label: '2026-07-02 14:30' },
    ]);
    expect(row.exit_verdict).toBe('EXIT');
    expect(row.position_action).toBe('EXIT_TIME');
  });

  it('holds before time stop', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24020, high: 24030, low: 24000, time_label: '2026-07-02 10:30' },
    ]);
    expect(row.exit_verdict).toBe('HOLD');
    expect(row.position_action).toBe('HOLD');
  });

  it('detects T1 hit on an earlier bar, not only the last bar', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24120, high: 24150, low: 24080, time_label: '2026-07-02 11:00' },
      { close: 24080, high: 24090, low: 24070, time_label: '2026-07-02 11:15' },
    ]);
    expect(row.position_action).toBe('PARTIAL_T1');
  });

  it('suggests partial at T1 using bar high', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24080, high: 24120, low: 24050, time_label: '2026-07-02 11:00' },
    ]);
    expect(row.position_action).toBe('PARTIAL_T1');
  });

  it('suggests T2 only after T1 is booked', () => {
    const row = evaluateIntradayPosition(
      {
        ...basePosition,
        t1_booked: true,
        remaining_pct: 60,
        target_t2: 24200,
        target_t3: 24300,
      },
      [{ close: 24210, high: 24220, low: 24180, time_label: '2026-07-02 12:00' }],
    );
    expect(row.position_action).toBe('PARTIAL_T2');
  });

  it('exits remainder at T3', () => {
    const row = evaluateIntradayPosition(
      {
        ...basePosition,
        t1_booked: true,
        t2_booked: true,
        remaining_pct: 20,
        target_t2: 24200,
        target_t3: 24300,
      },
      [{ close: 24310, high: 24320, low: 24280, time_label: '2026-07-02 13:00' }],
    );
    expect(row.position_action).toBe('EXIT_TARGET');
    expect(row.exit_verdict).toBe('EXIT');
  });
});

describe('countIntradayExitSignals', () => {
  it('counts EXIT verdict rows', () => {
    expect(
      countIntradayExitSignals([
        { exit_verdict: 'EXIT' },
        { exit_verdict: 'HOLD' },
      ]),
    ).toBe(1);
  });
});

describe('isUrgentIntradayAction', () => {
  it('detects exit actions', () => {
    expect(isUrgentIntradayAction({ position_action: 'EXIT_NOW' })).toBe(true);
    expect(isUrgentIntradayAction({ position_action: 'HOLD' })).toBe(false);
  });
});

describe('closedTradeMetrics', () => {
  it('computes net pnl, pct, and R for a long winner', () => {
    const m = closedTradeMetrics({
      side: 'long',
      entry_price: 100,
      closed_price: 102,
      stop_loss: 99,
      quantity: 10,
    });
    expect(m).toEqual({ net_pnl: 20, net_pnl_pct: 2, r_multiple: 2 });
  });

  it('computes short winner pct from entry', () => {
    const m = closedTradeMetrics({
      side: 'short',
      entry_price: 100,
      closed_price: 97,
      stop_loss: 101,
      quantity: 5,
    });
    expect(m?.net_pnl).toBe(15);
    expect(m?.net_pnl_pct).toBe(3);
    expect(m?.r_multiple).toBe(3);
  });
});

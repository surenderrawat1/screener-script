import { describe, expect, it } from 'vitest';
import {
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

  it('holds when price is inside plan', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24020, high: 24030, low: 24000, time_label: '2026-07-02 10:30' },
    ]);
    expect(row.exit_verdict).toBe('HOLD');
    expect(row.position_action).toBe('HOLD');
  });

  it('suggests partial at T1', () => {
    const row = evaluateIntradayPosition(basePosition, [
      { close: 24110, high: 24120, low: 24100, time_label: '2026-07-02 11:00' },
    ]);
    expect(row.position_action).toBe('PARTIAL_T1');
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

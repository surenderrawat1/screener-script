import { describe, expect, it } from 'vitest';
import {
  BROKERAGE_PER_ORDER,
  computeTradePnl,
  DP_CHARGE_SELL,
  estimateFillCharges,
  STT_DELIVERY_RATE,
  summarizeOpenTradePnl,
} from './trade-pnl.js';

describe('computeTradePnl', () => {
  it('computes gross and net for a winning delivery trade', () => {
    const r = computeTradePnl(100, 110, 10);
    expect(r.gross_pnl).toBe(100);
    expect(r.charges.total).toBeGreaterThan(0);
    expect(r.net_pnl).toBeLessThan(r.gross_pnl);
    expect(r.charges.dp).toBe(DP_CHARGE_SELL);
    expect(r.charges.brokerage).toBe(BROKERAGE_PER_ORDER * 2);
    expect(r.charges.stt).toBe(Math.round((1000 + 1100) * STT_DELIVERY_RATE * 100) / 100);
  });

  it('charges intraday STT on sell only', () => {
    const buy = estimateFillCharges({ notional: 100_000, side: 'buy', settlement: 'intraday' });
    const sell = estimateFillCharges({ notional: 100_000, side: 'sell', settlement: 'intraday' });
    expect(buy.stt).toBe(0);
    expect(sell.stt).toBe(25);
    expect(buy.stamp).toBe(3);
    expect(sell.stamp).toBe(0);
    expect(sell.dp).toBe(0);
  });

  it('summarizes open book', () => {
    const s = summarizeOpenTradePnl([
      { entry_price: 100, current_price: 105, shares: 10 },
      { entry_price: 200, current_price: 195, shares: 5 },
    ]);
    expect(s.count).toBe(2);
    expect(s.invested).toBe(2000);
    expect(s.net_pnl).toBeLessThan(s.gross_pnl);
  });
});

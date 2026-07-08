import { describe, expect, it } from 'vitest';
import { computeTradePnl, DP_CHARGE_SELL, summarizeOpenTradePnl } from './trade-pnl.js';

describe('computeTradePnl', () => {
  it('computes gross and net for a winning trade', () => {
    const r = computeTradePnl(100, 110, 10);
    expect(r.gross_pnl).toBe(100);
    expect(r.charges.total).toBeGreaterThan(0);
    expect(r.net_pnl).toBeLessThan(r.gross_pnl);
    expect(r.charges.dp).toBe(DP_CHARGE_SELL);
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

import { describe, expect, it } from 'vitest';
import {
  applyPortfolioGates,
  canOpenPosition,
  canOpenSectorConcentration,
  DEFAULT_PORTFOLIO_NAV,
  MAX_OPEN_POSITIONS,
  MAX_SECTOR_NOTIONAL_PCT,
  resolvePositionSector,
  type PortfolioGateTrade,
} from './portfolio-risk.js';

function trade(
  symbol: string,
  entry: string,
  exit: string,
  price: number,
  stop: number,
  shares = 100,
): PortfolioGateTrade {
  return {
    symbol,
    entry_date: entry,
    exit_date: exit,
    entry_price: price,
    stop_loss: stop,
    shares,
    status: 'closed',
  };
}

describe('applyPortfolioGates', () => {
  it('accepts non-overlapping trades', () => {
    const trades = [
      trade('AAA', '2024-01-01', '2024-01-10', 100, 95, 50),
      trade('BBB', '2024-01-15', '2024-01-25', 200, 190, 50),
    ];
    const gated = applyPortfolioGates(trades, DEFAULT_PORTFOLIO_NAV, 15_000);
    expect(gated.accepted).toBe(2);
    expect(gated.blocked).toBe(0);
  });

  it('blocks when max open positions exceeded', () => {
    const trades: PortfolioGateTrade[] = [];
    for (let i = 0; i < MAX_OPEN_POSITIONS + 2; i++) {
      // Tiny risk so heat does not block first — only count gate
      trades.push(
        trade(`S${i}`, '2024-01-01', '2024-06-01', 1000, 999, 1),
      );
    }
    const gated = applyPortfolioGates(trades, DEFAULT_PORTFOLIO_NAV, 15_000);
    expect(gated.accepted).toBe(MAX_OPEN_POSITIONS);
    expect(gated.blocked).toBe(2);
  });

  it('blocks when portfolio heat would exceed cap', () => {
    // Each trade: entry 100, stop 95 → ₹5 risk/share × 100 shares = ₹500 = 0.5% of 1L NAV
    // Fill book until heat ≥ 4% blocks further adds
    const nav = 100_000;
    const trades: PortfolioGateTrade[] = [];
    for (let i = 0; i < 12; i++) {
      trades.push(trade(`H${i}`, '2024-01-01', '2024-12-01', 100, 95, 100));
    }
    const gated = applyPortfolioGates(trades, nav, 10_000);
    expect(gated.accepted).toBeLessThan(12);
    expect(gated.blocked).toBeGreaterThan(0);
    expect(gated.accepted + gated.blocked).toBe(12);
  });

  it('frees heat after exit so later entries can open', () => {
    // ~0.4% risk each — under 1% per-trade cap; sequential so heat never stacks
    const trades = [
      trade('AAA', '2024-01-01', '2024-01-10', 100, 90, 40),
      trade('BBB', '2024-01-11', '2024-01-20', 100, 90, 40),
    ];
    const gated = applyPortfolioGates(trades, 100_000, 4_000);
    expect(gated.accepted).toBe(2);
    expect(gated.blocked).toBe(0);
  });
});

describe('sector concentration', () => {
  it('blocks when one sector would exceed 25% notional', () => {
    const nav = 100_000;
    // Two IT names at ₹20k each = 40% — third IT at ₹10k should block
    const open = [
      { symbol: 'TCS', entry_price: 100, stop_loss: 95, shares: 200 },
      { symbol: 'INFY', entry_price: 100, stop_loss: 95, shares: 200 },
    ];
    const gate = canOpenSectorConcentration(open, 'it', 10_000, nav);
    expect(gate.ok).toBe(false);
    expect(gate.sector_after_pct).toBeGreaterThan(MAX_SECTOR_NOTIONAL_PCT);
  });

  it('allows add in another sector under the cap', () => {
    const nav = 100_000;
    const open = [
      { symbol: 'TCS', entry_price: 100, stop_loss: 95, shares: 200 },
      { symbol: 'INFY', entry_price: 100, stop_loss: 95, shares: 200 },
    ];
    const gate = canOpenSectorConcentration(open, 'pharma', 10_000, nav);
    expect(gate.ok).toBe(true);
    expect(gate.sector_after_pct).toBe(10);
  });

  it('resolves banking from NSE hint when sector missing', () => {
    expect(resolvePositionSector({ symbol: 'HDFCBANK' })).toBe('banking');
    expect(resolvePositionSector({ symbol: 'TCS' })).toBe('it');
  });

  it('canOpenPosition enforces sector cap when shares sized', () => {
    const nav = 100_000;
    const open = [
      { symbol: 'TCS', entry_price: 100, stop_loss: 95, shares: 200 },
      { symbol: 'INFY', entry_price: 100, stop_loss: 95, shares: 200 },
    ];
    const blocked = canOpenPosition(open, 100, 95, nav, 50, { sector: 'it' });
    expect(blocked.ok).toBe(false);
    expect(String(blocked.reason)).toMatch(/Sector it/i);

    const ok = canOpenPosition(open, 100, 95, nav, 50, { sector: 'defence' });
    expect(ok.ok).toBe(true);
  });
});

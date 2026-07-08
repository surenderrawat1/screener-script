import { describe, expect, it } from 'vitest';
import { summarizeClosedSwingPositions } from './auto-screener.js';
import { computeTradePnl } from './trade-pnl.js';

type ClosedFixture = {
  symbol: string;
  entry_price: number;
  closed_price: number;
  shares: number;
  stop_loss: number;
};

function expectJournalMatchesNet(closed: ClosedFixture[]) {
  const stats = summarizeClosedSwingPositions(closed);
  const expectedNet = closed.reduce(
    (sum, row) => sum + computeTradePnl(row.entry_price, row.closed_price, row.shares).net_pnl,
    0,
  );
  const wins = closed.filter(
    (row) => computeTradePnl(row.entry_price, row.closed_price, row.shares).net_pnl > 0,
  ).length;
  const losses = closed.filter(
    (row) => computeTradePnl(row.entry_price, row.closed_price, row.shares).net_pnl < 0,
  ).length;

  expect(stats.with_pnl).toBe(closed.length);
  expect(stats.wins).toBe(wins);
  expect(stats.losses).toBe(losses);
  expect(stats.total_net_pnl).toBe(Math.round(expectedNet * 100) / 100);
}

describe('summarizeClosedSwingPositions', () => {
  it('uses charge-aware net P&L for journal stats', () => {
    const closed: ClosedFixture[] = [
      {
        symbol: 'TCS',
        entry_price: 100,
        closed_price: 110,
        shares: 10,
        stop_loss: 95,
      },
      {
        symbol: 'INFY',
        entry_price: 200,
        closed_price: 190,
        shares: 5,
        stop_loss: 190,
      },
    ];

    const stats = summarizeClosedSwingPositions(closed);
    const expectedNet =
      computeTradePnl(100, 110, 10).net_pnl + computeTradePnl(200, 190, 5).net_pnl;

    expect(stats.with_pnl).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.total_net_pnl).toBe(Math.round(expectedNet * 100) / 100);
    expect(stats.total_net_pnl).toBeLessThan(10 * 10 + 5 * -10); // less than gross-only sum
  });

  it('handles single winner with fractional shares', () => {
    expectJournalMatchesNet([
      {
        symbol: 'RELIANCE',
        entry_price: 2450.5,
        closed_price: 2510.25,
        shares: 3,
        stop_loss: 2380,
      },
    ]);
  });

  it('handles mixed batch including breakeven after charges', () => {
    const closed: ClosedFixture[] = [
      {
        symbol: 'HDFCBANK',
        entry_price: 1650,
        closed_price: 1680,
        shares: 8,
        stop_loss: 1600,
      },
      {
        symbol: 'WIPRO',
        entry_price: 450,
        closed_price: 448,
        shares: 20,
        stop_loss: 430,
      },
      {
        symbol: 'SBIN',
        entry_price: 620,
        closed_price: 595,
        shares: 15,
        stop_loss: 600,
      },
    ];

    expectJournalMatchesNet(closed);
    const stats = summarizeClosedSwingPositions(closed);
    expect(stats.with_pnl).toBe(3);
  });
});

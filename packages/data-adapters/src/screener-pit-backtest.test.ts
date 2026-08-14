import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runScreenerPitBacktest } from './screener-pit-backtest.js';

// Mock historical bars + TA enrichment so PIT logic is deterministic.
vi.mock('./swing-chart.js', () => {
  return {
    fetchDailyBars: vi.fn(async (_symbol: string, _refresh?: boolean) => {
      // 0..299 close; close is strictly increasing so forward return math is stable.
      return Array.from({ length: 300 }).map((_, idx) => ({
        time: String(idx),
        open: idx + 1,
        high: idx + 2,
        low: idx,
        close: idx + 1,
        volume: 1000,
      }));
    }),
  };
});

vi.mock('@sv/swing', async () => {
  const actual = (await vi.importActual<any>('@sv/swing')) as any;
  return {
    ...actual,
    enrichDetailTa: vi.fn((bars: any[]) => {
      return {
        ta_ready: true,
        ta_rsi14: 35,
        ta_pct_52w: 30,
        ta_macd_bullish: true,
        ta_above_sma50: true,
        ta_above_sma200: true,
        ta_bb_pct_b: 20,
        ta_bottom_out_hint: true,
        ta_bottom_out_score: 4,
        ta_52w_chart_zone: 'green',
        ta_golden_cross_50_200: true,
        // Preserve length-derived signals if needed later.
        _bars_len: bars.length,
      };
    }),
    // Make sure hourly TA filters never activate in the test.
    needsHourlyTaFilters: vi.fn(() => false),
  };
});

describe('screener-pit-backtest (MVP TA-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes asOf/forward indexing and forward_return_pct correctly', async () => {
    const res = await runScreenerPitBacktest({
      symbols: ['ABC'],
      asOfDaysAgo: 10,
      forwardDays: 5,
      // Keep filters trivial: PIT forces show_ta=true internally and ta gate passes.
      filters: { show_ta: true },
      maxScan: 1,
      refresh: false,
    });

    expect(res.ok).toBe(true);
    expect(res.total_symbols).toBe(1);
    expect(res.rows).toHaveLength(1);

    const row = res.rows[0];
    // Last close = 300; asOfDaysAgo=10 => close index 289 => close=290
    expect(row.price_as_of).toBe(290);

    // forwardDays=5 => forward close index 294 => close=295
    const expectedFwdPct = ((295 - 290) / 290) * 100;
    expect(row.forward_return_pct).toBeCloseTo(expectedFwdPct, 6);
    expect(row.passed).toBe(true);
  });

  it('marks row as failed when forward index exceeds available bars', async () => {
    const res = await runScreenerPitBacktest({
      symbols: ['ABC'],
      asOfDaysAgo: 10,
      forwardDays: 295, // forwardDays > asOfDaysAgo => fwdIdx exceeds lastIdx
      filters: { show_ta: true },
      maxScan: 1,
      refresh: false,
    });

    const row = res.rows[0];
    expect(row.passed).toBe(false);
    expect(row.price_as_of).toBeNull(); // PIT MVP returns null when window invalid
    expect(row.forward_return_pct).toBeNull();
  });
});


import { describe, expect, it } from 'vitest';
import { buildScanSummary, scanSymbols } from './scanner.js';
import type { SymbolContext } from './types.js';

describe('buildScanSummary', () => {
  it('counts strict ENTER, discovery ENTER, and SETUP', () => {
    const summary = buildScanSummary(
      [
        { symbol: 'A', strict_verdict: 'ENTER', verdict: 'ENTER', entry_score: 90, rules_passed: 10, price: 100, stop_loss: null, profit_target: null, r_multiple: 2, r_multiple_ok: true, ta_avg_value_cr: 10 },
        { symbol: 'B', strict_verdict: 'WATCH', verdict: 'ENTER', entry_score: 80, rules_passed: 9, price: 100, stop_loss: null, profit_target: null, r_multiple: 2, r_multiple_ok: true, ta_avg_value_cr: 10 },
        { symbol: 'C', strict_verdict: 'WATCH', verdict: 'SETUP', entry_score: 70, rules_passed: 8, price: 100, stop_loss: null, profit_target: null, r_multiple: 2, r_multiple_ok: true, ta_avg_value_cr: 10 },
      ],
      'SETUP_PLUS',
      { no_chart: 16, universe_size: 499, scanned: 499 },
    );
    expect(summary.strict_enter).toBe(1);
    expect(summary.discovery_enter).toBe(2);
    expect(summary.setup).toBe(1);
    expect(summary.filter_label).toBe('SETUP+');
    expect(summary.no_chart).toBe(16);
    expect(summary.full_universe).toBe(true);
  });
});

describe('scanSymbols sort', () => {
  const baseCtx = (symbol: string, rsi: number, pct52w: number): SymbolContext => ({
    symbol,
    bars: Array.from({ length: 60 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1_000_000,
    })),
    ta: {
      ta_ready: true,
      ta_price: 100,
      ta_rsi14: rsi,
      ta_pct_52w: pct52w,
      ta_52w_chart_zone: 'mid',
      ta_avg_value_cr: 20,
    },
  });

  it('sorts rsi low first', () => {
    const hits = scanSymbols([baseCtx('LOW', 40, 50), baseCtx('HIGH', 70, 50)], {
      min_verdict: 'ALL',
      sort_by: 'rsi',
    }).hits;
    expect(hits.map((h) => h.symbol)).toEqual(['LOW', 'HIGH']);
  });

  it('sorts pct_52w low first', () => {
    const hits = scanSymbols([baseCtx('LOW', 50, 20), baseCtx('HIGH', 50, 80)], {
      min_verdict: 'ALL',
      sort_by: 'pct_52w',
    }).hits;
    expect(hits.map((h) => h.symbol)).toEqual(['LOW', 'HIGH']);
  });
});

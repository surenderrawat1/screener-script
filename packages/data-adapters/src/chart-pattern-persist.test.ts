import { describe, expect, it } from 'vitest';
import {
  patternDetectionRowsFromResult,
  buildChartPatternsMorningPanel,
  scanRunToApi,
  inboxSignalsFromChartPatterns,
  aggregatePatternBacktestStats,
} from './chart-pattern-persist.js';
import type { DetectedPattern } from '@sv/swing';

function samplePattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    id: 'rectangle:2024-01-01:2024-03-01',
    pattern: 'Rectangle',
    kind: 'rectangle',
    type: 'neutral',
    status: 'forming',
    confidence: 72,
    timeframe: '1D',
    start_date: '2024-01-01',
    end_date: '2024-03-01',
    support: 92,
    resistance: 108,
    breakout: 108,
    target: 124,
    stop_loss: 90,
    volume_confirmed: false,
    rsi_confirmed: true,
    macd_confirmed: false,
    points: { width: 16 },
    detail: 'Range forming.',
    ...overrides,
  };
}

describe('chart pattern persistence', () => {
  it('maps detected patterns to normalized DB rows', () => {
    const rows = patternDetectionRowsFromResult([samplePattern()], {
      symbol: 'TCS',
      scanDate: '2026-08-12',
      lastBarDate: '2026-08-11',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pattern_key: 'rectangle:2024-01-01:2024-03-01',
      pattern: 'Rectangle',
      kind: 'rectangle',
      status: 'forming',
      confidence: 72,
      last_bar_date: '2026-08-11',
      support: 92,
      resistance: 108,
      rsi_confirmed: true,
      macd_confirmed: false,
    });
  });

  it('preserves multiple patterns with distinct keys', () => {
    const rows = patternDetectionRowsFromResult(
      [
        samplePattern({ id: 'a:1:2', kind: 'double_bottom' }),
        samplePattern({ id: 'b:3:4', kind: 'bull_flag', pattern: 'Bull Flag' }),
      ],
      { symbol: 'INFY', scanDate: '2026-08-12', lastBarDate: '2026-08-11' },
    );
    expect(rows.map((r) => r.pattern_key)).toEqual(['a:1:2', 'b:3:4']);
  });

  it('builds morning panel summary from scan stats', () => {
    const panel = buildChartPatternsMorningPanel({
      scan_date: '2026-08-12',
      pattern_count: 42,
      breakout_count: 5,
      confirmed_count: 3,
      forming_count: 28,
      hits: [
        {
          symbol: 'TCS',
          pattern: 'Ascending Triangle',
          kind: 'ascending_triangle',
          type: 'bullish',
          status: 'breakout',
          confidence: 78,
          timeframe: '1D',
        },
      ],
    });
    expect(panel.available).toBe(true);
    expect(panel.breakout_count).toBe(5);
    expect(panel.hits[0]?.symbol).toBe('TCS');
    expect(panel.href).toContain('/patterns');
  });

  it('maps scan run rows to API view', () => {
    const view = scanRunToApi({
      runDate: '2026-08-12',
      trigger: 'admin',
      symbolsTotal: 500,
      symbolsOk: 498,
      symbolsFailed: 2,
      patternsFound: 120,
      durationMs: 45000,
      status: 'partial',
      error: '2 symbol(s) failed',
      createdAt: new Date('2026-08-12T06:35:00.000Z'),
    });
    expect(view).toMatchObject({
      run_date: '2026-08-12',
      trigger: 'admin',
      symbols_total: 500,
      patterns_found: 120,
      status: 'partial',
    });
  });

  it('maps breakout hits to inbox entry signals', () => {
    const panel = buildChartPatternsMorningPanel({
      scan_date: '2026-08-13',
      pattern_count: 10,
      breakout_count: 1,
      confirmed_count: 1,
      forming_count: 1,
      hits: [
        {
          symbol: 'TCS',
          pattern: 'Ascending Triangle',
          kind: 'ascending_triangle',
          type: 'bullish',
          status: 'breakout',
          confidence: 81,
          timeframe: '1D',
        },
        {
          symbol: 'INFY',
          pattern: 'Rectangle',
          kind: 'rectangle',
          type: 'neutral',
          status: 'forming',
          confidence: 68,
          timeframe: '1D',
        },
      ],
    });
    const signals = inboxSignalsFromChartPatterns(panel);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      book: 'pattern',
      side: 'entry',
      symbol: 'TCS',
      high_conviction: true,
      urgency: 'ok',
    });
    expect(signals[1]).toMatchObject({
      side: 'review',
      symbol: 'INFY',
      high_conviction: false,
      urgency: 'info',
    });
    expect(signals[0]?.source_href).toContain('TCS');
  });

  it('aggregates per-symbol backtest stats by pattern kind', () => {
    const kinds = aggregatePatternBacktestStats([
      {
        kind: 'ascending_triangle',
        label: 'Ascending Triangle',
        timeframe: '1D',
        occurrences: 4,
        confirmed_breakouts: 2,
        target_hits: 1,
        stop_hits: 1,
        unresolved: 0,
        success_rate_pct: 50,
        avg_return_pct: 2.5,
        avg_mfe_pct: 4,
        avg_mae_pct: -2,
      },
      {
        kind: 'ascending_triangle',
        label: 'Ascending Triangle',
        timeframe: '1D',
        occurrences: 2,
        confirmed_breakouts: 1,
        target_hits: 1,
        stop_hits: 0,
        unresolved: 0,
        success_rate_pct: 100,
        avg_return_pct: 5,
        avg_mfe_pct: 6,
        avg_mae_pct: -1,
      },
      {
        kind: 'rectangle',
        label: 'Rectangle',
        timeframe: '1D',
        occurrences: 3,
        confirmed_breakouts: 1,
        target_hits: 0,
        stop_hits: 1,
        unresolved: 1,
        success_rate_pct: 0,
        avg_return_pct: -1.5,
        avg_mfe_pct: 2,
        avg_mae_pct: -3,
      },
    ]);

    expect(kinds).toHaveLength(2);
    const tri = kinds.find((k) => k.kind === 'ascending_triangle');
    expect(tri).toMatchObject({
      symbol_samples: 2,
      occurrences: 6,
      confirmed_breakouts: 3,
      target_hits: 2,
      stop_hits: 1,
      success_rate_pct: 66.7,
    });
    expect(tri?.avg_return_pct).toBeCloseTo(3.3, 1);
  });
});

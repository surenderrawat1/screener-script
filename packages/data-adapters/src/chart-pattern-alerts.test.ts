import { describe, expect, it } from 'vitest';
import { alertsFromChartPatternHits } from './chart-pattern-alerts.js';
import { formatSignalEmailSubject } from './signal-alerts.js';

describe('chart pattern alerts', () => {
  it('maps breakout/confirmed hits and skips forming', () => {
    const alerts = alertsFromChartPatternHits(
      [
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
          symbol: 'ITC',
          pattern: 'Rectangle',
          kind: 'rectangle',
          type: 'neutral',
          status: 'forming',
          confidence: 70,
          timeframe: '1D',
        },
        {
          symbol: 'INFY',
          pattern: 'Double Bottom',
          kind: 'double_bottom',
          type: 'bullish',
          status: 'confirmed',
          confidence: 76,
          timeframe: '1D',
        },
      ],
      '2026-08-13',
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({
      book: 'pattern',
      side: 'entry',
      symbol: 'TCS',
      action: 'BREAKOUT',
    });
    expect(alerts[1]?.action).toBe('CONFIRMED');
    expect(formatSignalEmailSubject(alerts)).toContain('chart patterns');
    expect(formatSignalEmailSubject(alerts)).toContain('TCS');
  });
});

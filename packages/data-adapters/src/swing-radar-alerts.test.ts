import { describe, expect, it } from 'vitest';
import {
  alertsFromSwingRadarHits,
  highConvictionAdditions,
} from './swing-radar-alerts.js';
import { formatSignalEmailBody, formatSignalEmailSubject } from './signal-alerts.js';
import type { SwingAutoSnapshot } from '@sv/swing';

function snap(hc: Array<Record<string, unknown>>): SwingAutoSnapshot {
  return {
    saved_at: new Date().toISOString(),
    last_full_scan_at: new Date().toISOString(),
    rotate_offset: 0,
    scan: {},
    tiers: { high_conviction: hc, strict_enter: [], setup_radar: [], breakout_surge: [] },
    summary: {},
  };
}

describe('swing-radar-alerts', () => {
  it('builds High Conviction radar alerts with trade plan fields', () => {
    const alerts = alertsFromSwingRadarHits(
      [
        {
          symbol: 'TCS',
          company_name: 'Tata Consultancy',
          price: 4100,
          stop_loss: 3950,
          profit_target: 4500,
          r_multiple: 3.2,
          decision_score: 12,
          decision_action: 'BUY',
          decision_label: 'Buy',
          backtest_truth: { win_rate_pct: 72, expectancy_r: 0.45, profit_factor: 1.8 },
        },
      ],
      { dayKey: '2026-08-10', regimeLabel: 'Neutral' },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      book: 'swing',
      side: 'entry',
      symbol: 'TCS',
      name: 'Tata Consultancy',
      action: 'HIGH_CONVICTION',
      price: 4100,
      stop_loss: 3950,
      target_t3: 4500,
    });
    expect(alerts[0].id).toBe('swing-radar:2026-08-10:TCS');
    expect(alerts[0].detail).toContain('High Conviction');
    expect(alerts[0].detail).toContain('Neutral');
    expect(formatSignalEmailSubject(alerts)).toContain('SWING SIGNAL: Tata Consultancy');
    const body = formatSignalEmailBody(alerts);
    expect(body.text).toContain('SWING SIGNAL');
    expect(body.text).toContain('Tata Consultancy');
    expect(body.text).toContain('Stop:');
  });

  it('skips hits without symbols', () => {
    expect(alertsFromSwingRadarHits([{ price: 100 }])).toHaveLength(0);
  });

  it('detects HOT tier additions vs previous snapshot', () => {
    const previous = snap([{ symbol: 'TCS' }, { symbol: 'INFY' }]);
    const current = snap([{ symbol: 'TCS' }, { symbol: 'RELIANCE' }, { symbol: 'INFY' }]);
    const added = highConvictionAdditions(current, previous);
    expect(added.map((h) => h.symbol)).toEqual(['RELIANCE']);
  });

  it('treats first snapshot as all additions', () => {
    const current = snap([{ symbol: 'TCS' }, { symbol: 'INFY' }]);
    expect(highConvictionAdditions(current, null)).toHaveLength(2);
  });
});

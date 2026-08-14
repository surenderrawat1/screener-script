import { describe, expect, it } from 'vitest';
import {
  evaluateOpsAlerts,
  OPS_PRICE_GAP_PCT,
  OPS_STALE_SNAPSHOT_SEC,
  summarizeOpsAlerts,
} from './ops-alerts.js';
import { NSE_PHASE } from './nse-session.js';

const openNse = { phase: NSE_PHASE.OPEN, label: 'Open', live_quotes: true };
const closedNse = { phase: NSE_PHASE.POST, label: 'Closed', live_quotes: false };

describe('evaluateOpsAlerts', () => {
  it('flags missing worker as critical during open session', () => {
    const alerts = evaluateOpsAlerts({
      nse: openNse,
      worker_ok: false,
      swing_snapshot_at: new Date().toISOString(),
    });
    expect(alerts.some((a) => a.id === 'worker_down' && a.severity === 'critical')).toBe(true);
  });

  it('flags stale swing snapshot during open session', () => {
    const staleAt = new Date(Date.now() - (OPS_STALE_SNAPSHOT_SEC + 60) * 1000).toISOString();
    const alerts = evaluateOpsAlerts({
      nse: openNse,
      worker_ok: true,
      swing_snapshot_at: staleAt,
      swing_paper_armed: true,
    });
    const stale = alerts.find((a) => a.id === 'swing_snapshot_stale');
    expect(stale?.severity).toBe('critical');
  });

  it('reports rejected writes', () => {
    const alerts = evaluateOpsAlerts({
      nse: closedNse,
      worker_ok: true,
      rejected_orders_24h: 2,
      rejected_order_samples: ['TCS: cash', 'INFY: heat'],
    });
    expect(alerts.some((a) => a.category === 'rejected_write')).toBe(true);
  });

  it('reports abnormal price gaps above floor', () => {
    const alerts = evaluateOpsAlerts({
      nse: openNse,
      worker_ok: true,
      swing_snapshot_at: new Date().toISOString(),
      price_gaps: [
        { symbol: 'HAL', gap_pct: OPS_PRICE_GAP_PCT + 0.5, live: 5000, reference: 4700, reference_label: 'entry' },
      ],
    });
    expect(alerts.some((a) => a.id === 'price_gap:HAL')).toBe(true);
    expect(summarizeOpsAlerts(alerts).warn + summarizeOpsAlerts(alerts).critical).toBeGreaterThan(0);
  });

  it('is quiet when healthy outside session', () => {
    const alerts = evaluateOpsAlerts({
      nse: closedNse,
      worker_ok: true,
      rejected_orders_24h: 0,
      price_gaps: [],
    });
    expect(alerts).toHaveLength(0);
    expect(summarizeOpsAlerts(alerts).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { nseSession } from '@sv/shared';
import {
  buildAlerts,
  intradayPositionsPanel,
  routineSteps,
  swingPositionsPanel,
  tradingPresetIds,
} from '@sv/swing';
import { shouldRevalidateEtfPanel } from './morning-bundle.js';

describe('morning dashboard parity', () => {
  const session = nseSession(new Date('2026-07-06T05:00:00Z'));

  it('has checklist steps', () => {
    const steps = routineSteps(
      session,
      { open: 2, exit_count: 1 },
      { open: 0, exit_count: 0 },
      { hits: [{ symbol: 'NIFTYBEES' }], hit_count: 1 },
      { available: false, hits: [] },
    );
    expect(steps.length).toBeGreaterThanOrEqual(6);
    const swingStep = steps.find((s) => s.step.toLowerCase().includes('swing positions'));
    expect(swingStep?.status).toBe('warn');
  });

  it('builds swing and intraday panels for alerts', () => {
    const swing = swingPositionsPanel([
      {
        id: 'a',
        symbol: 'TCS',
        exit_verdict: 'EXIT',
        gain_pct: -1,
        current_price: 3900,
        exit_triggers: ['stop'],
      },
    ]);
    const intraday = intradayPositionsPanel([]);
    const alerts = buildAlerts(swing, intraday);
    expect(alerts.some((a) => a.includes('swing'))).toBe(true);
    expect(swing.exit_count).toBe(1);
  });

  it('ships three trading presets for morning chips', () => {
    expect(tradingPresetIds()).toHaveLength(3);
  });

  it('flags ETF panel for background revalidate when cache is old', () => {
    const old = new Date(Date.now() - 9 * 60_000).toISOString();
    expect(shouldRevalidateEtfPanel({ from_cache: true, cached_at: old })).toBe(true);
    const fresh = new Date(Date.now() - 60_000).toISOString();
    expect(shouldRevalidateEtfPanel({ from_cache: true, cached_at: fresh })).toBe(false);
  });
});

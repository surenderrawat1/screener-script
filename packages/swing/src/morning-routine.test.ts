import { describe, expect, it } from 'vitest';
import { NSE_PHASE, nseSession } from '@sv/shared';
import {
  autoRadarPanel,
  buildAlerts,
  intradayPositionsPanel,
  routineSteps,
  serializeNiftyPanel,
  swingPositionsPanel,
} from './morning-routine.js';

describe('routineSteps', () => {
  const session = nseSession(new Date('2026-07-06T05:00:00Z'));

  it('returns 7 checklist steps', () => {
    const steps = routineSteps(session, { open: 0 }, { open: 0 }, { hits: [] }, { available: false });
    expect(steps).toHaveLength(7);
  });

  it('warns when swing EXIT count > 0', () => {
    const steps = routineSteps(
      session,
      { open: 2, exit_count: 1 },
      { open: 0 },
      { hits: [] },
      { available: false },
    );
    const swingStep = steps.find((s) => s.step.includes('swing positions'));
    expect(swingStep?.status).toBe('warn');
    expect(swingStep?.detail).toContain('EXIT');
  });

  it('marks session open as ok', () => {
    const openSession = { ...session, phase: NSE_PHASE.OPEN };
    const steps = routineSteps(openSession, {}, {}, {}, {});
    expect(steps[0]?.status).toBe('ok');
  });

  it('uses nifty panel in checklist detail when ok', () => {
    const steps = routineSteps(
      session,
      { open: 0 },
      { open: 0 },
      { hits: [] },
      { available: false },
      { ok: true, label: 'Bullish', summary: 'Above VWAP' },
    );
    const niftyStep = steps.find((s) => s.step.includes('Nifty 15m'));
    expect(niftyStep?.detail).toContain('Bullish');
    expect(niftyStep?.status).toBe('ok');
  });
});

describe('swingPositionsPanel', () => {
  it('counts EXIT and maps top rows', () => {
    const panel = swingPositionsPanel([
      {
        id: 'a',
        symbol: 'TCS',
        exit_verdict: 'EXIT',
        gain_pct: -2.1,
        current_price: 3900,
        exit_triggers: ['trail stop'],
      },
      {
        id: 'b',
        symbol: 'INFY',
        exit_verdict: 'HOLD',
        gain_pct: 4.5,
        current_price: 1800,
      },
    ]);
    expect(panel.open).toBe(2);
    expect(panel.exit_count).toBe(1);
    expect(panel.urgent[0]?.symbol).toBe('TCS');
    expect(panel.rows).toHaveLength(2);
    expect(panel.portfolio.heat_pct).toBeGreaterThanOrEqual(0);
  });
});

describe('buildAlerts', () => {
  it('dedupes swing EXIT alerts', () => {
    const alerts = buildAlerts(
      {
        exit_count: 1,
        urgent: [{ symbol: 'TCS', gain_pct: -1, triggers: ['stop'], id: 'a' }],
      },
      { exit_count: 0 },
    );
    expect(alerts.some((a) => a.includes('TCS'))).toBe(true);
    expect(alerts.some((a) => a.includes('1 swing'))).toBe(true);
  });
});

describe('serializeNiftyPanel', () => {
  it('maps analysis_15m fields', () => {
    const panel = serializeNiftyPanel({
      ok: true,
      index_label: 'Nifty 50',
      analysis_15m: {
        direction_label: 'Bullish',
        tone: 'bullish',
        summary: 'Pullback held',
        confidence: 72,
        price: 24500,
        setup_quality: { grade: 'A' },
      },
    });
    expect(panel.ok).toBe(true);
    expect(panel.label).toBe('Bullish');
    expect(panel.setup_grade).toBe('A');
    expect(panel.href).toBe('/intraday');
  });

  it('returns unavailable shape when state is null', () => {
    const panel = serializeNiftyPanel(null);
    expect(panel.ok).toBe(false);
    expect(panel.summary).toContain('unavailable');
  });
});

describe('intradayPositionsPanel', () => {
  it('maps urgent exit rows and portfolio pnl', () => {
    const panel = intradayPositionsPanel([
      {
        instrument_label: 'Nifty 50',
        symbol: 'NIFTY50',
        exit_verdict: 'EXIT',
        position_action: 'EXIT_NOW',
        action_label: 'Exit now',
        gain_pct: -0.8,
        pnl_inr: -400,
        position: { id: 'x1', symbol: 'NIFTY50' },
      },
    ]);
    expect(panel.open).toBe(1);
    expect(panel.exit_count).toBe(1);
    expect(panel.urgent[0]?.action).toBe('Exit now');
    expect(panel.portfolio.net_pnl_inr).toBe(-400);
  });
});

describe('autoRadarPanel', () => {
  it('returns unavailable when snapshot is null', () => {
    const panel = autoRadarPanel(null);
    expect(panel.available).toBe(false);
    expect(panel.hits).toHaveLength(0);
  });

  it('maps high conviction tier hits', () => {
    const panel = autoRadarPanel({
      saved_at: new Date(Date.now() - 120_000).toISOString(),
      tiers: {
        high_conviction: [{ symbol: 'TCS', verdict: 'ENTER', decision_action: 'BUY', decision_score: 8, price: 2000 }],
      },
      summary: { hit_count: 1 },
    });
    expect(panel.available).toBe(true);
    expect(panel.hits[0]?.symbol).toBe('TCS');
    expect(panel.saved_ago).toMatch(/ago|now/);
  });
});

import { describe, expect, it } from 'vitest';
import { atmStrike, fnoSpecForInstrument, nextExpiry, hasFnoSupport } from './fno-specs.js';
import { buildFnoTradePlans } from './fno-trade-plan.js';
import { TIME_STOP_IST } from './session-clock.js';

const longPlan = {
  ok: true,
  bias: 'long',
  entry: { type: 'market', price: 24500 },
  stop_loss: { price: 24400, pts: 100 },
  exits: [
    { tier: 'T1', price: 24600, rr: 1 },
    { tier: 'T2', price: 24700, rr: 2 },
    { tier: 'T3', price: 24800, rr: 3 },
  ],
  trigger: { actionable: true, status: 'READY' },
  time_stop_ist: TIME_STOP_IST,
};

describe('fno-specs', () => {
  it('rounds ATM strike to 50 for Nifty', () => {
    expect(atmStrike(24523, 50)).toBe(24500);
    expect(fnoSpecForInstrument('nifty50')!.lot_size).toBe(65);
  });

  it('returns Nifty weekly on Tuesday, not the old Thursday', () => {
    const spec = fnoSpecForInstrument('nifty50')!;
    const exp = nextExpiry(spec, new Date('2026-08-13T10:00:00+05:30'));
    expect(exp.date).toBe('2026-08-18');
    expect(exp.weekday).toBe('Tue');
    expect(exp.schedule).toBe('weekly');
    expect(exp.holiday_shifted).toBe(false);
  });

  it('uses Bank Nifty monthly last Tuesday (weeklies discontinued)', () => {
    const spec = fnoSpecForInstrument('banknifty')!;
    const exp = nextExpiry(spec, new Date('2026-08-13T10:00:00+05:30'));
    expect(exp.schedule).toBe('monthly');
    expect(exp.date).toBe('2026-08-25');
    expect(exp.weekday).toBe('Tue');
  });

  it('uses last Tuesday monthly expiry for stock F&O', () => {
    const spec = fnoSpecForInstrument('tcs')!;
    const exp = nextExpiry(spec, new Date('2026-07-02T10:00:00+05:30'));
    expect(exp.schedule).toBe('monthly');
    expect(exp.date).toBe('2026-07-28');
    expect(exp.weekday).toBe('Tue');
  });

  it('shifts Tuesday holiday expiry to the previous trading day', () => {
    const spec = fnoSpecForInstrument('nifty50')!;
    const dussehraWeek = nextExpiry(spec, new Date('2026-10-19T10:00:00+05:30'));
    expect(dussehraWeek.date).toBe('2026-10-19');
    expect(dussehraWeek.scheduled_date).toBe('2026-10-20');
    expect(dussehraWeek.holiday_shifted).toBe(true);
    expect(dussehraWeek.is_today).toBe(true);

    const onHoliday = nextExpiry(spec, new Date('2026-10-20T10:00:00+05:30'));
    expect(onHoliday.date).toBe('2026-10-27');
  });

  it('shifts monthly expiry when last Tuesday is a holiday', () => {
    const spec = fnoSpecForInstrument('tcs')!;
    const exp = nextExpiry(spec, new Date('2026-03-15T10:00:00+05:30'));
    expect(exp.date).toBe('2026-03-30');
    expect(exp.scheduled_date).toBe('2026-03-31');
    expect(exp.holiday_shifted).toBe(true);
  });

  it('flags F&O support per instrument', () => {
    expect(hasFnoSupport('nifty50')).toBe(true);
    expect(hasFnoSupport('sensex')).toBe(true);
    expect(hasFnoSupport('finnifty')).toBe(true);
    expect(hasFnoSupport('sbin')).toBe(false);
  });

  it('uses BSE Thursday weekly for Sensex and NSE monthly for Fin Nifty', () => {
    const sensex = fnoSpecForInstrument('sensex')!;
    const fin = fnoSpecForInstrument('finnifty')!;
    const thu = nextExpiry(sensex, new Date('2026-08-13T10:00:00+05:30'));
    const fri = nextExpiry(sensex, new Date('2026-08-14T10:00:00+05:30'));
    const finExp = nextExpiry(fin, new Date('2026-08-13T10:00:00+05:30'));
    expect(thu.date).toBe('2026-08-13');
    expect(thu.weekday).toBe('Thu');
    expect(thu.schedule).toBe('weekly');
    expect(fri.date).toBe('2026-08-20');
    expect(finExp.schedule).toBe('monthly');
    expect(finExp.date).toBe('2026-08-25');
    expect(sensex.lot_size).toBe(20);
    expect(fin.lot_size).toBe(60);
  });
});

describe('buildFnoTradePlans', () => {
  it('builds futures and options for long spot plan', () => {
    const out = buildFnoTradePlans(
      'nifty50',
      longPlan,
      { price: 24500, confidence: 60 },
      { deploy_pct: 70 },
    );
    expect(out.ok).toBe(true);
    expect(out.futures?.side).toBe('BUY');
    expect(out.futures?.lot_size).toBe(65);
    expect(out.options?.option_type).toBe('CE');
    expect(out.options?.strike).toBeGreaterThan(0);
  });

  it('stands aside when spot plan blocked', () => {
    const out = buildFnoTradePlans('nifty50', { ok: false, message: 'Wait' }, { price: 24500 }, null);
    expect(out.ok).toBe(false);
    expect(out.futures).toBeNull();
  });

  it('maps short bias to PE and sell futures', () => {
    const shortPlan = { ...longPlan, bias: 'short', entry: { price: 24500 }, stop_loss: { price: 24600 } };
    const out = buildFnoTradePlans(
      'nifty50',
      shortPlan,
      { price: 24500, confidence: 55 },
      { deploy_pct: 55 },
    );
    expect(out.futures?.side).toBe('SELL');
    expect(out.options?.option_type).toBe('PE');
  });

  it('builds stock futures plan for TCS', () => {
    const stockPlan = {
      ...longPlan,
      entry: { type: 'market', price: 3850 },
      stop_loss: { price: 3820, pts: 30 },
      exits: [{ tier: 'T1', price: 3880, rr: 1 }],
    };
    const out = buildFnoTradePlans(
      'tcs',
      stockPlan,
      { price: 3850, confidence: 60 },
      { deploy_pct: 65 },
    );
    expect(out.ok).toBe(true);
    expect(out.futures?.lot_size).toBe(175);
    expect(out.expiry?.schedule).toBe('monthly');
  });
});

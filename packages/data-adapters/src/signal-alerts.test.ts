import { describe, expect, it } from 'vitest';
import {
  alertsFromIntradayPaperTick,
  alertsFromMorningStrings,
  alertsFromSwingPaperTick,
  displayName,
  formatSignalEmailBody,
  formatSignalEmailSubject,
  isSignalEmailConfigured,
} from './signal-alerts.js';

describe('signal-alerts', () => {
  it('detects SMTP config from env', () => {
    const prev = { ...process.env };
    delete process.env.SMTP_HOST;
    expect(isSignalEmailConfigured()).toBe(false);
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'alerts@example.com';
    expect(isSignalEmailConfigured()).toBe(true);
    process.env = prev;
  });

  it('prefers instrument label over ticker and rejects DB ids', () => {
    expect(displayName({ instrument_label: 'Nifty 50', symbol: 'NIFTY50' })).toBe('Nifty 50');
    expect(displayName({ symbol: 'TCS' })).toBe('TCS');
    expect(displayName({ symbol: 'cmsh1enco0001vgcb91p5tis8', id: 'x' })).toBe('Unknown');
  });

  it('maps swing paper tick to entry/exit alerts', () => {
    const alerts = alertsFromSwingPaperTick({
      entries: [
        {
          skipped: false,
          symbol: 'TCS',
          position: {
            id: 'p1',
            symbol: 'TCS',
            instrument_label: 'TCS',
            entry_price: 4100,
            side: 'long',
            quantity: 5,
            stop_loss: 4000,
            target_t1: 4200,
            target_t2: 4300,
            target_t3: 4400,
            notional_inr: 20500,
          },
        },
      ],
      exits: [
        {
          symbol: 'RELIANCE',
          instrument_label: 'Reliance',
          action: 'PARTIAL_T1',
          booked: true,
          price: 2850,
          quantity: 10,
          entry_price: 2800,
          remaining_pct: 60,
        },
        {
          symbol: 'INFY',
          instrument_label: 'Infosys',
          action: 'EXIT_NOW',
          closed: true,
          price: 1800,
          entry_price: 1750,
          realized_pnl: 450,
          side: 'long',
        },
      ],
    });
    expect(alerts).toHaveLength(3);
    expect(alerts[0]).toMatchObject({ book: 'swing', side: 'entry', symbol: 'TCS', name: 'TCS' });
    expect(alerts[0].detail).toContain('entry ₹4100');
    expect(alerts[1]).toMatchObject({ side: 'partial', action: 'PARTIAL_T1', name: 'Reliance' });
    expect(alerts[2]).toMatchObject({ side: 'exit', action: 'EXIT_NOW', name: 'Infosys' });
    expect(alerts[2].detail).toContain('PnL');
  });

  it('maps intraday exits with names instead of position ids', () => {
    const alerts = alertsFromIntradayPaperTick({
      entries: [
        {
          skipped: false,
          position: {
            id: 'i1',
            symbol: 'NIFTY50',
            instrument_label: 'Nifty 50',
            entry_price: 24500,
            side: 'long',
            quantity: 2,
            stop_loss: 24400,
            target_t1: 24580,
            timeframe: '15m',
          },
        },
      ],
      exits: [
        {
          id: 'cmsh1enco0001vgcb91p5tis8',
          action: 'EXIT_TIME',
          closed: true,
          price: 24550,
          symbol: 'NIFTY50',
          instrument_label: 'Nifty 50',
          side: 'long',
          quantity: 2,
          entry_price: 24500,
          stop_loss: 24400,
          target_t1: 24580,
          realized_pnl: 80,
          timeframe: '15m',
        },
      ],
    });
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ book: 'intraday', name: 'Nifty 50', symbol: 'NIFTY50' });
    expect(alerts[1].name).toBe('Nifty 50');
    expect(alerts[1].symbol).toBe('NIFTY50');
    expect(alerts[1].symbol).not.toMatch(/^c[a-z0-9]/i);
    expect(alerts[1].detail).toContain('T1');
    expect(formatSignalEmailSubject([alerts[1]])).toContain('Nifty 50');
    const body = formatSignalEmailBody([alerts[1]]);
    expect(body.text).toContain('Nifty 50');
    expect(body.text).toContain('Entry:');
    expect(body.html).toContain('Nifty 50');
    expect(body.html).toContain('Script Screener');
    expect(body.html).toContain('Trade signal alert');
    expect(body.html).toContain('border-radius:12px');
  });

  it('renders High Conviction cards with green accent', () => {
    const body = formatSignalEmailBody([
      {
        id: 'hc1',
        book: 'swing',
        side: 'entry',
        symbol: 'TCS',
        name: 'Tata Consultancy',
        action: 'HIGH_CONVICTION',
        price: 4100,
        stop_loss: 3950,
        target_t3: 4500,
        detail: 'Swing Auto · High Conviction',
      },
    ]);
    expect(body.html).toContain('SWING SIGNAL');
    expect(body.html).toContain('#059669');
    expect(body.html).toContain('Tata Consultancy');
    expect(body.html).toContain('Stop');
  });

  it('does not use position id when symbol missing', () => {
    const alerts = alertsFromIntradayPaperTick({
      exits: [
        {
          id: 'cmsh1enco0001vgcb91p5tis8',
          action: 'EXIT_NOW',
          closed: true,
          price: 100,
        },
      ],
    });
    expect(alerts).toHaveLength(0);
  });

  it('maps morning exit strings', () => {
    const alerts = alertsFromMorningStrings([
      'Swing EXIT: TCS (X1)',
      'Intraday: Nifty 50 → Exit now',
    ]);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].symbol).toBe('TCS');
    expect(alerts[0].name).toBe('TCS');
    expect(alerts[1].book).toBe('intraday');
    expect(alerts[1].name).toBe('Nifty 50');
  });

  it('formats single-alert subject with name', () => {
    expect(
      formatSignalEmailSubject([
        {
          id: '1',
          book: 'swing',
          side: 'entry',
          symbol: 'TCS',
          name: 'TCS',
          action: 'ENTRY',
          price: 4100,
        },
      ]),
    ).toContain('SWING ENTRY: TCS');
  });
});

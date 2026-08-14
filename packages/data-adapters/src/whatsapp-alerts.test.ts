import { describe, expect, it } from 'vitest';
import {
  formatEveningGttWhatsAppMessage,
  formatExitAlertsWhatsAppMessage,
  formatHotTierWhatsAppMessage,
  formatPatternAlertsWhatsAppMessage,
  normalizeWhatsAppTo,
  resolveWhatsAppProvider,
} from './whatsapp-alerts.js';

describe('whatsapp-alerts', () => {
  it('normalizes phone numbers to digits', () => {
    expect(normalizeWhatsAppTo('+91 98765-43210')).toBe('919876543210');
  });

  it('formats HOT tier message', () => {
    const msg = formatHotTierWhatsAppMessage({
      symbols: ['TCS', 'INFY'],
      regime: 'Bull',
      hits: [{ symbol: 'TCS', price: 4100, decision_action: 'BUY', decision_score: 12 }],
    });
    expect(msg).toContain('HOT tier');
    expect(msg).toContain('TCS, INFY');
    expect(msg).toContain('Regime: Bull');
    expect(msg).toContain('~₹4100');
    expect(msg).toContain('/swing/auto?tier=high_conviction');
  });

  it('formats evening GTT message', () => {
    const msg = formatEveningGttWhatsAppMessage({
      date_key: '2026-08-11',
      order_count: 1,
      regime_key: 'risk_on',
      orders: [
        {
          symbol: 'TCS',
          tier: 'high_conviction',
          qty: 10,
          trigger_price: 4000,
          limit_price: 4008,
          stop_loss: 3900,
          profit_target: 4200,
        },
      ],
    });
    expect(msg).toContain('Evening GTT');
    expect(msg).toContain('TCS');
    expect(msg).toContain('trg 4000');
    expect(msg).toContain('/signals');
  });

  it('formats EXIT alerts message', () => {
    const msg = formatExitAlertsWhatsAppMessage({
      date_key: '2026-08-11',
      swing_exits: 1,
      intraday_exits: 0,
      alerts: [{ symbol: 'HAL', action: 'EXIT_NOW', book: 'swing', detail: 'Stop hit' }],
    });
    expect(msg).toContain('EXIT alerts');
    expect(msg).toContain('HAL');
    expect(msg).toContain('Swing 1');
  });

  it('formats chart pattern alerts message', () => {
    const msg = formatPatternAlertsWhatsAppMessage({
      date_key: '2026-08-13',
      count: 2,
      alerts: [
        { symbol: 'TCS', action: 'BREAKOUT', pattern: 'Ascending Triangle' },
        { symbol: 'INFY', action: 'CONFIRMED', pattern: 'Double Bottom' },
      ],
    });
    expect(msg).toContain('Chart patterns');
    expect(msg).toContain('TCS');
    expect(msg).toContain('/patterns');
  });

  it('prefers Twilio when SID/token present', () => {
    const prev = { ...process.env };
    process.env.WHATSAPP_TO = '919876543210';
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    delete process.env.WHATSAPP_CALLMEBOT_APIKEY;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_ALERTS;
    expect(resolveWhatsAppProvider()).toBe('twilio');
    process.env = prev;
  });

  it('reports unconfigured when env missing', () => {
    const prev = { ...process.env };
    delete process.env.WHATSAPP_TO;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_CALLMEBOT_APIKEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.WHATSAPP_ALERTS;
    expect(resolveWhatsAppProvider()).toBeNull();
    process.env = prev;
  });
});

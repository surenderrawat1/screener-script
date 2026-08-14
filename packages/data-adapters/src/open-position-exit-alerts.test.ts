import { describe, expect, it } from 'vitest';
import {
  alertsFromOpenIntradayExits,
  alertsFromOpenSwingExits,
} from './open-position-exit-alerts.js';

describe('open position exit alerts', () => {
  it('maps swing EXIT rows to exit email alerts', () => {
    const alerts = alertsFromOpenSwingExits(
      [
        {
          id: 'pos1',
          symbol: 'TCS',
          exit_verdict: 'EXIT',
          position_action: 'EXIT_NOW',
          action_label: 'Exit now',
          current_price: 3800,
          entry_price: 3600,
          stop_loss: 3500,
          profit_target: 4000,
          shares: 10,
          exit_triggers: ['X2'],
        },
        {
          id: 'pos2',
          symbol: 'INFY',
          exit_verdict: 'HOLD',
          position_action: 'HOLD',
        },
      ],
      '2026-08-11',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      book: 'swing',
      side: 'exit',
      symbol: 'TCS',
      action: 'EXIT_NOW',
    });
    expect(alerts[0]!.detail).toContain('Open swing book');
  });

  it('maps intraday urgent exits', () => {
    const alerts = alertsFromOpenIntradayExits(
      [
        {
          id: 'i1',
          exit_verdict: 'EXIT',
          position_action: 'EXIT_TARGET',
          action_label: 'Target hit',
          current_price: 100,
          instrument_label: 'Nifty 50',
          position: {
            id: 'i1',
            symbol: 'NIFTY50',
            entry_price: 95,
            quantity: 1,
            timeframe: '15m',
            side: 'long',
          },
        },
      ],
      '2026-08-11',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ book: 'intraday', side: 'exit', symbol: 'NIFTY50' });
  });
});

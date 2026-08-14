import { describe, expect, it } from 'vitest';
import {
  liteDirection,
  liteJournal,
  liteLogPlan,
  liteOpenPosition,
  litePlaybook,
  liteScalpSetup,
  liteSourceLabel,
  liteTimeStop,
} from './lite.js';

describe('intraday lite payload (I-D1)', () => {
  it('trims scalp setup and only logs when the gate is open', () => {
    const blocked = liteScalpSetup({
      entry_allowed: false,
      summary: 'blocked',
      tone: 'warning',
      gate_reasons: ['MTF weak', 'SMA chase', 'extra 1', 'extra 2', 'extra 3'],
      plan: { ok: true, bias: 'long', entry: { price: 100 }, stop_loss: { price: 99 } },
    });
    expect(blocked.entry_allowed).toBe(false);
    expect(blocked.gate_reasons).toHaveLength(4);
    expect(liteLogPlan({ entry_allowed: false, plan: { ok: true } })).toBeNull();

    const open = {
      entry_allowed: true,
      summary: 'cleared',
      tone: 'success',
      preset_id: 'trend_scalp_5m',
      plan: {
        ok: true,
        bias: 'long',
        bias_label: 'Long',
        action_label: '5m trend scalp',
        preset_id: 'trend_scalp_5m',
        entry: { type: 'market', price: 25100 },
        stop_loss: { price: 25040 },
        exits: [
          { tier: 'T1', price: 25148, rr: 0.8 },
          { tier: 'T2', price: 25190, rr: 1.5 },
          { tier: 'T3', price: 25232, rr: 2.2 },
        ],
      },
    };
    const lite = liteScalpSetup(open);
    expect(lite.plan?.entry).toEqual({ type: 'market', price: 25100 });
    expect((lite.plan?.exits as unknown[]).length).toBe(3);
    const log = liteLogPlan(open);
    expect(log?.ok).toBe(true);
    expect(log?.bias).toBe('long');
    expect(Number((log?.entry as { price: number }).price)).toBe(25100);
  });

  it('compacts journal + open cards', () => {
    const journal = liteJournal([
      {
        instrument_label: 'Nifty 50',
        instrument_id: 'nifty50',
        side: 'long',
        timeframe: '5m',
        entry_price: 100,
        closed_price: 102,
        quantity: 50,
        stop_loss: 99,
        source: 'nifty_intraday_app',
        closed_reason: 'T1',
        closed_at: '2026-08-13T09:00:00.000Z',
      },
    ]);
    expect(journal.summary.wins).toBe(1);
    expect(journal.summary.win_rate_pct).toBe(100);
    expect(journal.recent[0]?.source_label).toBe('App');
    expect(journal.recent[0]?.net_pnl).toBe(100);

    const open = liteOpenPosition({
      id: 'p1',
      instrument_id: 'NIFTYBEES',
      instrument_label: 'Nifty 50 BeES',
      side: 'long',
      timeframe: '5m',
      entry_price: 280,
      current_price: 282,
      pnl_inr: 40,
      position_action: 'HOLD',
      source: 'nifty_scalp_5m',
    });
    expect(open.source_label).toBe('Scalp 5m');
    expect(open.instrument_label).toBe('Nifty 50 BeES');
  });

  it('maps direction, playbook, and 14:30 flatten', () => {
    expect(liteDirection({ direction_label: 'Bullish', confidence: 72 })).toMatchObject({
      label: 'Bullish',
      confidence: 72,
      tone: 'bullish',
    });
    expect(litePlaybook({ actionable: true, headline: 'GO — buy now', headline_tone: 'success' }).actionable).toBe(
      true,
    );
    expect(liteSourceLabel('nifty_radar_15m')).toBe('Radar 15m');
    const openSession = new Date('2026-08-13T09:05:00.000Z'); // 14:35 IST
    expect(liteTimeStop(openSession).flatten).toBe(true);
    expect(liteTimeStop(openSession).ist).toBe('14:30');
    const morning = new Date('2026-08-13T05:00:00.000Z'); // 10:30 IST
    expect(liteTimeStop(morning).flatten).toBe(false);
  });
});

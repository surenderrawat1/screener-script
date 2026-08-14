import { describe, expect, it } from 'vitest';
import {
  buildEveningGttOrder,
  buildEveningGttOrdersFromSnapshot,
  formatGttEmail,
} from './evening-gtt-signals.js';

describe('evening GTT builder', () => {
  it('builds Zerodha-style copy line from HC hit', () => {
    const order = buildEveningGttOrder(
      {
        symbol: 'TCS',
        name: 'Tata Consultancy',
        price: 3800,
        stop_loss: 3650,
        profit_target: 4200,
        suggested_shares: 5.8,
        r_multiple: 3.2,
        decision_score: 88,
        backtest_grade: 'strong',
      },
      'high_conviction',
    );
    expect(order).not.toBeNull();
    expect(order!.qty).toBe(5);
    expect(order!.trigger_price).toBe(3800);
    expect(order!.limit_price).toBe(3807.6);
    expect(order!.copy_line).toContain('BUY TCS qty 5 trigger 3800');
    expect(order!.copy_line).toContain('SL 3650');
    expect(order!.oco_note).toContain('OCO');
  });

  it('dedupes symbols across tiers and respects max', () => {
    const snapshot = {
      saved_at: new Date().toISOString(),
      last_full_scan_at: new Date().toISOString(),
      rotate_offset: 0,
      scan: {},
      tiers: {
        high_conviction: [
          { symbol: 'INFY', price: 1500, decision_score: 90, suggested_shares: 2 },
          { symbol: 'TCS', price: 3800, decision_score: 80, suggested_shares: 1 },
        ],
        strict_enter: [{ symbol: 'INFY', price: 1490, decision_score: 70, suggested_shares: 3 }],
      },
      summary: {},
    };
    const orders = buildEveningGttOrdersFromSnapshot(snapshot as never, {
      tiers: ['high_conviction', 'strict_enter'],
      maxOrders: 2,
    });
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.symbol)).toEqual(['INFY', 'TCS']);
  });

  it('renders attractive HTML cards with GTT metrics', () => {
    const order = buildEveningGttOrder(
      {
        symbol: 'TCS',
        name: 'Tata Consultancy',
        price: 3800,
        stop_loss: 3650,
        profit_target: 4200,
        suggested_shares: 5,
        r_multiple: 3.2,
        backtest_grade: 'strong',
      },
      'high_conviction',
    )!;
    const { html, text } = formatGttEmail({
      date_key: '2026-08-11',
      built_at: new Date().toISOString(),
      session_phase: 'post',
      regime_key: 'bull',
      snapshot_saved_at: null,
      order_count: 1,
      orders: [order],
      copy_all: order.copy_line,
      disclaimer: 'test',
    });
    expect(html).toContain('Evening GTT · Swing');
    expect(html).toContain('Zerodha GTT line');
    expect(html).toContain('TCS');
    expect(html).toContain('Trigger');
    expect(html).toContain('Copy-all paste block');
    expect(text).toContain('BUY TCS');
  });
});

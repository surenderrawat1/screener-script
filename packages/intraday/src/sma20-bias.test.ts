import { describe, expect, it } from 'vitest';
import { fromAnalysis, gateReasons, BIAS_LONG, BIAS_SHORT } from './sma20-bias.js';

describe('sma20-bias Stratzy', () => {
  it('long when price above SMA-20', () => {
    const state = fromAnalysis({ ok: true, price: 101, sma20: 100 });
    expect(state.ok).toBe(true);
    expect(state.bias).toBe(BIAS_LONG);
    expect(state.above).toBe(true);
  });

  it('short when price below SMA-20', () => {
    const state = fromAnalysis({ ok: true, price: 99, sma20: 100 });
    expect(state.bias).toBe(BIAS_SHORT);
    expect(gateReasons({ ok: true, price: 99, sma20: 100 }, 'long').length).toBeGreaterThan(0);
  });

  it('blocks opposite bias', () => {
    expect(gateReasons({ ok: true, price: 101, sma20: 100 }, 'short')[0]).toMatch(/above/);
    expect(gateReasons({ ok: true, price: 99, sma20: 100 }, 'long')[0]).toMatch(/below/);
  });

  it('blocks chase when extension exceeds max', () => {
    const reasons = gateReasons(
      { ok: true, price: 101.2, sma20: 100 },
      'long',
      { max_sma20_extension_pct: 0.45 },
    );
    expect(reasons.some((r) => /chase/i.test(r))).toBe(true);
    expect(
      gateReasons({ ok: true, price: 100.3, sma20: 100 }, 'long', { max_sma20_extension_pct: 0.45 }),
    ).toEqual([]);
  });
});

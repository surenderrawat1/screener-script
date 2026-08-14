import { describe, expect, it } from 'vitest';
import { computeTapeConfluence } from './tape-confluence.js';

describe('tape confluence (Phase D)', () => {
  it('marks strong confluence when setup + tape + soft + regime align', () => {
    const c = computeTapeConfluence(
      {
        strict_verdict: 'ENTER',
        strict_enter_ready: true,
        volume_surge: true,
        broke_swing_high: true,
        rules_soft_passed: 2,
        dynamic: { hourly_ema_bull: true },
      },
      { key: 'bull', blocks_strict_enter: false },
    );
    expect(c.key).toBe('strong');
    expect(c.tone).toBe('success');
    expect(c.score).toBeGreaterThanOrEqual(4);
    expect(c.factors).toContain('strict ENTER');
    expect(c.factors).toContain('bull regime');
  });

  it('flags regime block as conflict', () => {
    const c = computeTapeConfluence(
      { strict_verdict: 'ENTER', volume_surge: true },
      { key: 'bear', blocks_strict_enter: true },
    );
    expect(c.key).toBe('conflict');
    expect(c.tone).toBe('danger');
    expect(c.label).toBe('Regime block');
  });

  it('returns thin/none when factors are missing', () => {
    const c = computeTapeConfluence({ verdict: 'WATCH' }, { key: 'sideways' });
    expect(c.key).toBe('weak');
    expect(c.score).toBe(0);
  });
});

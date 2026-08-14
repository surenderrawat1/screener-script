import { describe, expect, it } from 'vitest';
import { evaluateDataQuality } from './data-quality-gate.js';

describe('evaluateDataQuality — D1 cache freshness (FV-E / MOD-18)', () => {
  it('fails D1 when cacheMeta missing', () => {
    const dq = evaluateDataQuality({ symbol: 'TCS', sector: 'IT' }, null);
    const d1 = dq.gates.find((g) => g.id === 'D1');
    expect(d1?.pass).toBe(false);
  });

  it('passes D1 when fetch cache_meta is fresh', () => {
    const dq = evaluateDataQuality(
      { symbol: 'TCS', sector: 'IT', pe: 20, roe: 25, roce: 30, eps: 100 },
      { created_at: Math.floor(Date.now() / 1000) },
    );
    const d1 = dq.gates.find((g) => g.id === 'D1');
    expect(d1?.pass).toBe(true);
  });

  it('fails D1 when cache older than stale window', () => {
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86400;
    const dq = evaluateDataQuality(
      { symbol: 'TCS', sector: 'IT' },
      { created_at: tenDaysAgo },
      { cache_stale_days: 7 },
    );
    const d1 = dq.gates.find((g) => g.id === 'D1');
    expect(d1?.pass).toBe(false);
  });
});

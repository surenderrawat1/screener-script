import { describe, expect, it } from 'vitest';
import { mapInBatches, SWING_SCAN_CONCURRENCY } from './swing-scan.js';

describe('swing scan parallel fetch (Phase B1)', () => {
  it('defaults to concurrency 8', () => {
    expect(SWING_SCAN_CONCURRENCY).toBe(8);
  });

  it('mapInBatches preserves order and respects concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];
    const out = await mapInBatches(items, 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('mapInBatches treats invalid concurrency as 1', async () => {
    const out = await mapInBatches(['a', 'b'], 0, async (x) => x.toUpperCase());
    expect(out).toEqual(['A', 'B']);
  });
});

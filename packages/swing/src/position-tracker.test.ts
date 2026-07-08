import { describe, expect, it } from 'vitest';
import { highWaterSinceEntry, trailRatchetFields } from './position-tracker.js';
import type { OhlcBar } from './types.js';

describe('position-tracker', () => {
  const bars: OhlcBar[] = [
    { time: '2026-01-01', open: 100, high: 105, low: 99, close: 102, volume: 1 },
    { time: '2026-01-02', open: 102, high: 115, low: 101, close: 110, volume: 1 },
    { time: '2026-01-03', open: 110, high: 112, low: 108, close: 109, volume: 1 },
  ];

  it('uses bar highs since entry for HWM', () => {
    const hwm = highWaterSinceEntry(bars, '2026-01-02', 100, 100, 109);
    expect(hwm).toBe(115);
  });

  it('discards a stored HWM that exceeds every confirmed bar high (bad tick)', () => {
    // Stored 200 is above all bar highs (max 115) — a stale/bad-tick artifact.
    const hwm = highWaterSinceEntry(bars, '2026-01-01', 200, 100, 109);
    expect(hwm).toBe(115);
  });

  it('lets the current live price exceed cached bar highs', () => {
    const hwm = highWaterSinceEntry(bars, '2026-01-01', 100, 100, 130);
    expect(hwm).toBe(130);
  });

  it('falls back to stored HWM only when no bars are available', () => {
    const hwm = highWaterSinceEntry([], '2026-01-01', 150, 100, 109);
    expect(hwm).toBe(150);
  });

  it('ratchets HWM up and heals it down; trail stays up-only', () => {
    const up = trailRatchetFields(
      { symbol: 'T', entry_price: 100, entry_date: '2026-01-01', trailed_stop_loss: 95, highest_since_entry: 108 },
      { highest_since_entry: 115, suggested_trailed_stop: 102 },
    );
    expect(up.highest_since_entry).toBe(115);
    expect(up.trailed_stop_loss).toBe(102);

    // Authoritative recomputation is lower than the stored (inflated) HWM — heal down.
    const healed = trailRatchetFields(
      { symbol: 'T', entry_price: 100, entry_date: '2026-01-01', trailed_stop_loss: 102, highest_since_entry: 115 },
      { highest_since_entry: 110, suggested_trailed_stop: 98 },
    );
    expect(healed.highest_since_entry).toBe(110);
    expect(healed.trailed_stop_loss).toBeUndefined();
  });
});

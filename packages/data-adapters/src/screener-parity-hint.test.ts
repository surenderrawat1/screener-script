import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCacheGetJson = vi.fn();

vi.mock('@sv/cache', () => ({
  cacheGetJson: (...args: unknown[]) => mockCacheGetJson(...args),
  cacheKey: (...parts: string[]) => parts.join(':'),
}));

describe('attachScreenerParityHint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns row unchanged when verify cache missing', async () => {
    mockCacheGetJson.mockResolvedValue(null);
    const { attachScreenerParityHint } = await import('./screener-parity-hint.js');
    const row = {
      symbol: 'TCS',
      intrinsic: 4000,
      composite_score: 70,
    } as import('@sv/shared').ScreenerRow;

    await expect(attachScreenerParityHint(row, 'TCS')).resolves.toBe(row);
  });

  it('merges verify score and IV drift when cache hit', async () => {
    mockCacheGetJson.mockResolvedValue({
      result: {
        success: true,
        analysis: {
          intrinsic: 3800,
          verify_score: 48,
          recommendation: 'Buy / SIP',
        },
      },
    });

    const { attachScreenerParityHint } = await import('./screener-parity-hint.js');
    const out = await attachScreenerParityHint(
      {
        symbol: 'TCS',
        intrinsic: 4000,
        composite_score: 70,
      } as import('@sv/shared').ScreenerRow,
      'TCS',
    );

    expect(out.verify_score).toBe(48);
    expect(out.verify_decision).toBe('Buy / SIP');
    expect(out.verify_cached).toBe(true);
    expect(out.verify_iv).toBe(3800);
    expect(out.parity_from_cache).toBe(true);
    expect(out.iv_delta_pct).toBeGreaterThan(0);
  });
});

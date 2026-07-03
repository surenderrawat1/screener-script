import { describe, expect, it } from 'vitest';
import { etfMetaFor, etfSymbols, filterEtfCatalog, ETF_CATEGORY } from './etf-universe.js';
import { formatEtfPanel } from './etf-panel.js';

describe('etf-universe', () => {
  it('lists full ETF book', () => {
    expect(etfSymbols().length).toBeGreaterThanOrEqual(18);
  });

  it('filters rotation book to index + sector', () => {
    const rotation = filterEtfCatalog(ETF_CATEGORY.ROTATION);
    expect(rotation.every((row) => ['index', 'sector'].includes(row.category))).toBe(true);
    expect(rotation.length).toBeLessThan(etfSymbols().length);
  });

  it('resolves NIFTYBEES metadata', () => {
    const meta = etfMetaFor('NIFTYBEES');
    expect(meta?.underlying).toBe('Nifty 50');
    expect(meta?.ter_pct).toBe(0.05);
  });
});

describe('formatEtfPanel', () => {
  it('maps scan hits with ETF metadata', () => {
    const panel = formatEtfPanel(
      {
        ok: true,
        hits: [
          {
            symbol: 'ITBEES',
            verdict: 'SETUP',
            strict_verdict: 'WATCH',
            price: 450,
            swing_rank: 72,
            stale: false,
          },
        ],
        stale: 0,
      },
      new Date(Date.now() - 240_000).toISOString(),
      true,
    );
    expect(panel.hits[0]?.name).toBe('Nifty IT BeES');
    expect(panel.hits[0]?.category).toBe('Sector');
    expect(panel.from_cache).toBe(true);
    expect(panel.cached_ago).toMatch(/ago|now/);
  });
});

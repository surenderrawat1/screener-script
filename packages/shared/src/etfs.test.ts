import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ETF_CATALOG,
  ETF_CATEGORY,
  ETF_LIQUIDITY,
  mergeEtfCatalog,
  normalizeEtfCatalog,
  parseEtfCsv,
  radarEtfCatalog,
} from './etfs.js';
import { buildAppConfig } from './config.js';
import { resolveConfigRoot } from './config-loader.js';

describe('ETF catalog', () => {
  it('keeps the built-in BeES book', () => {
    expect(DEFAULT_ETF_CATALOG.length).toBeGreaterThanOrEqual(18);
    expect(DEFAULT_ETF_CATALOG.some((r) => r.symbol === 'NIFTYBEES' && r.radar)).toBe(true);
  });

  it('normalizes YAML/admin payloads and drops junk', () => {
    const rows = normalizeEtfCatalog({
      entries: [
        { symbol: 'goldbees.ns', name: 'Gold BeES', category: 'commodity', liquidity: 'high', ter_pct: 0.05 },
        { symbol: 'GOLDBEES', name: 'dup', category: 'index', liquidity: 'high' },
        { symbol: '!!!', category: 'index', liquidity: 'high' },
        { symbol: 'FOO', category: 'not-a-cat', liquidity: 'high' },
      ],
    });
    expect(rows.map((r) => r.symbol)).toEqual(['GOLDBEES']);
    expect(rows[0]?.radar).toBe(true);
    expect(rows[0]?.category).toBe(ETF_CATEGORY.COMMODITY);
  });

  it('loads config/etfs.yaml', () => {
    const cfg = buildAppConfig(resolveConfigRoot(), {});
    expect(cfg.etfs.entries.length).toBeGreaterThanOrEqual(18);
    expect(cfg.etfs.entries.some((r) => r.symbol === 'ITBEES')).toBe(true);
    expect(radarEtfCatalog().every((r) => r.radar)).toBe(true);
  });

  it('admin override replaces the YAML list', () => {
    const cfg = buildAppConfig(resolveConfigRoot(), {
      etfs: {
        version: 1,
        entries: [
          {
            symbol: 'NIFTYBEES',
            name: 'Nifty 50 BeES',
            category: ETF_CATEGORY.INDEX,
            underlying: 'Nifty 50',
            ter_pct: 0.05,
            liquidity: ETF_LIQUIDITY.HIGH,
            radar: true,
          },
        ],
      },
    });
    expect(cfg.etfs.entries).toHaveLength(1);
    expect(cfg.etfs.entries[0]?.symbol).toBe('NIFTYBEES');
  });
});

describe('parseEtfCsv', () => {
  it('reads a full admin CSV', () => {
    const rows = parseEtfCsv(`symbol,name,category,underlying,ter_pct,liquidity,radar,note
NIFTYBEES,Nifty 50 BeES,index,Nifty 50,0.05,high,true,flagship
JUNIORBEES,Nifty Next 50 BeES,index,Nifty Next 50,0.15,medium,false,
`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: 'NIFTYBEES',
      name: 'Nifty 50 BeES',
      category: ETF_CATEGORY.INDEX,
      ter_pct: 0.05,
      radar: true,
    });
    expect(rows[1]?.radar).toBe(false);
  });

  it('accepts a symbol-only NSE-style list', () => {
    const rows = parseEtfCsv(`SYMBOL
NIFTYBEES
goldbees.ns
!!!
`);
    expect(rows.map((r) => r.symbol)).toEqual(['NIFTYBEES', 'GOLDBEES']);
    expect(rows[0]?.category).toBe(ETF_CATEGORY.INDEX);
    expect(rows[0]?.liquidity).toBe(ETF_LIQUIDITY.MEDIUM);
  });

  it('merges CSV into the live book without dropping richer names', () => {
    const base = parseEtfCsv(`symbol,name,category,liquidity
NIFTYBEES,Nifty 50 BeES,index,high
`);
    const incoming = parseEtfCsv(`symbol,liquidity
NIFTYBEES,high
ITBEES,high
`);
    const merged = mergeEtfCatalog(base, incoming);
    expect(merged.map((r) => r.symbol)).toEqual(['NIFTYBEES', 'ITBEES']);
    expect(merged[0]?.name).toBe('Nifty 50 BeES');
  });
});

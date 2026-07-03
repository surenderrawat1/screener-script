import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exchangeListSummary,
  filterUnrestrictedSymbols,
  isExchangeRestricted,
  resetExchangeListCache,
} from './exchange-list-loader.js';

describe('exchange-list-loader', () => {
  let configRoot: string;

  beforeEach(() => {
    resetExchangeListCache();
    configRoot = mkdtempSync(join(tmpdir(), 'sv-exchange-'));
    mkdirSync(join(configRoot, 'data/exchange'), { recursive: true });
    process.env.SV_CONFIG_ROOT = configRoot;
    writeFileSync(
      join(configRoot, 'data/exchange/asm_gsm_manual.json'),
      JSON.stringify({
        as_of: '2026-06-01',
        asm: ['BADCO'],
        gsm: ['RISKY'],
        t2t: ['T2TST'],
      }),
    );
    resetExchangeListCache();
  });

  it('detects ASM and GSM symbols', () => {
    expect(isExchangeRestricted('BADCO')).toBe('asm');
    expect(isExchangeRestricted('risky.ns')).toBe('gsm');
    expect(isExchangeRestricted('SAFE')).toBeNull();
  });

  it('filters restricted symbols from universe', () => {
    const result = filterUnrestrictedSymbols(['TCS', 'BADCO', 'INFY', 'RISKY']);
    expect(result.symbols).toEqual(['TCS', 'INFY']);
    expect(result.restricted_skipped).toBe(2);
    expect(result.exchange_list_as_of).toBe('2026-06-01');
  });

  it('summarizes list counts', () => {
    const summary = exchangeListSummary();
    expect(summary.asm).toBe(1);
    expect(summary.gsm).toBe(1);
    expect(summary.t2t).toBe(1);
    expect(summary.total).toBe(3);
  });
});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getPromoterPledgeFromFiles,
  parsePct,
  resetPromoterPledgeCache,
} from './promoter-pledge.js';

describe('parsePct', () => {
  it('parses and clamps-validates', () => {
    expect(parsePct('12.5')).toBe(12.5);
    expect(parsePct('12.5%')).toBe(12.5);
    expect(parsePct('')).toBeNull();
    expect(parsePct(101)).toBeNull();
  });
});

describe('getPromoterPledgeFromFiles', () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetPromoterPledgeCache();
    delete process.env.SV_PLEDGE_DATA_DIR;
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('reads CSV warehouse rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv-pledge-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'pledge.csv'),
      'symbol,promoter_pledge_pct,as_of\nTATASTEEL,12.5,2026-06-01\nRELIANCE,0.0,2026-06-01\n',
    );
    process.env.SV_PLEDGE_DATA_DIR = dir;
    resetPromoterPledgeCache();
    expect(getPromoterPledgeFromFiles('TATASTEEL')?.pct).toBe(12.5);
    expect(getPromoterPledgeFromFiles('RELIANCE')?.pct).toBe(0);
    expect(getPromoterPledgeFromFiles('TATASTEEL')?.as_of).toBe('2026-06-01');
  });

  it('prefers per-symbol JSON over CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sv-pledge-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'pledge.csv'),
      'symbol,promoter_pledge_pct,as_of\nHDFCBANK,1.0,2026-01-01\n',
    );
    writeFileSync(
      join(dir, 'HDFCBANK.json'),
      JSON.stringify({ promoter_pledge_pct: 3.2, as_of: '2026-05-01' }),
    );
    process.env.SV_PLEDGE_DATA_DIR = dir;
    resetPromoterPledgeCache();
    const row = getPromoterPledgeFromFiles('HDFCBANK');
    expect(row?.pct).toBe(3.2);
    expect(row?.source).toBe('json');
  });
});

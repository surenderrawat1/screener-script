import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { guessUniverseFromFilename } from './indices.js';
import { parseIndexCsvContent } from './index-csv.js';

const indicesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../stock-verifier/data/indices',
);

describe('index CSV parser', () => {
  it('parses standard ind_nifty50list.csv', () => {
    const csv = readFileSync(resolve(indicesDir, 'ind_nifty50list.csv'), 'utf8');
    const symbols = parseIndexCsvContent(csv);
    expect(symbols.length).toBeGreaterThanOrEqual(48);
    expect(symbols).toContain('HDFCBANK');
    expect(symbols).toContain('RELIANCE');
    expect(symbols).not.toContain('NIFTY 50');
  });

  it('parses Market Watch MW-NIFTY-50 CSV', () => {
    const csv = readFileSync(resolve(indicesDir, 'MW-NIFTY-50-17-Jun-2026.csv'), 'utf8');
    const symbols = parseIndexCsvContent(csv);
    expect(symbols.length).toBeGreaterThanOrEqual(48);
    expect(symbols).toContain('HDFCBANK');
  });

  it('guesses universe from filename', () => {
    expect(guessUniverseFromFilename('MW-NIFTY-50-17-Jun-2026.csv')).toBe('nifty50');
    expect(guessUniverseFromFilename('MW-NIFTY-TOTAL-MKT-19-Jun-2026.csv')).toBe('nifty500');
    expect(guessUniverseFromFilename('ind_nifty50list.csv')).toBe('nifty50');
  });
});

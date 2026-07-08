import { describe, expect, it } from 'vitest';
import { guessUniverseFromFilename } from './indices.js';
import { parseIndexCsvContent } from './index-csv.js';

const STANDARD_NSE_CSV = `Company Name,Industry,Symbol,Series,ISIN Code
HDFC Bank Ltd.,Financial Services,HDFCBANK,EQ,INE040A01034
Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018`;

const MARKET_WATCH_CSV = `"SYMBOL","LTP","%CHNG","VOLUME"
"HDFCBANK","1,650.25","0.45","1000000"
"RELIANCE","2,840.10","-0.30","900000"`;

describe('index CSV parser', () => {
  it('parses standard ind_nifty50list.csv', () => {
    const symbols = parseIndexCsvContent(STANDARD_NSE_CSV);
    expect(symbols).toHaveLength(2);
    expect(symbols).toContain('HDFCBANK');
    expect(symbols).toContain('RELIANCE');
  });

  it('parses Market Watch MW-NIFTY-50 CSV', () => {
    const symbols = parseIndexCsvContent(MARKET_WATCH_CSV);
    expect(symbols).toHaveLength(2);
    expect(symbols).toContain('HDFCBANK');
    expect(symbols).toContain('RELIANCE');
  });

  it('guesses universe from filename', () => {
    expect(guessUniverseFromFilename('MW-NIFTY-50-17-Jun-2026.csv')).toBe('nifty50');
    expect(guessUniverseFromFilename('MW-NIFTY-500-06-Jul-2026.csv')).toBe('nifty500');
    expect(guessUniverseFromFilename('MW-NIFTY-500-06-Jul-2026')).toBe('nifty500');
    expect(guessUniverseFromFilename('MW-NIFTY-TOTAL-MKT-19-Jun-2026.csv')).toBeNull();
    expect(guessUniverseFromFilename('MW-NIFTY-LARGEMIDCAP-250-06-Jul-2026.csv')).toBe('nifty250');
    expect(guessUniverseFromFilename('MW-NIFTY-LARGEMIDCAP-250-06-Jul-2026')).toBe('nifty250');
    expect(guessUniverseFromFilename('ind_nifty50list.csv')).toBe('nifty50');
    expect(guessUniverseFromFilename('C:\\Downloads\\MW-NIFTY-500-06-Jul-2026.csv')).toBe('nifty500');
  });
});

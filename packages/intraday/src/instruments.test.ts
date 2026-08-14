import { describe, expect, it } from 'vitest';
import {
  entryFilterOverrides,
  isCatalogInstrument,
  normalizeInstrumentId,
  parseInstrumentQuery,
  resolveInstrument,
  resolveInstrumentFromSymbol,
  yahooSymbolsForQuery,
} from './instruments.js';

describe('resolve any stock / ETF / index', () => {
  it('keeps catalog ids unchanged', () => {
    expect(resolveInstrument('nifty50')?.yahoo_symbols[0]).toBe('^NSEI');
    expect(resolveInstrument('banknifty')?.recommended_preset).toBe('banknifty_tuned');
    expect(resolveInstrument('TCS')?.id).toBe('tcs');
    expect(resolveInstrument('TCS.NS')?.id).toBe('tcs');
    expect(resolveInstrument('HDFCBANK.NS')?.id).toBe('hdfcbank');
    expect(isCatalogInstrument('tcs')).toBe(true);
  });

  it('maps caret Yahoo to the catalog index, not an ETF fallback', () => {
    expect(resolveInstrument('^NSEI')?.id).toBe('nifty50');
    expect(resolveInstrument('^NSEBANK')?.id).toBe('banknifty');
    expect(resolveInstrument('NIFTYBEES')?.id).toBe('niftybees');
    expect(resolveInstrument('NIFTYBEES')?.cache_key).toBe('NIFTYBEES');
    expect(resolveInstrument('niftybees')?.label).toMatch(/BeES/i);
    expect(resolveInstrument('NIFTYBEES.NS')?.yahoo_symbols).toEqual(['NIFTYBEES.NS']);
    expect(isCatalogInstrument('niftybees')).toBe(false);
  });

  it('synthesizes any NSE/BSE ticker with .NS then .BO', () => {
    const sun = resolveInstrument('SUNPHARMA');
    expect(sun).toMatchObject({
      id: 'sunpharma',
      cache_key: 'SUNPHARMA',
      kind: 'stock',
      recommended_preset: 'cfa_precision',
    });
    expect(sun?.yahoo_symbols).toEqual(['SUNPHARMA.NS', 'SUNPHARMA.BO']);
    expect(yahooSymbolsForQuery('INFY.BO')).toEqual(['INFY.BO']);
    expect(resolveInstrument('INFY.BO')?.id).toBe('infy');
    expect(resolveInstrument('INFY.BO')?.yahoo_symbols).toEqual(['INFY.BO']);
  });

  it('does not silently remap unknown tickers to nifty50', () => {
    expect(normalizeInstrumentId('')).toBe('nifty50');
    expect(normalizeInstrumentId('SUNPHARMA')).toBe('sunpharma');
    expect(normalizeInstrumentId('NIFTYBEES')).toBe('niftybees');
    expect(resolveInstrument('!!!')).toBeNull();
    expect(parseInstrumentQuery('not a ticker!!!')).toBeNull();
  });

  it('lets symbol win over a catalog instrument id', () => {
    const tcs = resolveInstrumentFromSymbol('TCS', 'nifty50');
    expect(tcs?.id).toBe('tcs');
    expect(resolveInstrumentFromSymbol('', 'nifty50')?.id).toBe('nifty50');
  });

  it('applies stock floors to ETFs and free-text names', () => {
    const bees = resolveInstrument('NIFTYBEES')!;
    const sun = resolveInstrument('SUNPHARMA')!;
    expect(entryFilterOverrides(bees).require_actionable_trigger).toBe(true);
    expect(entryFilterOverrides(sun).min_mtf_deploy).toBe(60);
    expect(entryFilterOverrides(resolveInstrument('nifty50'))).toEqual({});
  });
});

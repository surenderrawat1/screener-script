import { evaluateEntry, metricsFromBars, scanSymbols, type SwingScanOptions, type SymbolContext } from '@sv/swing';
import { fetchDailyBars } from './swing-chart.js';

export async function buildSymbolContext(symbol: string, refresh = false): Promise<SymbolContext | null> {
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '');
  const bars = await fetchDailyBars(sym, refresh);
  if (bars.length < 50) return null;
  const ta = metricsFromBars(bars, sym, true);
  return { symbol: sym, bars, ta, stale: false };
}

export async function evaluateSwingSymbol(symbol: string, refresh = false) {
  const ctx = await buildSymbolContext(symbol, refresh);
  if (!ctx) return { ok: false, error: 'Insufficient chart data' };
  const price = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? 0);
  const entry = evaluateEntry(ctx.ta, price, ctx.bars);
  return { ok: true, symbol: ctx.symbol, price, entry, ta: ctx.ta };
}

export async function runSwingScan(symbols: string[], options: SwingScanOptions = {}, refresh = false) {
  const contexts: SymbolContext[] = [];
  for (const sym of symbols) {
    const ctx = await buildSymbolContext(sym, refresh);
    if (ctx) contexts.push(ctx);
  }
  return scanSymbols(contexts, options);
}

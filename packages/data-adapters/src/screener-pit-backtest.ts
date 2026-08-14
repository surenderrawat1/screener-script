import type { ScreenerFilters } from './screener-run.js';
import { resolveUniverseSymbols } from './universe.js';
import { fetchDailyBars } from './swing-chart.js';
import { PRESET_FILTERS } from '@sv/core';
import {
  enrichDetailTa,
  passesTaFilters,
  type TaMetrics,
  needsHourlyTaFilters,
} from '@sv/swing';

export interface ScreenerPitBacktestRow {
  symbol: string;
  price_as_of: number | null;
  forward_return_pct: number | null;
  passed: boolean;
}

export interface ScreenerPitBacktestResult {
  ok: true;
  universe: string | null;
  asOfDaysAgo: number;
  forwardDays: number;
  total_symbols: number;
  tested: number;
  passed: number;
  rows: ScreenerPitBacktestRow[];
}

function pct(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return ((b - a) / a) * 100;
}

/**
 * MVP screener PIT backtest:
 * - Uses existing Screener TA gate logic on historical daily bars "as-of" a bar offset.
 * - Does NOT attempt point-in-time fundamental ratios (uses only TA gates).
 */
export async function runScreenerPitBacktest(input: {
  universe?: string;
  symbols?: string[];
  preset?: string;
  filters?: ScreenerFilters;
  asOfDaysAgo?: number;
  forwardDays?: number;
  refresh?: boolean;
  maxScan?: number;
}): Promise<ScreenerPitBacktestResult> {
  const asOfDaysAgo = input.asOfDaysAgo ?? 180;
  const forwardDays = input.forwardDays ?? 60;
  const refresh = Boolean(input.refresh);

  const universe = input.universe?.trim() ? input.universe.trim() : null;

  const symbols =
    input.symbols?.length && input.symbols.length > 0
      ? input.symbols
      : universe
        ? await resolveUniverseSymbols(universe, input.maxScan ?? 200)
        : [];

  const maxSymbols = Math.min(symbols.length, input.maxScan ?? 200);
  const workingSymbols = symbols.slice(0, maxSymbols).map((s) => s.toUpperCase().replace(/\.(NS|BO)$/i, ''));

  const presetFilters = input.preset ? PRESET_FILTERS[input.preset] ?? {} : {};
  const baseFilters: ScreenerFilters = { ...(presetFilters as ScreenerFilters), ...(input.filters ?? {}) };

  // Ensure TA evaluation is active even for callers that only pass preset/zone filters.
  baseFilters.show_ta = true;

  if (needsHourlyTaFilters(baseFilters)) {
    throw new Error('Screener PIT backtest MVP supports daily-only TA gates.');
  }

  const rows: ScreenerPitBacktestRow[] = [];

  for (let i = 0; i < workingSymbols.length; i++) {
    const symbol = workingSymbols[i];
    const bars = await fetchDailyBars(symbol, refresh);

    const lastIdx = bars.length - 1;
    const asOfIdx = lastIdx - asOfDaysAgo;
    const fwdIdx = asOfIdx + forwardDays;

    if (asOfIdx < 2 || fwdIdx > lastIdx) {
      rows.push({
        symbol,
        price_as_of: null,
        forward_return_pct: null,
        passed: false,
      });
      continue;
    }

    const slice = bars.slice(0, asOfIdx + 1);
    const priceAsOf = Number(slice[slice.length - 1]?.close ?? 0);

    let ta = enrichDetailTa(slice as any, priceAsOf);
    if (!ta) {
      rows.push({
        symbol,
        price_as_of: priceAsOf || null,
        forward_return_pct: null,
        passed: false,
      });
      continue;
    }

    const passed = passesTaFilters(ta as unknown as TaMetrics, baseFilters);

    const priceFwd = Number(bars[fwdIdx]?.close ?? 0);
    const forward_return_pct = Number.isFinite(priceAsOf) && priceAsOf !== 0 ? pct(priceAsOf, priceFwd) : null;

    rows.push({
      symbol,
      price_as_of: Number.isFinite(priceAsOf) ? priceAsOf : null,
      forward_return_pct: passed ? forward_return_pct : forward_return_pct,
      passed,
    });
  }

  const passedCount = rows.filter((r) => r.passed).length;
  return {
    ok: true,
    universe,
    asOfDaysAgo,
    forwardDays,
    total_symbols: workingSymbols.length,
    tested: rows.length,
    passed: passedCount,
    rows,
  };
}


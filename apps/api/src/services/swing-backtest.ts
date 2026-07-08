import type { SwingBacktestInput } from '@sv/shared';
import { runSwingBacktest } from '@sv/data-adapters';
import { resolveUniverseSymbols } from './universe.js';

export async function runSwingBacktestJob(input: SwingBacktestInput) {
  const options = {
    warmup: input.warmup,
    forward_sessions: input.forward_sessions,
    min_verdict: input.min_verdict,
    zone_52w: input.zone_52w,
    gc9_only: input.gc9_only,
    breakout_volume: input.breakout_volume,
    min_rules_passed: input.min_rules_passed,
    require_rules: input.require_rules,
  };

  let symbols: string[] = [];
  if (input.symbol?.trim()) {
    symbols = [input.symbol.trim().toUpperCase()];
  } else if (input.symbols?.length) {
    symbols = input.symbols.map((s) => s.toUpperCase());
  } else if (input.universe) {
    symbols = await resolveUniverseSymbols(input.universe, input.maxScan ?? 15);
  }

  if (symbols.length === 0) {
    throw new Error('symbol, symbols, or universe required');
  }

  const results = [];
  for (const sym of symbols.slice(0, 15)) {
    const result = await runSwingBacktest(sym, options, Boolean(input.refresh));
    results.push(result);
  }

  const combined = aggregateBacktest(results);

  return {
    ok: true,
    count: results.length,
    results,
    combined,
  };
}

function aggregateBacktest(results: Array<{ stats: Record<string, unknown> }>) {
  const totalSignals = results.reduce((s, r) => s + Number(r.stats.signal_count ?? 0), 0);
  const totalEnter = results.reduce((s, r) => s + Number(r.stats.enter_count ?? 0), 0);
  const winRates = results
    .map((r) => r.stats.win_rate_pct)
    .filter((v) => v !== null && v !== undefined) as number[];
  const avgWin =
    winRates.length > 0 ? Math.round((winRates.reduce((a, b) => a + b, 0) / winRates.length) * 10) / 10 : null;

  return {
    symbols: results.length,
    total_signals: totalSignals,
    total_enter_signals: totalEnter,
    avg_win_rate_pct: avgWin,
  };
}

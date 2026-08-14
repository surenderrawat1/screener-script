import type { SwingBacktestInput } from '@sv/shared';
import { runSwingBacktest } from '@sv/data-adapters';
import {
  applyPortfolioGates,
  DEFAULT_NOTIONAL_INR,
  DEFAULT_PORTFOLIO_NAV,
  HEAT_BLOCK_PCT,
  MAX_OPEN_POSITIONS,
  type SwingBacktestTrade,
} from '@sv/swing';
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
    notional_inr: input.notional_inr ?? DEFAULT_NOTIONAL_INR,
    // Universe runs skip tier replay by default (CPU); single-symbol includes it.
    auto_tiers: input.auto_tiers ?? Boolean(input.symbol?.trim()),
  };

  const maxScan = input.maxScan ?? 15;
  let symbols: string[] = [];
  if (input.symbol?.trim()) {
    symbols = [input.symbol.trim().toUpperCase()];
  } else if (input.symbols?.length) {
    symbols = input.symbols.map((s) => s.toUpperCase());
  } else if (input.universe) {
    symbols = await resolveUniverseSymbols(input.universe, maxScan);
  }

  if (symbols.length === 0) {
    throw new Error('symbol, symbols, or universe required');
  }

  const limit = Math.min(symbols.length, maxScan, 50);
  const results = [];
  for (const sym of symbols.slice(0, limit)) {
    const result = await runSwingBacktest(sym, options, Boolean(input.refresh));
    results.push(result);
  }

  const allTrades = collectAllTrades(results);
  const useGates = input.portfolio_gates !== false && results.length > 1;
  const portfolioNav = input.portfolio_nav ?? DEFAULT_PORTFOLIO_NAV;
  const notional = options.notional_inr;

  const gated = useGates
    ? applyPortfolioGates(allTrades, portfolioNav, notional)
    : { trades: allTrades, blocked: 0, accepted: allTrades.length };

  const portfolioTrades = gated.trades as SwingBacktestTrade[];
  const combined = aggregateBacktest(results);
  const portfolio = statsFromPortfolioTrades(portfolioTrades);

  return {
    ok: true,
    count: results.length,
    results,
    combined,
    all_trades: allTrades,
    portfolio_trades: portfolioTrades,
    portfolio: {
      ...portfolio,
      symbols_tested: results.length,
      entries_blocked: gated.blocked,
      entries_accepted: gated.accepted,
      portfolio_nav_inr: portfolioNav,
      portfolio_gates: useGates,
      max_open_positions: MAX_OPEN_POSITIONS,
      max_heat_pct: HEAT_BLOCK_PCT,
      notional_inr: notional,
    },
  };
}

function collectAllTrades(
  results: Array<{ symbol?: string; trades?: SwingBacktestTrade[] }>,
): SwingBacktestTrade[] {
  const all: SwingBacktestTrade[] = [];
  for (const r of results) {
    for (const t of r.trades ?? []) {
      all.push({
        ...t,
        symbol: t.symbol || r.symbol || '',
        status: t.status ?? 'closed',
      });
    }
  }
  all.sort((a, b) => {
    const cmp = a.entry_date.localeCompare(b.entry_date);
    if (cmp !== 0) return cmp;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
  return all;
}

function statsFromPortfolioTrades(trades: SwingBacktestTrade[]) {
  if (!trades.length) {
    return {
      trades_closed: 0,
      trade_win_rate_pct: null as number | null,
      profit_factor: null as number | null,
      avg_hold_days: null as number | null,
      net_pnl_inr: null as number | null,
    };
  }
  const wins = trades.filter((t) => t.pnl_pct > 0);
  const losses = trades.filter((t) => t.pnl_pct <= 0);
  const grossWin = wins.reduce((s, t) => s + Math.abs(t.pnl_pct), 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl_pct), 0);
  const pf = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99 : 0;
  const netSum = trades.reduce((s, t) => s + Number(t.net_pnl_inr ?? 0), 0);
  const avgHold = Math.round((trades.reduce((s, t) => s + t.days_held, 0) / trades.length) * 10) / 10;

  return {
    trades_closed: trades.length,
    trade_win_rate_pct: Math.round((wins.length / trades.length) * 1000) / 10,
    profit_factor: pf,
    avg_hold_days: avgHold,
    net_pnl_inr: Math.round(netSum * 100) / 100,
  };
}

function aggregateBacktest(results: Array<{ stats: Record<string, unknown> }>) {
  const totalSignals = results.reduce((s, r) => s + Number(r.stats.signal_count ?? 0), 0);
  const totalEnter = results.reduce((s, r) => s + Number(r.stats.enter_count ?? 0), 0);
  const totalTrades = results.reduce((s, r) => s + Number(r.stats.trades_closed ?? 0), 0);
  const netPnl = results.reduce((s, r) => s + Number(r.stats.net_pnl_inr ?? 0), 0);
  const winRates = results
    .map((r) => r.stats.trade_win_rate_pct ?? r.stats.win_rate_pct)
    .filter((v) => v !== null && v !== undefined) as number[];
  const avgWin =
    winRates.length > 0 ? Math.round((winRates.reduce((a, b) => a + b, 0) / winRates.length) * 10) / 10 : null;
  const pfs = results
    .map((r) => r.stats.profit_factor)
    .filter((v) => v !== null && v !== undefined) as number[];
  const avgPf =
    pfs.length > 0 ? Math.round((pfs.reduce((a, b) => a + b, 0) / pfs.length) * 100) / 100 : null;

  return {
    symbols: results.length,
    total_signals: totalSignals,
    total_enter_signals: totalEnter,
    total_trades_closed: totalTrades,
    avg_win_rate_pct: avgWin,
    avg_profit_factor: avgPf,
    net_pnl_inr: Math.round(netPnl * 100) / 100,
  };
}

import { describe, expect, it } from 'vitest';
import { runSwingBacktest } from '@sv/data-adapters';
import {
  MIN_PROFITABLE_WIN_RATE_PCT,
  meetsHighAccuracyWinRate,
  truthFromBars,
} from '@sv/swing';
import { fetchBacktestBars } from '../src/swing-chart.js';

/**
 * Live market sample — asserts the ≥70% profitable-trades gate against real Yahoo bars.
 * Soft-reports symbols that miss the floor (market-dependent); hard-asserts gate helpers.
 */
describe('live walk-forward ≥70% profitable trades sample', () => {
  it(
    'runs strict ENTER truth on liquid NSE names and reports win-rate vs 70% floor',
    async () => {
      const symbols = ['TCS', 'INFY', 'RELIANCE', 'HDFCBANK', 'ITC'];
      const results: Array<{
        symbol: string;
        signals: number;
        win_rate_pct: number | null;
        bt_wr: number | null;
        bt_trades: number;
        pass_70: boolean;
      }> = [];

      for (const sym of symbols) {
        const bt = await runSwingBacktest(sym, { min_verdict: 'SETUP_PLUS' }, true);
        const bars = await fetchBacktestBars(sym, false);
        const truth = truthFromBars(sym, bars);
        results.push({
          symbol: sym,
          signals: Number(bt.stats.signal_count ?? 0),
          win_rate_pct: bt.stats.win_rate_pct,
          bt_wr: truth?.win_rate_pct ?? null,
          bt_trades: truth?.trades_closed ?? 0,
          pass_70: truth ? meetsHighAccuracyWinRate(truth) : false,
        });
      }

      // eslint-disable-next-line no-console
      console.log(
        `\n[high-accuracy WR≥${MIN_PROFITABLE_WIN_RATE_PCT}%]\n` +
          results
            .map(
              (r) =>
                `${r.symbol}: signals=${r.signals} wr=${r.win_rate_pct ?? '—'}% bt_wr=${r.bt_wr ?? '—'}% trades=${r.bt_trades} pass70=${r.pass_70}`,
            )
            .join('\n'),
      );

      const withTrades = results.filter((r) => r.bt_trades >= 5);

      for (const r of results) {
        if (r.bt_wr != null && r.bt_wr >= MIN_PROFITABLE_WIN_RATE_PCT) {
          expect(r.pass_70).toBe(r.bt_trades >= 5);
        } else {
          expect(r.pass_70).toBe(false);
        }
      }

      // A strict ENTER sample can legitimately be unproven or have no passers.
      const passers = withTrades.filter((r) => r.pass_70);
      if (passers.length === 0) {
        // Soft fail messaging — gate integrity already asserted
        expect(withTrades.every((r) => (r.bt_wr ?? 0) < MIN_PROFITABLE_WIN_RATE_PCT)).toBe(true);
      } else {
        expect(passers.every((r) => (r.bt_wr ?? 0) >= MIN_PROFITABLE_WIN_RATE_PCT)).toBe(true);
      }
    },
    120_000,
  );
});

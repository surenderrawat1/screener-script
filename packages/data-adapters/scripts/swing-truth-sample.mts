import { fetchBacktestBars } from '../src/swing-chart.ts';
import { truthFromBars } from '@sv/swing';

const symbols = ['TCS', 'RELIANCE', 'INFY', 'HDFCBANK'];
for (const s of symbols) {
  try {
    const payload = await fetchBacktestBars(s, false);
    const bars = (payload as { bars?: unknown[] } | unknown[])?.bars
      ? (payload as { bars: unknown[] }).bars
      : ((payload as unknown[]) ?? []);
    const t = truthFromBars(s, bars as never);
    if (!t) {
      console.log(s, 'no truth / no trades');
      continue;
    }
    console.log(
      [
        s,
        'n=' + t.trades_closed,
        'WR=' + t.win_rate_pct,
        'E=' + t.expectancy_pct,
        'PF=' + t.profit_factor,
        'C=' + t.compounded_return_pct,
        'DD=' + t.max_drawdown_pct,
        'grade=' + t.grade,
        'edge=' + t.economic_edge_status,
      ].join(' | '),
    );
  } catch (e) {
    console.log(s, 'ERR', String(e).slice(0, 160));
  }
}

/**
 * Live EMA price-cross screener smoke test (daily + hourly).
 * Usage: pnpm exec tsx scripts/test-ema-price-cross.mts
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  attachHourlyPriceCrossMetrics,
  enrichDetailTa,
  passesTaFilters,
  priceMaCrossBarsAgo,
} from '@sv/swing';
import { fetchDailyBars, fetchHourlyBars } from '../src/swing-chart.js';
import { runLiveScreener } from '../src/screener-run.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

const SYMBOLS = ['TCS', 'RELIANCE', 'INFY', 'HDFCBANK', 'ITC', 'SBIN', 'AXISBANK', 'BHARTIARTL'];

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

console.error('=== Unit: EMA synthetic cross ===');
{
  // Build a series that crosses above EMA-20 on the last bar.
  const flat = Array(40).fill(100);
  const closes = [...flat, 101];
  const above = priceMaCrossBarsAgo(closes, 20, 'above', 'ema', 5);
  assert(above === 0, `expected EMA-20 cross above at barsAgo=0, got ${above}`);
  const belowCloses = [...flat, 99];
  const below = priceMaCrossBarsAgo(belowCloses, 20, 'below', 'ema', 5);
  assert(below === 0, `expected EMA-20 cross below at barsAgo=0, got ${below}`);
  console.error('  synthetic EMA-20 above/below: OK');
}

type Hit = {
  symbol: string;
  daily: Record<string, unknown>;
  hourly: Record<string, unknown>;
};

console.error('\n=== Live bars: daily + hourly EMA metrics ===');
const hits: Hit[] = [];
for (const symbol of SYMBOLS) {
  const dailyBars = await fetchDailyBars(symbol, false);
  const hourlyBars = await fetchHourlyBars(symbol, false);
  if (dailyBars.length < 30) {
    console.error(`  ${symbol}: skip (daily bars=${dailyBars.length})`);
    continue;
  }
  let ta = enrichDetailTa(dailyBars);
  if (hourlyBars.length >= 30) {
    ta = attachHourlyPriceCrossMetrics(ta, hourlyBars);
  }
  const daily = {
    above_ema20: ta.ta_cross_above_ema20,
    below_ema20: ta.ta_cross_below_ema20,
    above_ema50: ta.ta_cross_above_ema50,
    below_ema50: ta.ta_cross_below_ema50,
    above_ema20_bars: ta.ta_cross_above_ema20_bars,
    above_ema50_bars: ta.ta_cross_above_ema50_bars,
  };
  const hourly = {
    above_ema20: ta.ta_h_cross_above_ema20,
    below_ema20: ta.ta_h_cross_below_ema20,
    above_ema50: ta.ta_h_cross_above_ema50,
    below_ema50: ta.ta_h_cross_below_ema50,
    above_ema20_bars: ta.ta_h_cross_above_ema20_bars,
    above_ema50_bars: ta.ta_h_cross_above_ema50_bars,
    bars: hourlyBars.length,
  };
  hits.push({ symbol, daily, hourly });

  const gateDaily = passesTaFilters(ta, {
    cross_above_ema20: true,
    fresh_cross_bars: 5,
  });
  const gateHourly = passesTaFilters(ta, {
    hourly_cross_above_ema20: true,
    fresh_cross_bars: 5,
  });
  console.error(
    `  ${symbol.padEnd(12)} daily↑20=${daily.above_ema20 ? `Y@${daily.above_ema20_bars}` : 'n'} ↑50=${daily.above_ema50 ? `Y@${daily.above_ema50_bars}` : 'n'} ↓20=${daily.below_ema20 ? 'Y' : 'n'} | hourly(${hourly.bars}) ↑20=${hourly.above_ema20 ? `Y@${hourly.above_ema20_bars}` : 'n'} ↑50=${hourly.above_ema50 ? `Y@${hourly.above_ema50_bars}` : 'n'} | gateD20=${gateDaily} gateH20=${gateHourly}`,
  );
}

const dailyAbove20 = hits.filter((h) => h.daily.above_ema20 === true).map((h) => h.symbol);
const dailyAbove50 = hits.filter((h) => h.daily.above_ema50 === true).map((h) => h.symbol);
const hourlyAbove20 = hits.filter((h) => h.hourly.above_ema20 === true).map((h) => h.symbol);
const hourlyAbove50 = hits.filter((h) => h.hourly.above_ema50 === true).map((h) => h.symbol);

console.error('\n=== Summary (fresh default window / metrics bool) ===');
console.error(`  Daily  cross ↑ EMA-20: ${dailyAbove20.length ? dailyAbove20.join(', ') : '(none)'}`);
console.error(`  Daily  cross ↑ EMA-50: ${dailyAbove50.length ? dailyAbove50.join(', ') : '(none)'}`);
console.error(`  Hourly cross ↑ EMA-20: ${hourlyAbove20.length ? hourlyAbove20.join(', ') : '(none)'}`);
console.error(`  Hourly cross ↑ EMA-50: ${hourlyAbove50.length ? hourlyAbove50.join(', ') : '(none)'}`);

console.error('\n=== Screener run: daily EMA-20 ↑ (loose fund gates, nifty sample) ===');
const dailyRun = await runLiveScreener(
  SYMBOLS,
  undefined,
  {
    show_ta: true,
    min_roe: 1,
    min_roce: 1,
    max_pe: 80,
    min_mcap_cr: 1000,
    cross_above_ema20: true,
    fresh_cross_bars: 5,
  },
  undefined,
    { refresh: false, exclude_restricted: false, concurrency: 4 },
);
console.error(
  `  scanned=${dailyRun.scanned} passed=${dailyRun.rows.length} → ${dailyRun.rows.map((r) => r.symbol).join(', ') || '(none)'}`,
);

console.error('\n=== Screener run: hourly EMA-20 ↑ ===');
const hourlyRun = await runLiveScreener(
  SYMBOLS,
  undefined,
  {
    show_ta: true,
    min_roe: 1,
    min_roce: 1,
    max_pe: 80,
    min_mcap_cr: 1000,
    hourly_cross_above_ema20: true,
    fresh_cross_bars: 5,
  },
  undefined,
  { refresh: false, exclude_restricted: false, concurrency: 4 },
);
console.error(
  `  scanned=${hourlyRun.scanned} passed=${hourlyRun.rows.length} → ${hourlyRun.rows.map((r) => r.symbol).join(', ') || '(none)'}`,
);

for (const row of dailyRun.rows) {
  assert(row.ta_ready === true, `${row.symbol} missing ta_ready`);
  assert(
    row.ta_cross_above_ema20 === true ||
      (typeof row.ta_cross_above_ema20_bars === 'number' && row.ta_cross_above_ema20_bars < 5),
    `${row.symbol} daily EMA gate mismatch`,
  );
}
for (const row of hourlyRun.rows) {
  assert(row.ta_ready === true, `${row.symbol} missing ta_ready`);
  assert(
    row.ta_h_cross_above_ema20 === true ||
      (typeof row.ta_h_cross_above_ema20_bars === 'number' && row.ta_h_cross_above_ema20_bars < 5),
    `${row.symbol} hourly EMA gate mismatch (false positive?)`,
  );
}

console.error('\nEMA price-cross screener test complete.');
console.log(
  JSON.stringify(
    {
      unit: 'ok',
      sample: hits,
      screener_daily_ema20_up: dailyRun.rows.map((r) => ({
        symbol: r.symbol,
        ta_cross_above_ema20: r.ta_cross_above_ema20,
        bars: r.ta_cross_above_ema20_bars,
      })),
      screener_hourly_ema20_up: hourlyRun.rows.map((r) => ({
        symbol: r.symbol,
        ta_h_cross_above_ema20: r.ta_h_cross_above_ema20,
        bars: r.ta_h_cross_above_ema20_bars,
      })),
    },
    null,
    2,
  ),
);

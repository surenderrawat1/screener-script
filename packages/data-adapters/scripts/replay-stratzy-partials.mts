/**
 * Replay closed Stratzy paper trades against Yahoo 15m OHLC.
 * Compares legacy last-bar-only vs forward walk (current paper logic).
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  exitProfileFromEvidence,
  resolveExitProfile,
  resolveInstrument,
  walkIntradayPositionActions,
  type IntradayBar,
} from '@sv/intraday';
import { collectStratzyPaperData } from '../src/stratzy-paper-export.js';
import { fetchInstrumentIntradayChart } from '../src/intraday-chart.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

/** Pre-fix paper: only the final bar's OHLC was checked. */
function lastBarOnlyAction(
  position: Record<string, unknown>,
  bars: IntradayBar[],
): string {
  const last = bars[bars.length - 1];
  if (!last) return 'HOLD';
  const side = String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long';
  const isLong = side === 'long';
  const stop = Number(position.effective_stop ?? position.stop_loss ?? 0);
  const t1 = Number(position.target_t1 ?? 0);
  const high = Number(last.high ?? last.close);
  const low = Number(last.low ?? last.close);
  if (stop > 0 && (isLong ? low <= stop : high >= stop)) return 'EXIT_NOW';
  if (t1 > 0 && !position.t1_booked && (isLong ? high >= t1 : low <= t1)) return 'PARTIAL_T1';
  return 'HOLD';
}

function positionInput(row: Record<string, unknown>, profile: ReturnType<typeof resolveExitProfile>) {
  return {
    instrument_id: row.instrument_id,
    side: row.side,
    timeframe: row.timeframe,
    entry_price: row.entry_price,
    entry_time: row.entry_time,
    stop_loss: row.stop_loss,
    effective_stop: row.effective_stop ?? row.stop_loss,
    target_t1: row.target_t1,
    target_t2: row.target_t2,
    target_t3: row.target_t3,
    t1_booked: row.t1_booked,
    t2_booked: row.t2_booked,
    breakeven_armed: row.breakeven_armed,
    t1_book_pct: profile.partial_pcts[0],
    t2_book_pct: profile.partial_pcts[1],
    remaining_pct: row.remaining_pct ?? 100,
  };
}

const userId = argValue('--user');
const refresh = process.argv.includes('--refresh');

const bundle = await collectStratzyPaperData({ userId, includeOrders: false, includeLedger: false });

type ReplayRow = {
  symbol: string;
  session: string;
  side: string;
  entry: number;
  t1: number | null;
  exit: number | null;
  exit_reason: string | null;
  db_t1_booked: boolean;
  legacy_action: string;
  walk_action: string;
  walk_verdict: string;
  would_book_t1: boolean;
  bars: number;
};

const rows: ReplayRow[] = [];

for (const user of bundle.users) {
  for (const pos of user.intraday_stratzy.closed) {
    const meta = resolveInstrument(String(pos.instrument_id));
    if (!meta) {
      console.error(`Skip ${pos.symbol}: unknown instrument`);
      continue;
    }
    const tf = pos.timeframe === '5m' ? '5m' : '15m';
    const chart = await fetchInstrumentIntradayChart(
      meta.cache_key,
      meta.yahoo_symbols,
      meta.label,
      tf,
      refresh,
    );
    const bars = (chart?.bars ?? []).map((b) => ({
      close: b.close,
      high: b.high,
      low: b.low,
      time_label: b.time_label,
      time: b.time,
    }));
    const profile = exitProfileFromEvidence(pos.evidence);
    const input = positionInput(pos as Record<string, unknown>, profile);
    const legacy = lastBarOnlyAction(input, bars);
    const walked = walkIntradayPositionActions(input, bars);

    rows.push({
      symbol: String(pos.symbol),
      session: String(pos.entry_time ?? '').slice(0, 10),
      side: String(pos.side),
      entry: Number(pos.entry_price),
      t1: pos.target_t1 != null ? Number(pos.target_t1) : null,
      exit: pos.closed_price != null ? Number(pos.closed_price) : null,
      exit_reason: pos.closed_reason != null ? String(pos.closed_reason) : null,
      db_t1_booked: Boolean(pos.t1_booked),
      legacy_action: legacy,
      walk_action: walked.action,
      walk_verdict: walked.verdict,
      would_book_t1:
        walked.action === 'PARTIAL_T1' ||
        walked.action === 'PARTIAL_T2' ||
        walked.action === 'EXIT_TARGET' ||
        walked.simT1Booked,
      bars: bars.length,
    });
  }
}

const t1Missed = rows.filter((r) => !r.db_t1_booked && r.would_book_t1);
const legacyT1 = rows.filter((r) => r.legacy_action === 'PARTIAL_T1').length;
const walkT1 = rows.filter((r) => r.walk_action === 'PARTIAL_T1' || (r.would_book_t1 && !r.db_t1_booked)).length;

console.log('\nStratzy paper partial replay (closed trades)\n');
console.log(
  'symbol'.padEnd(12),
  'side'.padEnd(6),
  'exit'.padEnd(10),
  't1'.padEnd(10),
  'dbT1'.padEnd(6),
  'legacy'.padEnd(10),
  'walk'.padEnd(12),
  'reason',
);
console.log('-'.repeat(90));
for (const r of rows) {
  console.log(
    r.symbol.padEnd(12),
    r.side.padEnd(6),
    String(r.exit?.toFixed(2) ?? '—').padEnd(10),
    String(r.t1?.toFixed(2) ?? '—').padEnd(10),
    String(r.db_t1_booked).padEnd(6),
    r.legacy_action.padEnd(10),
    r.walk_action.padEnd(12),
    r.exit_reason ?? '',
  );
}

console.log('\nSummary');
console.log(`  Closed trades replayed : ${rows.length}`);
console.log(`  DB had t1_booked=true  : ${rows.filter((r) => r.db_t1_booked).length}`);
console.log(`  Legacy last-bar T1     : ${legacyT1}`);
console.log(`  Forward-walk would T1+ : ${t1Missed.length} (of ${rows.filter((r) => !r.db_t1_booked).length} without DB T1)`);
console.log('\nTrades where forward walk books T1 but DB did not:');
for (const r of t1Missed) {
  console.log(`  · ${r.symbol} ${r.side} exit=${r.exit?.toFixed(2)} t1=${r.t1?.toFixed(2)} → ${r.walk_action}`);
}

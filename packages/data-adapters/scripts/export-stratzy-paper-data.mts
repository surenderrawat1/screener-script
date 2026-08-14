import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
  collectStratzyPaperData,
  flattenClosedTradesForAnalysis,
  tradesToCsv,
} from '../src/stratzy-paper-export.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

const userId = argValue('--user');
const outDir =
  argValue('--out') ??
  resolve(process.cwd(), '../../data/exports/stratzy-paper', new Date().toISOString().slice(0, 10));

const bundle = await collectStratzyPaperData({
  userId,
  includeOrders: true,
  includeLedger: true,
});

mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, 'stratzy-paper-full.json');
const csvPath = resolve(outDir, 'stratzy-paper-closed-trades.csv');
const flat = flattenClosedTradesForAnalysis(bundle);

writeFileSync(jsonPath, JSON.stringify(bundle, null, 2), 'utf8');
writeFileSync(csvPath, tradesToCsv(flat), 'utf8');

console.error('Stratzy paper export (no restrictions)');
console.error('  JSON:', jsonPath);
console.error('  CSV :', csvPath);
console.error('  Totals:', JSON.stringify(bundle.totals));
for (const u of bundle.users) {
  console.error(
    `  ${u.email ?? u.user_id}: intraday ${u.intraday_stratzy.all.length} (closed ${u.intraday_stratzy.closed.length}) | swing ${u.swing_paper.all.length} (closed ${u.swing_paper.closed.length}) | archives ${u.swing_paper_archives.length}`,
  );
}

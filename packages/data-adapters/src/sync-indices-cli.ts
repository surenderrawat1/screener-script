#!/usr/bin/env tsx
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { syncAllIndicesFromDirectory } from './index-sync.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const defaultIndicesDir = resolve(here, '../../../../stock-verifier/data/indices');
const INDEX_KEYS = new Set(['nifty50', 'nifty100', 'nifty200', 'nifty250', 'nifty500', 'smallcap250']);

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--') && !INDEX_KEYS.has(a));
const indicesDir = dirArg ?? process.env.INDICES_DIR ?? defaultIndicesDir;
const keys = args.includes('--all') ? undefined : args.filter((a) => INDEX_KEYS.has(a));

async function main() {
  console.log(`Syncing indices from: ${indicesDir}`);
  const results = await syncAllIndicesFromDirectory(indicesDir, keys?.length ? keys : undefined);

  let ok = 0;
  for (const r of results) {
    if (r.ok) {
      ok++;
      console.log(
        `✓ ${r.indexKey}: ${r.count} symbols (${r.sourceFile}) +${r.added.length} -${r.removed.length}`,
      );
    } else {
      console.warn(`✗ ${r.indexKey}: ${r.error ?? 'failed'}${r.sourceFile ? ` (${r.sourceFile})` : ''}`);
    }
  }

  console.log(`Done: ${ok}/${results.length} indices synced`);
  process.exit(ok > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

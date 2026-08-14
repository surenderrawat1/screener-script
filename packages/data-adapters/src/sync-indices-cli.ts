#!/usr/bin/env tsx
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { listIndexKeys } from '@sv/shared';
import { bootstrapAppConfig } from './app-config.js';
import { syncAllIndicesFromDirectory } from './index-sync.js';
import { defaultIndicesDir } from './indices-dir.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const args = process.argv.slice(2);

async function main() {
  await bootstrapAppConfig();
  const known = new Set(listIndexKeys());
  const dirArg = args.find((a) => !a.startsWith('--') && !known.has(a));
  const indicesDir = dirArg ?? defaultIndicesDir();
  const keys = args.includes('--all') ? undefined : args.filter((a) => known.has(a));

  console.log(`Syncing indices from: ${indicesDir}`);
  console.log(`Registry keys: ${[...known].join(', ')}`);
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

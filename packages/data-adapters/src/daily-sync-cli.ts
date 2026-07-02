#!/usr/bin/env tsx
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { initAppConfig } from '@sv/shared';
import { runDailySync } from './daily-sync.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

const force = process.argv.includes('--force');

async function main() {
  await initAppConfig();
  console.log(`Daily sync starting${force ? ' (forced)' : ''}…`);
  const result = await runDailySync({ force, trigger: 'cli' });

  for (const step of result.steps) {
    const mark = step.ok ? '✓' : '✗';
    console.log(`${mark} ${step.id} (${step.action}) — ${step.duration_ms}ms`);
    if (step.error) console.warn(`   ${step.error}`);
    if (step.detail) console.log(`   ${JSON.stringify(step.detail)}`);
  }

  console.log(`Done: ${result.ok ? 'success' : 'failed'} · job ${result.job_id}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

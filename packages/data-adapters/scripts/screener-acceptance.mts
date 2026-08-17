/**
 * Screener acceptance: 200-symbol warm-cache job < 3 minutes (SCREENER.md).
 *
 * Usage:
 *   pnpm screener:acceptance
 *   pnpm screener:acceptance -- --universe nifty250 --maxScan 200 --preset quality
 *   pnpm screener:acceptance -- --skip-warm   # timed pass only (assumes cache already warm)
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { connectRedis } from '@sv/cache';
import { initAppConfig } from '@sv/shared';
import { runLiveScreener } from '../src/screener-run.js';
import { resolveUniverseSymbols } from '../src/universe.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

const WARM_BUDGET_MS = 180_000;

function argValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function runPass(
  label: string,
  symbols: string[],
  preset: string,
  refresh: boolean,
): Promise<{
  label: string;
  duration_ms: number;
  scanned: number;
  passed: number;
  cache_hits: number;
  stock_cache_hits: number;
  table_prefilter_skipped: number;
  full_analyzed: number;
}> {
  const t0 = Date.now();
  let lastProcessed = 0;
  const run = await runLiveScreener(
    symbols,
    preset,
    {},
    async (p) => {
      if (p.processed - lastProcessed >= 5 || p.processed === p.total) {
        lastProcessed = p.processed;
        process.stderr.write(
          `  [${label}] ${p.processed}/${p.total} · passed ${p.passed}\n`,
        );
      }
    },
    { refresh, concurrency: 8, exclude_restricted: true },
  );
  const duration_ms = Date.now() - t0;
  return {
    label,
    duration_ms,
    scanned: run.scanned ?? symbols.length,
    passed: run.rows.length,
    cache_hits: run.cache_hits ?? 0,
    stock_cache_hits: run.stock_cache_hits ?? 0,
    table_prefilter_skipped: run.table_prefilter_skipped ?? 0,
    full_analyzed: run.full_analyzed ?? 0,
  };
}

async function main() {
  const universe = argValue('--universe', 'nifty250');
  const maxScan = Math.max(1, Number(argValue('--maxScan', '200')) || 200);
  const preset = argValue('--preset', 'quality');
  const skipWarm = hasFlag('--skip-warm');
  const budgetMs = Math.max(30_000, Number(argValue('--budgetMs', String(WARM_BUDGET_MS))) || WARM_BUDGET_MS);

  await initAppConfig();
  await connectRedis().catch((err) => {
    console.warn('Redis connect warning:', err instanceof Error ? err.message : err);
  });

  const symbols = await resolveUniverseSymbols(universe, maxScan);
  if (symbols.length < Math.min(50, maxScan)) {
    throw new Error(
      `Universe ${universe} resolved only ${symbols.length} symbols (need ≥${Math.min(50, maxScan)}). Run pnpm sync:indices.`,
    );
  }

  console.error(
    `=== Screener acceptance · ${universe} · ${symbols.length} symbols · preset=${preset} · budget=${budgetMs}ms ===`,
  );

  let warmPass: Awaited<ReturnType<typeof runPass>> | null = null;
  if (!skipWarm) {
    console.error('--- Pass 1: warm caches (not timed for gate) ---');
    warmPass = await runPass('warm', symbols, preset, false);
    console.error(
      `  warm done in ${(warmPass.duration_ms / 1000).toFixed(1)}s · passed ${warmPass.passed} · row-cache ${warmPass.cache_hits} · stock-cache ${warmPass.stock_cache_hits}`,
    );
  }

  console.error('--- Pass 2: warm-cache timed run ---');
  const timed = await runPass('timed', symbols, preset, false);
  const ok = timed.duration_ms <= budgetMs;
  const report = {
    ok,
    criterion: `200-symbol warm cache < ${budgetMs / 1000}s`,
    universe,
    preset,
    symbol_count: symbols.length,
    budget_ms: budgetMs,
    warm_pass: warmPass,
    timed_pass: timed,
    measured_at: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  if (!ok) {
    console.error(
      `FAIL: warm run ${(timed.duration_ms / 1000).toFixed(1)}s exceeds ${budgetMs / 1000}s budget`,
    );
    process.exit(1);
  }
  console.error(
    `PASS: warm run ${(timed.duration_ms / 1000).toFixed(1)}s ≤ ${budgetMs / 1000}s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { ScreenerRow } from '@sv/shared';
import {
  getStrategy,
  STRATEGY_ENGINE_HYBRID,
  STRATEGY_ENGINE_SCREENER,
  STRATEGY_ENGINE_SWING,
  type StrategyDefinition,
} from '@sv/swing';
import { resolveUniverseSymbols } from './universe.js';
import { runLiveScreener } from './screener-run.js';
import { runSwingScan } from './swing-scan.js';

export interface StrategyRunInput {
  strategy: string;
  universe?: string;
  maxScan?: number;
  refresh?: boolean;
}

export interface StrategySwingResult {
  engine: 'swing';
  strategy: string;
  label: string;
  universe: string;
  scanned: number;
  hits: Array<Record<string, unknown>>;
  skipped: number;
}

export interface StrategyScreenerResult {
  engine: 'screener';
  strategy: string;
  label: string;
  universe: string;
  scanned: number;
  passed: number;
  rows: ScreenerRow[];
  restricted_skipped?: number;
  cache_hits?: number;
}

export interface StrategyHybridResult {
  engine: 'hybrid';
  strategy: string;
  label: string;
  universe: string;
  screener_passed: number;
  scanned: number;
  hits: Array<Record<string, unknown>>;
  skipped: number;
}

export type StrategyRunResult = StrategySwingResult | StrategyScreenerResult | StrategyHybridResult;

function effectiveMaxScan(def: StrategyDefinition, override?: number, symbolCount = 0): number {
  if (override != null && override > 0) return override;
  if (def.max_scan_default > 0) return def.max_scan_default;
  return symbolCount || 200;
}

export async function runStrategy(input: StrategyRunInput): Promise<StrategyRunResult> {
  const def = getStrategy(input.strategy);
  if (!def) throw new Error(`Unknown strategy: ${input.strategy}`);
  if (!def.ready) {
    throw new Error(def.blocked_reason ?? `Strategy "${input.strategy}" is not ready`);
  }

  const universe = input.universe?.trim() || def.universe_default;
  const refresh = Boolean(input.refresh);

  if (def.engine === STRATEGY_ENGINE_SWING) {
    const allSymbols = await resolveUniverseSymbols(universe, 2000);
    const maxScan = effectiveMaxScan(def, input.maxScan, allSymbols.length);
    const symbols = allSymbols.slice(0, maxScan);
    const result = await runSwingScan(
      symbols,
      {
        min_verdict: def.min_verdict,
        zone_52w: def.zone_52w,
        breakout_volume: def.breakout_volume,
        sort_by: def.sort_by,
      },
      refresh,
    );
    return {
      engine: 'swing',
      strategy: def.key,
      label: def.label,
      universe,
      scanned: symbols.length,
      hits: result.hits as Array<Record<string, unknown>>,
      skipped: result.skipped,
    };
  }

  if (def.engine === STRATEGY_ENGINE_SCREENER) {
    const maxScan = effectiveMaxScan(def, input.maxScan, 500);
    const symbols = await resolveUniverseSymbols(universe, maxScan);
    const run = await runLiveScreener(symbols, def.preset, {}, undefined, { refresh });
    return {
      engine: 'screener',
      strategy: def.key,
      label: def.label,
      universe,
      scanned: run.scanned,
      passed: run.rows.length,
      rows: run.rows,
      restricted_skipped: run.restricted_skipped,
      cache_hits: run.cache_hits,
    };
  }

  if (def.engine === STRATEGY_ENGINE_HYBRID) {
    const maxScan = effectiveMaxScan(def, input.maxScan, 500);
    const symbols = await resolveUniverseSymbols(universe, maxScan);
    const screenerCap = def.screener_max ?? maxScan;
    const screenerRun = await runLiveScreener(
      symbols.slice(0, screenerCap),
      def.screener_preset,
      {},
      undefined,
      { refresh },
    );
    const passerSymbols = screenerRun.rows.map((r) => r.symbol);
    const swingResult = await runSwingScan(
      passerSymbols,
      {
        min_verdict: def.min_verdict,
        sort_by: def.sort_by,
      },
      refresh,
    );
    return {
      engine: 'hybrid',
      strategy: def.key,
      label: def.label,
      universe,
      screener_passed: screenerRun.rows.length,
      scanned: passerSymbols.length,
      hits: swingResult.hits as Array<Record<string, unknown>>,
      skipped: swingResult.skipped,
    };
  }

  throw new Error(`Unsupported engine for ${def.key}`);
}

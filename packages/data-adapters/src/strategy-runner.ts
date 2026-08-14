import type { ScreenerRow } from '@sv/shared';
import {
  getStrategy,
  STRATEGY_ENGINE_HYBRID,
  STRATEGY_ENGINE_SCREENER,
  STRATEGY_ENGINE_SWING,
  type StrategyDefinition,
  type SwingScanOptions,
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

export interface StrategyRunProgress {
  /** Hybrid: screener then swing. Single-engine runs use matching phase. */
  phase: 'screener' | 'swing' | 'done';
  processed: number;
  total: number;
  passed: number;
  stage_label?: string;
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

export type StrategyProgressCallback = (progress: StrategyRunProgress) => void | Promise<void>;

function effectiveMaxScan(def: StrategyDefinition, override?: number, symbolCount = 0): number {
  if (override != null && override > 0) return override;
  if (def.max_scan_default > 0) return def.max_scan_default;
  return symbolCount || 200;
}

/** Human label for StrategiesPage / job progress UI. */
export function strategyProgressLabel(progress: StrategyRunProgress): string {
  if (progress.phase === 'screener') {
    return progress.stage_label ?? 'Stage 1 · CFA screener';
  }
  if (progress.phase === 'swing') {
    return progress.stage_label ?? 'Stage 2 · swing scan';
  }
  return progress.stage_label ?? 'Done';
}

export async function runStrategy(
  input: StrategyRunInput,
  onProgress?: StrategyProgressCallback,
): Promise<StrategyRunResult> {
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
    await onProgress?.({
      phase: 'swing',
      total: symbols.length,
      processed: 0,
      passed: 0,
      stage_label: 'Swing scan',
    });
    const result = await runSwingScan(
      symbols,
      {
        min_verdict: def.min_verdict,
        zone_52w: def.zone_52w,
        breakout_volume: def.breakout_volume,
        sort_by: def.sort_by as SwingScanOptions['sort_by'],
        require_rules: def.require_rules,
        min_rules_passed: def.min_rules_passed,
        onProgress: async (p) => {
          await onProgress?.({
            phase: 'swing',
            total: p.total,
            processed: p.processed,
            passed: p.passed ?? 0,
            stage_label: 'Swing scan',
          });
        },
      },
      refresh,
    );
    const out: StrategySwingResult = {
      engine: 'swing',
      strategy: def.key,
      label: def.label,
      universe,
      scanned: symbols.length,
      hits: result.hits as Array<Record<string, unknown>>,
      skipped: result.skipped,
    };
    await onProgress?.({
      phase: 'done',
      total: out.scanned,
      processed: out.scanned,
      passed: out.hits.length,
    });
    return out;
  }

  if (def.engine === STRATEGY_ENGINE_SCREENER) {
    const maxScan = effectiveMaxScan(def, input.maxScan, 500);
    const symbols = await resolveUniverseSymbols(universe, maxScan);
    await onProgress?.({
      phase: 'screener',
      total: symbols.length,
      processed: 0,
      passed: 0,
      stage_label: 'CFA screener',
    });
    const run = await runLiveScreener(
      symbols,
      def.preset,
      {},
      async (p) => {
        await onProgress?.({
          phase: 'screener',
          total: p.total,
          processed: p.processed,
          passed: p.passed,
          stage_label: 'CFA screener',
        });
      },
      { refresh },
    );
    const out: StrategyScreenerResult = {
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
    await onProgress?.({
      phase: 'done',
      total: out.scanned,
      processed: out.scanned,
      passed: out.passed,
    });
    return out;
  }

  if (def.engine === STRATEGY_ENGINE_HYBRID) {
    const maxScan = effectiveMaxScan(def, input.maxScan, 500);
    const symbols = await resolveUniverseSymbols(universe, maxScan);
    const screenerCap = def.screener_max ?? maxScan;
    const screenerSymbols = symbols.slice(0, screenerCap);

    await onProgress?.({
      phase: 'screener',
      total: screenerSymbols.length,
      processed: 0,
      passed: 0,
      stage_label: 'Stage 1 · CFA screener',
    });

    const screenerRun = await runLiveScreener(
      screenerSymbols,
      def.screener_preset,
      {},
      async (p) => {
        await onProgress?.({
          phase: 'screener',
          total: p.total,
          processed: p.processed,
          passed: p.passed,
          stage_label: 'Stage 1 · CFA screener',
        });
      },
      { refresh },
    );

    const passerSymbols = screenerRun.rows.map((r) => r.symbol);

    await onProgress?.({
      phase: 'swing',
      total: passerSymbols.length,
      processed: 0,
      passed: screenerRun.rows.length,
      stage_label: `Stage 2 · swing (${passerSymbols.length} passers)`,
    });

    const swingResult = await runSwingScan(
      passerSymbols,
      {
        min_verdict: def.min_verdict,
        sort_by: def.sort_by as SwingScanOptions['sort_by'],
        onProgress: async (p) => {
          await onProgress?.({
            phase: 'swing',
            total: p.total,
            processed: p.processed,
            passed: p.passed ?? 0,
            stage_label: `Stage 2 · swing (${passerSymbols.length} passers)`,
          });
        },
      },
      refresh,
    );

    const out: StrategyHybridResult = {
      engine: 'hybrid',
      strategy: def.key,
      label: def.label,
      universe,
      screener_passed: screenerRun.rows.length,
      scanned: passerSymbols.length,
      hits: swingResult.hits as Array<Record<string, unknown>>,
      skipped: swingResult.skipped,
    };

    await onProgress?.({
      phase: 'done',
      total: out.scanned,
      processed: out.scanned,
      passed: out.hits.length,
      stage_label: `Done · ${out.screener_passed} screened → ${out.hits.length} hits`,
    });

    return out;
  }

  throw new Error(`Unsupported engine for ${def.key}`);
}

import { CACHE_TTL } from './constants.js';
import { deepMerge, readYamlFile, resolveConfigRoot } from './config-loader.js';
import {
  bindIndexDefinitionsGetter,
  DEFAULT_INDEX_DEFINITIONS,
  normalizeIndexDefinitions,
  type IndicesFileConfig,
} from './indices.js';
import {
  bindEtfCatalogGetter,
  DEFAULT_ETFS_FILE,
  normalizeEtfCatalog,
  type EtfsFileConfig,
} from './etfs.js';

export interface DataPolicyConfig {
  version: number;
  timezone: string;
  cache_ttl: Record<string, number>;
  staleness: {
    index_max_age_days: number;
    nse_equity_max_age_days: number;
    holdings_max_age_days: number;
  };
  prefetch: {
    enabled: boolean;
    universes: string[];
    include_open_positions: boolean;
    max_symbols_per_batch: number;
    delay_ms_between_batches: number;
  };
  on_demand: {
    allow_refresh_param: boolean;
    rate_limit_per_user_per_hour: number;
  };
}

export interface ScheduleStep {
  id: string;
  at: string;
  action: string;
  enabled: boolean;
  params?: Record<string, unknown>;
}

export interface SchedulesConfig {
  version: number;
  daily_sync: {
    enabled: boolean;
    name: string;
    description: string;
    cron: string;
    timezone: string;
    skip_if_completed_today: boolean;
    steps: ScheduleStep[];
  };
  intraday: {
    ltg_auto_scan?: {
      enabled: boolean;
      interval_sec: number;
      universe?: string;
      max_scan?: number;
    };
    swing_auto_scan: { enabled: boolean; interval_sec: number };
    regime_refresh: { enabled: boolean; interval_sec: number };
    morning_prewarm?: {
      enabled: boolean;
      cron: string;
      timezone: string;
    };
    paper_auto_trade?: {
      enabled: boolean;
      interval_sec: number;
      max_notional_inr?: number;
      max_open_positions?: number;
      skip_accuracy_gate?: boolean;
    };
    swing_paper_auto_trade?: {
      enabled: boolean;
      interval_sec: number;
    };
    evening_gtt?: {
      enabled: boolean;
      cron: string;
      timezone: string;
      tiers?: string[];
      max_orders?: number;
      limit_premium_pct?: number;
      send_email?: boolean;
    };
    strategy_daily_proof?: {
      enabled: boolean;
      cron: string;
      timezone: string;
      strategies?: string[];
      max_scan?: number;
      skip_weekends?: boolean;
    };
    exit_alerts?: {
      enabled: boolean;
      cron: string;
      timezone: string;
      skip_weekends?: boolean;
      include_swing?: boolean;
      include_intraday?: boolean;
      max_positions_per_book?: number;
    };
  };
}

/** Product knobs for emails / GTT / exit alerts — `config/alerts.yaml`. */
export interface AlertsConfig {
  version: number;
  email?: {
    evening_gtt?: boolean;
    exit_alerts?: boolean;
    swing_radar?: boolean;
    morning_exits?: boolean;
    pattern_alerts?: boolean;
  };
  /** WhatsApp channel flags (env credentials still required; WHATSAPP_ALERTS=0 hard-off). */
  whatsapp?: {
    swing_radar?: boolean;
    evening_gtt?: boolean;
    exit_alerts?: boolean;
    pattern_alerts?: boolean;
  };
  evening_gtt?: {
    tiers?: string[];
    max_orders?: number;
    limit_premium_pct?: number;
    send_email?: boolean;
  };
  exit_alerts?: {
    include_swing?: boolean;
    include_intraday?: boolean;
    skip_weekends?: boolean;
    max_positions_per_book?: number;
  };
}

/** Daily strategy proof allowlist — `config/strategy-daily-proof.yaml`. */
export interface StrategyDailyProofFileConfig {
  version: number;
  enabled?: boolean;
  skip_weekends?: boolean;
  max_scan?: number;
  strategies?: string[];
}

export interface ScreenerPresetsFile {
  version: number;
  presets: Record<
    string,
    {
      label: string;
      filters: Record<string, number>;
      is_system: boolean;
      enabled?: boolean;
    }
  >;
}

export interface AppConfig {
  configRoot: string;
  dataPolicy: DataPolicyConfig;
  schedules: SchedulesConfig;
  alerts: AlertsConfig;
  strategyDailyProof: StrategyDailyProofFileConfig;
  indices: IndicesFileConfig;
  etfs: EtfsFileConfig;
  screenerPresets: ScreenerPresetsFile | null;
  settingsOverrides: Record<string, unknown>;
}

export interface CacheTtlMap {
  universe: number;
  index_symbols: number;
  screener_table: number;
  screener_row: number;
  ta: number;
  stock: number;
  verify: number;
  yahoo: number;
  job_progress: number;
  intraday: number;
  intraday_state: number;
  swing_auto_snapshot: number;
  regime: number;
  morning_etf: number;
  morning_bundle: number;
}

const DEFAULT_DATA_POLICY: DataPolicyConfig = {
  version: 1,
  timezone: 'Asia/Kolkata',
  cache_ttl: {
    stock: CACHE_TTL.stock,
    yahoo_raw: CACHE_TTL.yahoo,
    screener_row: CACHE_TTL.screener_row,
    screener_table: CACHE_TTL.screener_table,
    ta: CACHE_TTL.ta,
    universe: CACHE_TTL.universe,
    index_meta: CACHE_TTL.index_symbols,
    regime: CACHE_TTL.regime,
    swing_auto: CACHE_TTL.swing_auto_snapshot,
    intraday_chart: CACHE_TTL.intraday,
    morning_etf: CACHE_TTL.morning_etf,
    morning_bundle: CACHE_TTL.morning_bundle,
    intraday_state: CACHE_TTL.intraday_state,
  },
  staleness: {
    index_max_age_days: 90,
    nse_equity_max_age_days: 30,
    holdings_max_age_days: 90,
  },
  prefetch: {
    enabled: true,
    universes: ['nifty50', 'nifty500'],
    include_open_positions: true,
    max_symbols_per_batch: 50,
    delay_ms_between_batches: 200,
  },
  on_demand: {
    allow_refresh_param: true,
    rate_limit_per_user_per_hour: 30,
  },
};

const DEFAULT_SCHEDULES: SchedulesConfig = {
  version: 1,
  daily_sync: {
    enabled: true,
    name: 'daily_data_sync',
    description: 'Refresh reference data and warm market caches once per day',
    cron: '0 6 * * *',
    timezone: 'Asia/Kolkata',
    skip_if_completed_today: true,
    steps: [],
  },
  intraday: {
    ltg_auto_scan: {
      enabled: true,
      interval_sec: 900,
      universe: 'nifty250',
      max_scan: 250,
    },
    swing_auto_scan: { enabled: true, interval_sec: 300 },
    regime_refresh: { enabled: true, interval_sec: 900 },
    morning_prewarm: {
      enabled: true,
      cron: '45 8 * * *',
      timezone: 'Asia/Kolkata',
    },
    paper_auto_trade: {
      enabled: true,
      interval_sec: 60,
      max_notional_inr: 30_000,
      max_open_positions: 10,
      skip_accuracy_gate: true,
    },
    swing_paper_auto_trade: {
      enabled: true,
      interval_sec: 60,
    },
    evening_gtt: {
      enabled: true,
      cron: '0 16 * * *',
      timezone: 'Asia/Kolkata',
      tiers: ['high_conviction', 'strict_enter'],
      max_orders: 15,
      limit_premium_pct: 0.2,
      send_email: true,
    },
    strategy_daily_proof: {
      enabled: true,
      cron: '15 16 * * *',
      timezone: 'Asia/Kolkata',
      strategies: [
        'swing_strict_enter',
        'swing_ma20_stratzy',
        'swing_breakout_volume',
        'swing_best_r',
        'hybrid_quality_swing',
      ],
      max_scan: 60,
      skip_weekends: true,
    },
    exit_alerts: {
      enabled: true,
      cron: '45 15 * * *',
      timezone: 'Asia/Kolkata',
      skip_weekends: true,
      include_swing: true,
      include_intraday: true,
      max_positions_per_book: 50,
    },
  },
};

const DEFAULT_ALERTS: AlertsConfig = {
  version: 1,
  email: {
    evening_gtt: true,
    exit_alerts: true,
    swing_radar: true,
    morning_exits: true,
    pattern_alerts: true,
  },
  whatsapp: {
    swing_radar: true,
    evening_gtt: true,
    exit_alerts: true,
    pattern_alerts: true,
  },
  evening_gtt: {
    tiers: ['high_conviction', 'strict_enter'],
    max_orders: 15,
    limit_premium_pct: 0.2,
    send_email: true,
  },
  exit_alerts: {
    include_swing: true,
    include_intraday: true,
    skip_weekends: true,
    max_positions_per_book: 50,
  },
};

const DEFAULT_STRATEGY_DAILY_PROOF: StrategyDailyProofFileConfig = {
  version: 1,
  enabled: true,
  skip_weekends: true,
  max_scan: 60,
  strategies: [
    'swing_strict_enter',
    'swing_ma20_stratzy',
    'swing_breakout_volume',
    'swing_best_r',
    'hybrid_quality_swing',
  ],
};

let cached: AppConfig | null = null;

function mapYamlTtlToRuntime(yamlTtl: Record<string, number>): CacheTtlMap {
  return {
    universe: yamlTtl.universe ?? CACHE_TTL.universe,
    index_symbols: yamlTtl.index_meta ?? CACHE_TTL.index_symbols,
    screener_table: yamlTtl.screener_table ?? CACHE_TTL.screener_table,
    screener_row: yamlTtl.screener_row ?? CACHE_TTL.screener_row,
    ta: yamlTtl.ta ?? CACHE_TTL.ta,
    stock: yamlTtl.stock ?? CACHE_TTL.stock,
    verify: yamlTtl.verify ?? CACHE_TTL.verify,
    yahoo: yamlTtl.yahoo_raw ?? CACHE_TTL.yahoo,
    job_progress: CACHE_TTL.job_progress,
    intraday: yamlTtl.intraday_chart ?? CACHE_TTL.intraday,
    swing_auto_snapshot: yamlTtl.swing_auto ?? CACHE_TTL.swing_auto_snapshot,
    regime: yamlTtl.regime ?? CACHE_TTL.regime,
    morning_etf: yamlTtl.morning_etf ?? CACHE_TTL.morning_etf,
    morning_bundle: yamlTtl.morning_bundle ?? CACHE_TTL.morning_bundle,
    intraday_state: yamlTtl.intraday_state ?? CACHE_TTL.intraday_state,
  };
}

export function buildAppConfig(
  configRoot = resolveConfigRoot(),
  settingsOverrides: Record<string, unknown> = {},
): AppConfig {
  const filePolicy = readYamlFile<Partial<DataPolicyConfig>>(configRoot, 'data-policy.yaml');
  const fileSchedules = readYamlFile<Partial<SchedulesConfig>>(configRoot, 'schedules.yaml');
  const fileAlerts = readYamlFile<Partial<AlertsConfig>>(configRoot, 'alerts.yaml');
  const fileStrategyProof = readYamlFile<Partial<StrategyDailyProofFileConfig>>(
    configRoot,
    'strategy-daily-proof.yaml',
  );
  const fileIndices = readYamlFile<Partial<IndicesFileConfig> & { definitions?: Record<string, unknown> }>(
    configRoot,
    'indices.yaml',
  );
  const fileEtfs = readYamlFile<Partial<EtfsFileConfig> & { entries?: unknown }>(configRoot, 'etfs.yaml');
  const screenerPresets = readYamlFile<ScreenerPresetsFile>(configRoot, 'presets/screener.yaml');

  const mergedPolicy = deepMerge(
    DEFAULT_DATA_POLICY as unknown as Record<string, unknown>,
    {
      ...(filePolicy ?? {}),
      ...((settingsOverrides.dataPolicy as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as DataPolicyConfig;

  const mergedAlerts = deepMerge(
    DEFAULT_ALERTS as unknown as Record<string, unknown>,
    {
      ...(fileAlerts ?? {}),
      ...((settingsOverrides.alerts as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as AlertsConfig;

  const mergedStrategyProof = deepMerge(
    DEFAULT_STRATEGY_DAILY_PROOF as unknown as Record<string, unknown>,
    {
      ...(fileStrategyProof ?? {}),
      ...((settingsOverrides.strategyDailyProof as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as StrategyDailyProofFileConfig;

  const overrideIndices = settingsOverrides.indices as
    | { version?: number; definitions?: Record<string, unknown> }
    | undefined;
  // Definitions replace (not deep-merge) when Admin saves a full registry.
  const fileDefs = normalizeIndexDefinitions(
    (fileIndices?.definitions as Record<string, unknown> | undefined) ??
      (DEFAULT_INDEX_DEFINITIONS as unknown as Record<string, unknown>),
  );
  const effectiveDefs =
    overrideIndices?.definitions != null
      ? normalizeIndexDefinitions(overrideIndices.definitions)
      : Object.keys(fileDefs).length > 0
        ? fileDefs
        : DEFAULT_INDEX_DEFINITIONS;
  const mergedIndices: IndicesFileConfig = {
    version: Number(overrideIndices?.version ?? fileIndices?.version ?? 1) || 1,
    definitions: effectiveDefs,
  };

  const overrideEtfs = settingsOverrides.etfs as { version?: number; entries?: unknown } | undefined;
  const fileEtfEntries = normalizeEtfCatalog(fileEtfs?.entries ?? DEFAULT_ETFS_FILE.entries);
  const effectiveEtfs =
    overrideEtfs?.entries != null ? normalizeEtfCatalog(overrideEtfs.entries) : fileEtfEntries;
  const mergedEtfs: EtfsFileConfig = {
    version: Number(overrideEtfs?.version ?? fileEtfs?.version ?? 1) || 1,
    entries: effectiveEtfs.length > 0 ? effectiveEtfs : DEFAULT_ETFS_FILE.entries,
  };

  let mergedSchedules = deepMerge(
    DEFAULT_SCHEDULES as unknown as Record<string, unknown>,
    {
      ...(fileSchedules ?? {}),
      ...((settingsOverrides.schedules as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as SchedulesConfig;

  // Overlay product knobs from alerts.yaml / strategy-daily-proof.yaml onto schedule blocks
  // so existing getSchedules() callers pick up editable settings without code changes.
  mergedSchedules = deepMerge(mergedSchedules as unknown as Record<string, unknown>, {
    intraday: {
      evening_gtt: {
        ...(mergedAlerts.evening_gtt ?? {}),
      },
      exit_alerts: {
        ...(mergedAlerts.exit_alerts ?? {}),
      },
      strategy_daily_proof: {
        enabled: mergedStrategyProof.enabled,
        skip_weekends: mergedStrategyProof.skip_weekends,
        max_scan: mergedStrategyProof.max_scan,
        strategies: mergedStrategyProof.strategies,
      },
    },
  }) as unknown as SchedulesConfig;

  return {
    configRoot,
    dataPolicy: mergedPolicy,
    schedules: mergedSchedules,
    alerts: mergedAlerts,
    strategyDailyProof: mergedStrategyProof,
    indices: mergedIndices,
    etfs: mergedEtfs,
    screenerPresets,
    settingsOverrides,
  };
}

/** Load config from disk (and optional DB overrides). Safe to call multiple times. */
export async function initAppConfig(settingsOverrides: Record<string, unknown> = {}): Promise<AppConfig> {
  cached = buildAppConfig(resolveConfigRoot(), settingsOverrides);
  bindIndexDefinitionsGetter(() => cached!.indices.definitions);
  bindEtfCatalogGetter(() => cached!.etfs.entries);
  return cached;
}

export function reloadAppConfig(settingsOverrides: Record<string, unknown> = {}): AppConfig {
  cached = buildAppConfig(resolveConfigRoot(), settingsOverrides);
  bindIndexDefinitionsGetter(() => cached!.indices.definitions);
  bindEtfCatalogGetter(() => cached!.etfs.entries);
  return cached;
}

export function getAppConfig(): AppConfig {
  if (!cached) {
    cached = buildAppConfig();
    bindIndexDefinitionsGetter(() => cached!.indices.definitions);
    bindEtfCatalogGetter(() => cached!.etfs.entries);
  }
  return cached;
}

export function getIndicesConfig(): IndicesFileConfig {
  return getAppConfig().indices;
}

export function getDataPolicy(): DataPolicyConfig {
  return getAppConfig().dataPolicy;
}

export function getSchedules(): SchedulesConfig {
  return getAppConfig().schedules;
}

export function getAlertsConfig(): AlertsConfig {
  return getAppConfig().alerts;
}

export function getStrategyDailyProofConfig(): StrategyDailyProofFileConfig {
  return getAppConfig().strategyDailyProof;
}

/** Runtime TTL map — reads from config when loaded, else code defaults. */
export function getCacheTtl(): CacheTtlMap {
  const policy = getAppConfig().dataPolicy;
  return mapYamlTtlToRuntime(policy.cache_ttl ?? {});
}

export function getDailySyncCron(): string {
  return getSchedules().daily_sync.cron;
}

export function getConfigTimezone(): string {
  return getDataPolicy().timezone;
}

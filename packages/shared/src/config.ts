import { CACHE_TTL } from './constants.js';
import { deepMerge, readYamlFile, resolveConfigRoot } from './config-loader.js';

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
    swing_auto_scan: { enabled: boolean; interval_sec: number };
    regime_refresh: { enabled: boolean; interval_sec: number };
    morning_prewarm?: {
      enabled: boolean;
      cron: string;
      timezone: string;
    };
  };
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
  swing_auto_snapshot: number;
  regime: number;
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
    swing_auto_scan: { enabled: true, interval_sec: 300 },
    regime_refresh: { enabled: true, interval_sec: 900 },
    morning_prewarm: {
      enabled: true,
      cron: '45 8 * * *',
      timezone: 'Asia/Kolkata',
    },
  },
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
    verify: yamlTtl.stock ?? CACHE_TTL.verify,
    yahoo: yamlTtl.yahoo_raw ?? CACHE_TTL.yahoo,
    job_progress: CACHE_TTL.job_progress,
    intraday: yamlTtl.intraday_chart ?? CACHE_TTL.intraday,
    swing_auto_snapshot: yamlTtl.swing_auto ?? CACHE_TTL.swing_auto_snapshot,
    regime: yamlTtl.regime ?? CACHE_TTL.regime,
  };
}

export function buildAppConfig(
  configRoot = resolveConfigRoot(),
  settingsOverrides: Record<string, unknown> = {},
): AppConfig {
  const filePolicy = readYamlFile<Partial<DataPolicyConfig>>(configRoot, 'data-policy.yaml');
  const fileSchedules = readYamlFile<Partial<SchedulesConfig>>(configRoot, 'schedules.yaml');
  const screenerPresets = readYamlFile<ScreenerPresetsFile>(configRoot, 'presets/screener.yaml');

  const mergedPolicy = deepMerge(
    DEFAULT_DATA_POLICY as unknown as Record<string, unknown>,
    {
      ...(filePolicy ?? {}),
      ...((settingsOverrides.dataPolicy as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as DataPolicyConfig;

  const mergedSchedules = deepMerge(
    DEFAULT_SCHEDULES as unknown as Record<string, unknown>,
    {
      ...(fileSchedules ?? {}),
      ...((settingsOverrides.schedules as Record<string, unknown> | undefined) ?? {}),
    },
  ) as unknown as SchedulesConfig;

  return {
    configRoot,
    dataPolicy: mergedPolicy,
    schedules: mergedSchedules,
    screenerPresets,
    settingsOverrides,
  };
}

/** Load config from disk (and optional DB overrides). Safe to call multiple times. */
export async function initAppConfig(settingsOverrides: Record<string, unknown> = {}): Promise<AppConfig> {
  cached = buildAppConfig(resolveConfigRoot(), settingsOverrides);
  return cached;
}

export function reloadAppConfig(settingsOverrides: Record<string, unknown> = {}): AppConfig {
  cached = buildAppConfig(resolveConfigRoot(), settingsOverrides);
  return cached;
}

export function getAppConfig(): AppConfig {
  if (!cached) {
    cached = buildAppConfig();
  }
  return cached;
}

export function getDataPolicy(): DataPolicyConfig {
  return getAppConfig().dataPolicy;
}

export function getSchedules(): SchedulesConfig {
  return getAppConfig().schedules;
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

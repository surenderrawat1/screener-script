/**
 * App config bootstrap — YAML files + optional app_settings DB overrides.
 * Shared by API and worker so both honor config/alerts.yaml etc.
 */
import { cacheDeleteKey, cacheGetJson, cacheKey, cacheSetJson, getRedis } from '@sv/cache';
import { prisma } from '@sv/db';
import {
  buildAppConfig,
  CACHE_PREFIX,
  deepMerge,
  getAppConfig,
  initAppConfig,
  reloadAppConfig,
  resolveConfigRoot,
  type AppConfig,
} from '@sv/shared';

const ALLOWED_KEYS = new Set(['dataPolicy', 'schedules', 'alerts', 'strategyDailyProof', 'indices', 'etfs']);
const CONFIG_GEN_KEY = 'sv:config:generation';

export async function loadSettingsOverrides(): Promise<Record<string, unknown>> {
  const rows = await prisma.appSetting.findMany();
  const overrides: Record<string, unknown> = {};
  for (const row of rows) {
    if (ALLOWED_KEYS.has(row.key)) {
      overrides[row.key] = row.value;
    }
  }
  return overrides;
}

export async function bootstrapAppConfig(): Promise<AppConfig> {
  const overrides = await loadSettingsOverrides();
  return initAppConfig(overrides);
}

export async function reloadEffectiveAppConfig(): Promise<AppConfig> {
  const overrides = await loadSettingsOverrides();
  return reloadAppConfig(overrides);
}

export async function bumpConfigGeneration(): Promise<number> {
  try {
    const redis = getRedis();
    return await redis.incr(CONFIG_GEN_KEY);
  } catch {
    const key = cacheKey('sv:config', 'generation');
    const cur = (await cacheGetJson<number>(key)) ?? 0;
    const next = cur + 1;
    await cacheSetJson(key, next, 86400 * 30);
    return next;
  }
}

export async function readConfigGeneration(): Promise<number> {
  try {
    const redis = getRedis();
    const v = await redis.get(CONFIG_GEN_KEY);
    return Number(v ?? 0) || 0;
  } catch {
    const key = cacheKey('sv:config', 'generation');
    return (await cacheGetJson<number>(key)) ?? 0;
  }
}

/** Reload YAML + DB overrides and notify workers via Redis generation bump. */
export async function reloadConfigAndNotifyWorkers(): Promise<{
  ok: true;
  generation: number;
  configRoot: string;
  alerts: AppConfig['alerts'];
  strategyDailyProof: AppConfig['strategyDailyProof'];
  schedules_intraday: AppConfig['schedules']['intraday'];
}> {
  const cfg = await reloadEffectiveAppConfig();
  const generation = await bumpConfigGeneration();
  return {
    ok: true,
    generation,
    configRoot: cfg.configRoot,
    alerts: cfg.alerts,
    strategyDailyProof: cfg.strategyDailyProof,
    schedules_intraday: cfg.schedules.intraday,
  };
}

export async function getEffectiveSettings() {
  const overrides = await loadSettingsOverrides();
  const fileDefaults = buildAppConfig(resolveConfigRoot(), {});
  const effective = getAppConfig();

  return {
    configRoot: effective.configRoot,
    fileDefaults: {
      dataPolicy: fileDefaults.dataPolicy,
      schedules: fileDefaults.schedules,
      alerts: fileDefaults.alerts,
      strategyDailyProof: fileDefaults.strategyDailyProof,
      indices: fileDefaults.indices,
      etfs: fileDefaults.etfs,
    },
    overrides,
    effective: {
      dataPolicy: effective.dataPolicy,
      schedules: effective.schedules,
      alerts: effective.alerts,
      strategyDailyProof: effective.strategyDailyProof,
      indices: effective.indices,
      etfs: effective.etfs,
    },
  };
}

export async function patchAppSettings(
  patch: Record<string, unknown>,
  userId?: string,
): Promise<ReturnType<typeof getEffectiveSettings>> {
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unknown settings key: ${key}. Allowed: ${[...ALLOWED_KEYS].join(', ')}`);
    }
    if (value === null) {
      await prisma.appSetting.deleteMany({ where: { key } });
      continue;
    }
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    let merged: unknown;
    if (
      key === 'indices' &&
      value &&
      typeof value === 'object' &&
      'definitions' in (value as object)
    ) {
      // Full registry replace so Admin can delete index keys.
      const existingVal = (existing?.value ?? {}) as Record<string, unknown>;
      const next = value as Record<string, unknown>;
      merged = {
        version: next.version ?? existingVal.version ?? 1,
        definitions: next.definitions,
      };
    } else if (
      key === 'etfs' &&
      value &&
      typeof value === 'object' &&
      'entries' in (value as object)
    ) {
      const existingVal = (existing?.value ?? {}) as Record<string, unknown>;
      const next = value as Record<string, unknown>;
      merged = {
        version: next.version ?? existingVal.version ?? 1,
        entries: next.entries,
      };
    } else {
      merged = existing
        ? deepMerge(
            (existing.value ?? {}) as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : value;
    }
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: merged as object, updatedBy: userId },
      update: { value: merged as object, updatedBy: userId },
    });
  }

  await reloadEffectiveAppConfig();
  await bumpConfigGeneration();
  if ('etfs' in patch) {
    await cacheDeleteKey(cacheKey(CACHE_PREFIX.MORNING, 'etf')).catch(() => undefined);
  }
  return getEffectiveSettings();
}

/** Worker: reload when API bumps config generation. */
export async function tickConfigReload(localGeneration: { current: number }): Promise<boolean> {
  const gen = await readConfigGeneration();
  if (gen === localGeneration.current) return false;
  await reloadEffectiveAppConfig();
  localGeneration.current = gen;
  return true;
}

export { ALLOWED_KEYS };

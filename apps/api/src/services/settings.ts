import { prisma } from '@sv/db';
import {
  buildAppConfig,
  deepMerge,
  getAppConfig,
  initAppConfig,
  reloadAppConfig,
  resolveConfigRoot,
  type AppConfig,
} from '@sv/shared';

const ALLOWED_KEYS = new Set(['dataPolicy', 'schedules']);

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

export async function getEffectiveSettings() {
  const overrides = await loadSettingsOverrides();
  const fileDefaults = buildAppConfig(resolveConfigRoot(), {});
  const effective = getAppConfig();

  return {
    configRoot: effective.configRoot,
    fileDefaults: {
      dataPolicy: fileDefaults.dataPolicy,
      schedules: fileDefaults.schedules,
    },
    overrides,
    effective: {
      dataPolicy: effective.dataPolicy,
      schedules: effective.schedules,
    },
  };
}

export async function patchAppSettings(
  patch: Record<string, unknown>,
  userId?: string,
): Promise<ReturnType<typeof getEffectiveSettings>> {
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Unknown settings key: ${key}`);
    }
    if (value === null) {
      await prisma.appSetting.deleteMany({ where: { key } });
      continue;
    }
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    const merged = existing
      ? deepMerge(
          (existing.value ?? {}) as Record<string, unknown>,
          value as Record<string, unknown>,
        )
      : value;
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: merged as object, updatedBy: userId },
      update: { value: merged as object, updatedBy: userId },
    });
  }

  const overrides = await loadSettingsOverrides();
  reloadAppConfig(overrides);
  return getEffectiveSettings();
}

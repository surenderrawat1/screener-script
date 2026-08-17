import { PRESET_FILTERS, type ScreenerFilters } from '@sv/core';
import { getStrategy } from '@sv/swing';
import { prisma } from '@sv/db';

export const USER_SCREENER_PRESET_PREFIX = 'user_screener_preset:';

export function isUserScreenerPresetKey(preset?: string): boolean {
  return Boolean(preset?.startsWith(USER_SCREENER_PRESET_PREFIX));
}

export function userScreenerPresetIdFromKey(preset: string): string {
  return preset.slice(USER_SCREENER_PRESET_PREFIX.length);
}

function presetCacheKey(preset?: string): string {
  return preset?.trim() || 'custom';
}

/** Load system or DB-backed user preset filters for screener runs. */
export async function resolveScreenerPresetFilters(
  preset?: string,
  userId?: string,
): Promise<{ presetKey: string; baseFilters: ScreenerFilters }> {
  if (preset && isUserScreenerPresetKey(preset)) {
    const id = userScreenerPresetIdFromKey(preset);
    const row = await prisma.screenerPreset.findUnique({
      where: { id },
      select: { filters: true, userId: true, isSystem: true },
    });
    if (!row || row.isSystem) {
      return { presetKey: preset, baseFilters: {} };
    }
    if (userId && row.userId !== userId) {
      return { presetKey: preset, baseFilters: {} };
    }
    return {
      presetKey: preset,
      baseFilters: (row.filters ?? {}) as ScreenerFilters,
    };
  }

  return {
    presetKey: presetCacheKey(preset),
    baseFilters: preset ? (PRESET_FILTERS[preset] ?? {}) : {},
  };
}


function isTaPreset(preset: string): boolean {
  return preset.startsWith('ta_') || preset.includes('_ta_') || preset.includes('ta_');
}

export interface ScreenerPathOptions {
  universe?: string;
  maxScan?: number;
  autorun?: boolean;
  showTa?: boolean;
}

/** Build /screener?… path for strategy registry keys (Morning scoreboard, API). */
export function buildScreenerPathFromStrategyKey(
  strategyKey: string,
  overrides: ScreenerPathOptions = {},
): string | null {
  if (strategyKey.startsWith(USER_SCREENER_PRESET_PREFIX)) {
    const q = new URLSearchParams();
    q.set('preset', strategyKey);
    if (overrides.universe) q.set('universe', overrides.universe);
    if (overrides.maxScan != null && overrides.maxScan > 0) q.set('maxScan', String(overrides.maxScan));
    if (overrides.autorun) q.set('autorun', '1');
    return `/screener?${q.toString()}`;
  }

  const def = getStrategy(strategyKey);
  if (!def) return null;

  const preset =
    strategyKey.startsWith(USER_SCREENER_PRESET_PREFIX)
      ? strategyKey
      : def.engine === 'screener'
        ? def.preset
        : def.screener_preset;

  if (!preset) return null;

  const q = new URLSearchParams();
  q.set('preset', preset);
  const universe = overrides.universe ?? def.universe_default;
  if (universe) q.set('universe', universe);
  const maxScan =
    overrides.maxScan != null && overrides.maxScan > 0 ? overrides.maxScan : def.max_scan_default;
  if (maxScan != null && maxScan > 0) q.set('maxScan', String(maxScan));
  const showTa = overrides.showTa ?? isTaPreset(preset);
  if (showTa) q.set('show_ta', '1');
  if (overrides.autorun) q.set('autorun', '1');
  return `/screener?${q.toString()}`;
}

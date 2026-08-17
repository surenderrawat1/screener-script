import { PRESET_FILTERS, PRESET_LABELS } from '@sv/core';
import { prisma } from '@sv/db';
import { USER_SCREENER_PRESET_PREFIX } from '@sv/data-adapters';
import { getAppConfig } from '@sv/shared';

export interface ScreenerPresetInfo {
  id: string;
  label: string;
  filters: Record<string, unknown>;
  description?: string;
  ta_preset?: boolean;
}

export function listScreenerPresets(): ScreenerPresetInfo[] {
  const yaml = getAppConfig().screenerPresets?.presets ?? {};
  const ids = [...new Set([...Object.keys(PRESET_FILTERS), ...Object.keys(yaml)])];

  return ids
    .filter((id) => yaml[id]?.enabled !== false)
    .map((id) => {
      const entry = yaml[id];
      const core = PRESET_FILTERS[id] ?? {};
      const meta = PRESET_LABELS[id];
      const ta = Boolean((core as { ta_preset?: boolean }).ta_preset);
      return {
        id,
        label: entry?.label ?? meta?.label ?? id.replace(/_/g, ' '),
        filters: { ...core, ...(entry?.filters ?? {}) },
        description: meta?.description ?? undefined,
        ta_preset: ta || undefined,
      };
    });
}


export async function listUserScreenerPresets(userId: string): Promise<ScreenerPresetInfo[]> {
  const rows = await prisma.screenerPreset.findMany({
    where: { userId, isSystem: false },
    orderBy: { name: 'asc' },
    take: 50,
    select: { id: true, name: true, filters: true },
  });

  return rows.map((row) => ({
    id: `${USER_SCREENER_PRESET_PREFIX}${row.id}`,
    label: row.name,
    filters: (row.filters ?? {}) as Record<string, unknown>,
    description: 'Custom saved preset',
  }));
}

import { nseSession } from '@sv/shared';
import {
  allTradingPresets,
  enrichTradingPreset,
  getTradingPreset,
  PRESET_GUIDE_TIPS,
  tradingPresetChips,
} from '@sv/swing';

export function listTradingPresets() {
  return {
    session: nseSession(),
    guide_tips: [...PRESET_GUIDE_TIPS],
    presets: allTradingPresets().map(enrichTradingPreset),
    chips: tradingPresetChips(),
  };
}

export function getTradingPresetById(id: string) {
  const preset = getTradingPreset(id);
  if (!preset) return null;
  return { preset: enrichTradingPreset(preset) };
}

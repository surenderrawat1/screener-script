import { allTradingPresets, getTradingPreset, tradingPresetChips } from '@sv/swing';

export function listTradingPresets() {
  return {
    presets: allTradingPresets(),
    chips: tradingPresetChips(),
  };
}

export function getTradingPresetById(id: string) {
  const preset = getTradingPreset(id);
  if (!preset) return null;
  return { preset };
}

export interface ScreenerDeepLinkParams {
  preset?: string;
  universe?: string;
  maxScan?: number;
  showTa?: boolean;
  excludeRestricted?: boolean;
  background?: boolean;
  autorun?: boolean;
}

export interface StrategyDeepLinkSource {
  key: string;
  engine: string;
  preset?: string;
  screener_preset?: string;
  universe_default?: string;
  max_scan_default?: number;
}

const USER_PRESET_PREFIX = 'user_screener_preset:';

/** Map strategy registry / custom preset keys to screener `preset` query param. */
export function screenerPresetFromStrategy(strategy: StrategyDeepLinkSource): string | undefined {
  if (strategy.key.startsWith(USER_PRESET_PREFIX)) return strategy.key;
  if (strategy.engine === 'screener' && strategy.preset) return strategy.preset;
  if (strategy.screener_preset) return strategy.screener_preset;
  return undefined;
}

export function isTaScreenerPreset(preset: string): boolean {
  return preset.startsWith('ta_') || preset.includes('_ta_') || preset.includes('ta_');
}

export function canOpenStrategyInScreener(strategy: StrategyDeepLinkSource): boolean {
  return Boolean(screenerPresetFromStrategy(strategy));
}

export function screenerDeepLink(params: ScreenerDeepLinkParams = {}): string {
  const q = new URLSearchParams();
  if (params.preset) q.set('preset', params.preset);
  if (params.universe) q.set('universe', params.universe);
  if (params.maxScan != null && params.maxScan > 0) q.set('maxScan', String(params.maxScan));
  if (params.showTa) q.set('show_ta', '1');
  if (params.excludeRestricted === false) q.set('exclude_restricted', '0');
  if (params.background) q.set('background', '1');
  if (params.autorun) q.set('autorun', '1');
  const qs = q.toString();
  return qs ? `/screener?${qs}` : '/screener';
}

export function screenerDeepLinkFromStrategy(
  strategy: StrategyDeepLinkSource,
  overrides: ScreenerDeepLinkParams = {},
): string {
  const preset = overrides.preset ?? screenerPresetFromStrategy(strategy);
  const showTa =
    overrides.showTa ?? (preset != null && isTaScreenerPreset(preset) ? true : undefined);
  return screenerDeepLink({
    universe: overrides.universe ?? strategy.universe_default,
    maxScan:
      overrides.maxScan != null && overrides.maxScan > 0
        ? overrides.maxScan
        : strategy.max_scan_default,
    ...overrides,
    preset,
    showTa: showTa || undefined,
  });
}

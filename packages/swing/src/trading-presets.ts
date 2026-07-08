import { ETF_CATEGORY, etfSymbols, filterEtfCatalog } from './etf-universe.js';

export const PRESET_CONSERVATIVE_SWING = 'conservative_swing';
export const PRESET_ETF_ROTATION = 'etf_rotation';
export const PRESET_INTRADAY_SESSION = 'intraday_session';

export const SWING_TIER_A_UNIVERSE_ID = 'swing_tier_a';

export const TIER_A_SYMBOLS = [
  'TCS',
  'RELIANCE',
  'BHARTIARTL',
  'ITC',
  'LT',
  'MARUTI',
  'SUNPHARMA',
  'WIPRO',
  'NTPC',
  'POWERGRID',
  'ONGC',
  'TATASTEEL',
] as const;

export interface TradingPresetLink {
  href: string;
  label: string;
  primary?: boolean;
}

export interface TradingPresetScanParams {
  universe: string;
  min_verdict: 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL';
  gc9_only?: boolean;
  sort_by?: string;
  maxScan?: number;
}

export interface TradingPreset {
  id: string;
  label: string;
  icon: string;
  horizon: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  description: string;
  rules: string[];
  links: TradingPresetLink[];
  primary_href: string;
  scan_params?: TradingPresetScanParams;
}

export interface TradingPresetEnriched extends TradingPreset {
  ready: boolean;
  blocked_reason?: string;
}

/** Hub guide banner — parity with PHP trading-presets.php accuracy tips. */
export const PRESET_GUIDE_TIPS = [
  'Conservative swing: confirm NIFTYBEES regime before sizing Tier-A ENTER names.',
  'ETF rotation: prefer high-liquidity BeES; sector ETFs may diverge from Nifty regime.',
  'Intraday: backtest 60d preset matrix before live size; flatten by 14:45–15:15 IST.',
] as const;

const PRESET_ALIASES: Record<string, string> = {
  conservative: PRESET_CONSERVATIVE_SWING,
  swing: PRESET_CONSERVATIVE_SWING,
  swing_conservative: PRESET_CONSERVATIVE_SWING,
  etf: PRESET_ETF_ROTATION,
  rotation: PRESET_ETF_ROTATION,
  intraday: PRESET_INTRADAY_SESSION,
  scalp: PRESET_INTRADAY_SESSION,
};

export function tradingPresetIds(): string[] {
  return [PRESET_CONSERVATIVE_SWING, PRESET_ETF_ROTATION, PRESET_INTRADAY_SESSION];
}

export function normalizeTradingPresetId(id: string): string {
  const key = id.toLowerCase().trim();
  return PRESET_ALIASES[key] ?? key;
}

export function isValidTradingPresetId(id: string): boolean {
  return tradingPresetIds().includes(normalizeTradingPresetId(id));
}

export function conservativeSwingScanHref(autorun = false): string {
  const params = new URLSearchParams({ preset: PRESET_CONSERVATIVE_SWING });
  if (autorun) params.set('autorun', '1');
  return `/swing?${params.toString()}`;
}

export function etfRotationScanHref(autorun = false): string {
  const params = new URLSearchParams({ preset: PRESET_ETF_ROTATION });
  if (autorun) params.set('autorun', '1');
  return `/swing?${params.toString()}`;
}

export function intradayRadarHref(interval: '5m' | '15m' = '5m'): string {
  const params = new URLSearchParams({
    interval,
    preset: PRESET_INTRADAY_SESSION,
  });
  return `/intraday?${params.toString()}`;
}

function conservativeSwing(): TradingPreset {
  return {
    id: PRESET_CONSERVATIVE_SWING,
    label: 'Conservative swing',
    icon: '🛡',
    horizon: 'Days to weeks',
    tone: 'success',
    description: 'Tier-A book · strict ENTER only · fresh GC9 entry — size only when rules pass now.',
    rules: [
      `Universe: curated Tier-A swing book (${TIER_A_SYMBOLS.length} names).`,
      'Verdict: strict ENTER (E1–E8 + price action), not SETUP discovery.',
      'GC9 filter: only names with a live golden-cross entry trigger.',
      'Check NIFTYBEES regime on Swing Trading before adding size.',
    ],
    scan_params: {
      universe: SWING_TIER_A_UNIVERSE_ID,
      min_verdict: 'ENTER',
      gc9_only: true,
      sort_by: 'swing_rank',
      maxScan: TIER_A_SYMBOLS.length,
    },
    primary_href: conservativeSwingScanHref(true),
    links: [
      { href: conservativeSwingScanHref(true), label: 'Run Tier-A ENTER scan', primary: true },
      { href: '/swing/auto?tier=strict_enter', label: 'Swing Auto · strict ENTER' },
      { href: '/positions', label: 'Manage positions' },
      { href: '/stock/NIFTYBEES', label: 'Regime (NIFTYBEES)' },
    ],
  };
}

function etfRotation(): TradingPreset {
  const rotationCount = filterEtfCatalog(ETF_CATEGORY.ROTATION).length;

  return {
    id: PRESET_ETF_ROTATION,
    label: 'ETF rotation',
    icon: '↻',
    horizon: 'Weeks',
    tone: 'warning',
    description: 'Index + sector ETF book · SETUP+ discovery · align with NIFTYBEES regime before rotation.',
    rules: [
      `Book: ${rotationCount} liquid index & sector ETFs (excludes thematic, gold, global).`,
      'Verdict: SETUP+ — discovery ENTER or SETUP; confirm strict ENTER on symbol view.',
      'Regime banner uses NIFTYBEES — check underlying mismatch notes on sector names.',
      'Prefer high-liquidity BeES; avoid low-liquidity niche ETFs for size.',
    ],
    scan_params: {
      universe: 'swing_etf_rotation',
      min_verdict: 'SETUP_PLUS',
      sort_by: 'swing_rank',
      maxScan: rotationCount,
    },
    primary_href: etfRotationScanHref(true),
    links: [
      { href: etfRotationScanHref(true), label: 'Scan index + sector ETFs', primary: true },
      {
        href: '/swing?preset=etf_rotation&universe=swing_etf_index&autorun=1',
        label: 'Index ETFs only',
      },
      {
        href: '/swing?preset=etf_rotation&universe=swing_etf_sector&autorun=1',
        label: 'Sector ETFs only',
      },
      { href: '/positions', label: 'ETF positions' },
    ],
  };
}

function intradaySession(): TradingPreset {
  return {
    id: PRESET_INTRADAY_SESSION,
    label: 'Intraday session',
    icon: '⚡',
    horizon: 'Same day',
    tone: 'danger',
    description: '5m trend scalp entry + quick scalp exits · 15m CFA precision for index confirmation.',
    rules: [
      '5m: trend_scalp_5m gates (10:15 IST, trend day, skip chop) + 0.8/1.5/2.2R exits.',
      '15m: CFA precision preset — MTF, regime map, precision partials.',
      'Log entries on Nifty Positions; flatten by time stop (14:45–15:15 IST).',
      'Backtest 60d combo matrix before live size on your instrument.',
    ],
    primary_href: intradayRadarHref('5m'),
    links: [
      { href: intradayRadarHref('5m'), label: '5m trend scalp radar', primary: true },
      { href: intradayRadarHref('15m'), label: '15m CFA precision' },
      { href: '/intraday/positions', label: 'Intraday ledger' },
      { href: '/intraday/backtest', label: '60d backtest matrix' },
      { href: '/morning', label: 'Morning cockpit' },
    ],
  };
}

export function allTradingPresets(): TradingPreset[] {
  return [conservativeSwing(), etfRotation(), intradaySession()];
}

export function getTradingPreset(id: string): TradingPreset | null {
  const normalized = normalizeTradingPresetId(id);
  return allTradingPresets().find((p) => p.id === normalized) ?? null;
}

export function tradingPresetReadiness(preset: TradingPreset): { ready: boolean; blocked_reason?: string } {
  if (preset.id === PRESET_CONSERVATIVE_SWING) {
    if ((TIER_A_SYMBOLS as readonly string[]).length === 0) {
      return { ready: false, blocked_reason: 'Tier-A swing book has no symbols configured' };
    }
    return { ready: true };
  }
  if (preset.id === PRESET_ETF_ROTATION) {
    const count = filterEtfCatalog(ETF_CATEGORY.ROTATION).length;
    if (count === 0) {
      return { ready: false, blocked_reason: 'ETF rotation catalog is empty' };
    }
    return { ready: true };
  }
  if (preset.id === PRESET_INTRADAY_SESSION) {
    return { ready: true };
  }
  return { ready: false, blocked_reason: 'Unknown preset' };
}

export function enrichTradingPreset(preset: TradingPreset): TradingPresetEnriched {
  const gate = tradingPresetReadiness(preset);
  return { ...preset, ready: gate.ready, blocked_reason: gate.blocked_reason };
}

/** Intraday entry-filter id to highlight when launched from intraday_session preset. */
export function intradaySessionFilterId(interval: '5m' | '15m'): string {
  return interval === '5m' ? 'trend_scalp_5m' : 'cfa_precision';
}

export function tradingPresetChips() {
  return allTradingPresets().map((preset) => ({
    id: preset.id,
    icon: preset.icon,
    label: preset.label,
    tone: preset.tone,
    description: preset.description,
    href: preset.primary_href,
  }));
}

export function resolvePresetUniverseSymbols(universeKey: string): string[] | null {
  if (universeKey === SWING_TIER_A_UNIVERSE_ID) {
    return [...TIER_A_SYMBOLS];
  }
  if (universeKey === 'swing_etf_rotation') {
    return etfSymbols(ETF_CATEGORY.ROTATION);
  }
  if (universeKey === 'swing_etf_index') {
    return etfSymbols(ETF_CATEGORY.INDEX);
  }
  if (universeKey === 'swing_etf_sector') {
    return etfSymbols(ETF_CATEGORY.SECTOR);
  }
  return null;
}

import { SWING_TIER_A_UNIVERSE_ID } from './trading-presets.js';
import { SCREENER_PRESETS } from '@sv/shared';

const IMPLEMENTED_SCREENER_PRESETS = new Set<string>(SCREENER_PRESETS);

export const STRATEGY_STYLE_SWING = 'swing' as const;
export const STRATEGY_STYLE_POSITIONAL = 'positional' as const;
export const STRATEGY_STYLE_HYBRID = 'hybrid' as const;

export const STRATEGY_ENGINE_SWING = 'swing' as const;
export const STRATEGY_ENGINE_SCREENER = 'screener' as const;
export const STRATEGY_ENGINE_HYBRID = 'hybrid' as const;

export type StrategyStyle =
  | typeof STRATEGY_STYLE_SWING
  | typeof STRATEGY_STYLE_POSITIONAL
  | typeof STRATEGY_STYLE_HYBRID;

export type StrategyEngine =
  | typeof STRATEGY_ENGINE_SWING
  | typeof STRATEGY_ENGINE_SCREENER
  | typeof STRATEGY_ENGINE_HYBRID;

export interface StrategyDefinition {
  key: string;
  label: string;
  description: string;
  style: StrategyStyle;
  engine: StrategyEngine;
  horizon: string;
  universe_default: string;
  max_scan_default: number;
  icon: string;
  ready: boolean;
  blocked_reason?: string;
  preset?: string;
  screener_preset?: string;
  screener_max?: number;
  min_verdict?: 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL';
  sort_by?: string;
  zone_52w?: string;
  breakout_volume?: boolean;
}

type StrategySeed = Omit<StrategyDefinition, 'key' | 'ready' | 'blocked_reason'>;

const IMPLEMENTED_PRESETS = IMPLEMENTED_SCREENER_PRESETS;

function presetReady(preset?: string): { ready: boolean; blocked_reason?: string } {
  if (!preset) return { ready: false, blocked_reason: 'No screener preset configured' };
  if (IMPLEMENTED_PRESETS.has(preset)) return { ready: true };
  return { ready: false, blocked_reason: `Preset "${preset}" not ported yet (TS-D)` };
}

function withReadiness(key: string, seed: StrategySeed): StrategyDefinition {
  if (seed.engine === STRATEGY_ENGINE_SWING) {
    return { key, ...seed, ready: true };
  }
  if (seed.engine === STRATEGY_ENGINE_SCREENER) {
    const gate = presetReady(seed.preset);
    return { key, ...seed, ...gate };
  }
  const gate = presetReady(seed.screener_preset);
  return { key, ...seed, ...gate };
}

const STRATEGY_SEEDS: Record<string, StrategySeed> = {
  swing_setup_plus: {
    label: 'Swing — SETUP+ Discovery',
    description: 'Pullback setups in uptrend · discovery ENTER or SETUP · default research list',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: SWING_TIER_A_UNIVERSE_ID,
    max_scan_default: 0,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'rules_passed',
    icon: '↗',
  },
  swing_strict_enter: {
    label: 'Swing — Strict ENTER',
    description: 'Full E1–E8 + price action · same rules as backtest / live orders',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: SWING_TIER_A_UNIVERSE_ID,
    max_scan_default: 0,
    min_verdict: 'ENTER',
    sort_by: 'r_multiple',
    icon: '★',
  },
  swing_watch_early: {
    label: 'Swing — Early WATCH',
    description: 'Trend OK but setup still forming · monitor before entry',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: 'nifty250',
    max_scan_default: 300,
    min_verdict: 'WATCH',
    sort_by: 'pct_52w',
    icon: '◎',
  },
  swing_green_zone: {
    label: 'Swing — Green Zone (52w Low)',
    description: 'SETUP+ where 52w low date is after 52w high date — pullback / dip-buy list',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: SWING_TIER_A_UNIVERSE_ID,
    max_scan_default: 0,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'pct_52w',
    zone_52w: 'green',
    icon: '↓',
  },
  swing_breakout_volume: {
    label: 'Swing — Breakout + Volume',
    description: 'Swing-high breakout with ≥1.08× volume surge · SETUP+ momentum list',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: SWING_TIER_A_UNIVERSE_ID,
    max_scan_default: 0,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'volume_ratio',
    breakout_volume: true,
    icon: '⚡',
  },
  swing_best_r: {
    label: 'Swing — Best R-Multiple',
    description: 'SETUP+ sorted by CFA swing rank (ENTER + R + liquidity)',
    style: STRATEGY_STYLE_SWING,
    engine: STRATEGY_ENGINE_SWING,
    horizon: '2–6 weeks',
    universe_default: SWING_TIER_A_UNIVERSE_ID,
    max_scan_default: 0,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'swing_rank',
    icon: 'R',
  },
  pos_quality: {
    label: 'Positional — Quality Compounders',
    description: 'ROCE/ROE quality floor · core long-hold basket',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–12+ months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'quality',
    sort_by: 'score',
    icon: 'Q',
  },
  pos_moat_compounders: {
    label: 'Positional — Wide Moat Compounders',
    description: 'Strong moat tier + quality fundamentals · Buffett-style hold',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '1–3 years',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'moat_compounders',
    sort_by: 'moat',
    icon: '🏰',
  },
  pos_monopoly_stocks: {
    label: 'Positional — Monopoly & Oligopoly',
    description: 'Dominant franchises · wide moat · ROCE ≥ 20%',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–10+ years',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'monopoly_stocks',
    sort_by: 'monopoly',
    icon: '♔',
  },
  pos_green_zone: {
    label: 'Positional — 52w Green Zone',
    description: 'Pullback phase · 52w low after high · quality floor + dip-buy watch',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–12 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'ta_green_zone',
    sort_by: 'ta_pct_52w',
    icon: '↓',
  },
  pos_red_zone: {
    label: 'Positional — 52w Red Zone',
    description: 'Rally phase · momentum leaders with quality floor',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–9 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'ta_red_zone',
    sort_by: 'ta_pct_52w',
    icon: '↑',
  },
  pos_buy_zone: {
    label: 'Positional — Buy Zone (MOS ≥ 10%)',
    description: 'Quality names with margin of safety in accumulate zone',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '6–18 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'buy_zone',
    sort_by: 'mos',
    icon: '₹',
  },
  pos_deep_value: {
    label: 'Positional — Deep Value',
    description: 'MOS ≥ 25% · contrarian value with quality floor',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '6–24 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'deep_value',
    sort_by: 'mos',
    icon: '⬇',
  },
  pos_growth: {
    label: 'Positional — GARP Growth',
    description: 'Growth at reasonable price · ROE floor',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '6–18 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'growth',
    sort_by: 'score',
    icon: '📈',
  },
  pos_defensive: {
    label: 'Positional — Defensive Dividend',
    description: 'Yield + stable ROCE · income + capital preservation',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '1–3 years',
    universe_default: 'nifty500',
    max_scan_default: 100,
    preset: 'defensive',
    sort_by: 'div_yield',
    icon: '🛡',
  },
  pos_moat_bottom: {
    label: 'Positional — Moat @ Bottom (TA)',
    description: 'Wide moat + bottom-out TA · stagger entry on weakness',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–12 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'cfa_moat_bottom',
    sort_by: 'mos',
    icon: '⌄',
  },
  pos_moat_uptrend: {
    label: 'Positional — Moat Uptrend',
    description: 'Quality moat + SMA/MACD uptrend · add on strength',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–12 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'cfa_moat_uptrend',
    sort_by: 'score',
    icon: '⌃',
  },
  pos_best_opportunity: {
    label: 'Positional — Best Opportunity',
    description: 'Combined CFA + TA · moat, MOS, and timing alignment',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '3–12 months',
    universe_default: 'nifty500',
    max_scan_default: 500,
    preset: 'cfa_best_opportunity',
    sort_by: 'recommendation',
    icon: '✦',
  },
  pos_pullback_timing: {
    label: 'Positional — Pullback Entry (TA)',
    description: 'Above SMA-50, RSI pullback band · time entries in uptrend',
    style: STRATEGY_STYLE_POSITIONAL,
    engine: STRATEGY_ENGINE_SCREENER,
    horizon: '1–6 months',
    universe_default: 'nifty250',
    max_scan_default: 250,
    preset: 'ta_pullback',
    sort_by: 'ta_rsi',
    icon: '↘',
  },
  hybrid_quality_swing: {
    label: 'Hybrid — Quality → Swing SETUP+',
    description: 'Quality screener first, then swing rules on passers',
    style: STRATEGY_STYLE_HYBRID,
    engine: STRATEGY_ENGINE_HYBRID,
    horizon: '2–12 weeks',
    universe_default: 'nifty500',
    max_scan_default: 200,
    screener_preset: 'quality',
    screener_max: 200,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'swing_rank',
    icon: '⚡',
  },
  hybrid_moat_swing: {
    label: 'Hybrid — Moat @ Value → Swing',
    description: 'Moat + MOS screen, then swing SETUP+ on survivors',
    style: STRATEGY_STYLE_HYBRID,
    engine: STRATEGY_ENGINE_HYBRID,
    horizon: '2–12 weeks',
    universe_default: 'nifty500',
    max_scan_default: 150,
    screener_preset: 'moat_at_value',
    screener_max: 150,
    min_verdict: 'SETUP_PLUS',
    sort_by: 'swing_rank',
    icon: '⚡',
  },
};

export const STRATEGY_STYLE_LABELS: Record<string, string> = {
  all: 'All strategies',
  [STRATEGY_STYLE_SWING]: 'Swing trading',
  [STRATEGY_STYLE_POSITIONAL]: 'Positional investing',
  [STRATEGY_STYLE_HYBRID]: 'Hybrid (CFA + swing)',
};

export function strategyKeys(): string[] {
  return Object.keys(STRATEGY_SEEDS);
}

export function isValidStrategy(key: string): boolean {
  return key in STRATEGY_SEEDS;
}

export function getStrategy(key: string): StrategyDefinition | null {
  const seed = STRATEGY_SEEDS[key];
  if (!seed) return null;
  return withReadiness(key, seed);
}

export function listStrategies(style?: string | null): StrategyDefinition[] {
  return strategyKeys()
    .map((key) => getStrategy(key)!)
    .filter((s) => {
      if (!style || style === 'all') return true;
      return s.style === style;
    });
}

export function readyStrategyCount(): number {
  return listStrategies().filter((s) => s.ready).length;
}

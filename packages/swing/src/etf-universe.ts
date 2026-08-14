export {
  ETF_UNIVERSE_ID,
  ETF_CATEGORY,
  ETF_LIQUIDITY,
  DEFAULT_ETF_CATALOG,
  getEtfCatalog,
  etfMetaFor,
  radarEtfCatalog,
  type EtfCatalogEntry,
} from '@sv/shared';

import {
  ETF_CATEGORY,
  ETF_LIQUIDITY,
  getEtfCatalog,
  type EtfCatalogEntry,
} from '@sv/shared';

/** Built-in defaults (not the live catalog). Prefer getEtfCatalog(). */
export { DEFAULT_ETF_CATALOG as ETF_CATALOG } from '@sv/shared';

const ROTATION_CATEGORIES = new Set<string>([ETF_CATEGORY.INDEX, ETF_CATEGORY.SECTOR]);

export function etfSymbols(category?: string): string[] {
  return filterEtfCatalog(category).map((row) => row.symbol);
}

export function filterEtfCatalog(category?: string): EtfCatalogEntry[] {
  const catalog = getEtfCatalog();
  if (!category || category === ETF_CATEGORY.ROTATION) {
    if (category === ETF_CATEGORY.ROTATION) {
      return catalog.filter((row) => ROTATION_CATEGORIES.has(row.category));
    }
    return catalog;
  }
  return catalog.filter((row) => row.category === category);
}

export function etfCategoryLabel(category: string): string {
  if (category === ETF_CATEGORY.ROTATION) return 'Index + sector rotation';
  const labels: Record<string, string> = {
    [ETF_CATEGORY.INDEX]: 'Index',
    [ETF_CATEGORY.SECTOR]: 'Sector',
    [ETF_CATEGORY.THEMATIC]: 'Thematic',
    [ETF_CATEGORY.COMMODITY]: 'Commodity',
    [ETF_CATEGORY.GLOBAL]: 'Global',
  };
  return labels[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

export function formatTerPct(terPct: number): string {
  return `${String(terPct).replace(/\.?0+$/, '')}%`;
}

export function etfLiquidityLabel(liquidity: string): string {
  if (liquidity === ETF_LIQUIDITY.HIGH) return 'High';
  if (liquidity === ETF_LIQUIDITY.LOW) return 'Low';
  return 'Medium';
}

export function isLowLiquidityEtf(meta: EtfCatalogEntry | null): boolean {
  return meta?.liquidity === ETF_LIQUIDITY.LOW;
}

export function etfRegimeContextNote(meta: EtfCatalogEntry | null): string | null {
  if (!meta) return null;
  const underlying = meta.underlying.trim();
  if (!underlying || underlying.toLowerCase() === 'nifty 50') return null;
  if (meta.category === ETF_CATEGORY.COMMODITY || meta.category === ETF_CATEGORY.GLOBAL) {
    return `Regime is Nifty 50 (NIFTYBEES) — ${underlying} moves on different drivers.`;
  }
  return `Regime proxy is Nifty 50 — confirm ${underlying} trend separately.`;
}

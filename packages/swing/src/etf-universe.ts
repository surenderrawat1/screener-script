export const ETF_UNIVERSE_ID = 'swing_etf';

export const ETF_CATEGORY = {
  INDEX: 'index',
  SECTOR: 'sector',
  THEMATIC: 'thematic',
  COMMODITY: 'commodity',
  GLOBAL: 'global',
  ROTATION: 'rotation',
} as const;

export const ETF_LIQUIDITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export interface EtfCatalogEntry {
  symbol: string;
  name: string;
  category: string;
  underlying: string;
  ter_pct: number;
  liquidity: string;
  note?: string;
}

export const ETF_CATALOG: EtfCatalogEntry[] = [
  { symbol: 'NIFTYBEES', name: 'Nifty 50 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, note: 'Regime proxy · core index' },
  { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.HIGH },
  { symbol: 'HDFCNIFETF', name: 'HDFC Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'ICICINIFTY', name: 'ICICI Pru Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'BANKBEES', name: 'Bank Nifty BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Bank', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, note: 'Bank index proxy' },
  { symbol: 'SETFNIFBK', name: 'SBI Bank Nifty ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Bank', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'JUNIORBEES', name: 'Nifty Next 50 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Next 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH },
  { symbol: 'NV20BEES', name: 'Nifty NV20 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50 Value 20', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW },
  { symbol: 'ITBEES', name: 'Nifty IT BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty IT', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH },
  { symbol: 'PHARMABEES', name: 'Nifty Pharma BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Pharma', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'AUTOBEES', name: 'Nifty Auto BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Auto', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'PSUBNKBEES', name: 'PSU Bank BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty PSU Bank', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'INFRABEES', name: 'Infra BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Infra', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'CPSEETF', name: 'CPSE ETF', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty CPSE', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.LOW },
  { symbol: 'MOM100', name: 'Nifty 100 Momentum', category: ETF_CATEGORY.THEMATIC, underlying: 'Nifty 100 Momentum 30', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'HDFCMOMENT', name: 'Nifty 200 Momentum 30', category: ETF_CATEGORY.THEMATIC, underlying: 'Nifty 200 Momentum 30', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW },
  { symbol: 'GOLDBEES', name: 'Gold BeES', category: ETF_CATEGORY.COMMODITY, underlying: 'Domestic gold (995)', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, note: 'Gold proxy · different vol profile' },
  { symbol: 'SILVERBEES', name: 'Silver BeES', category: ETF_CATEGORY.COMMODITY, underlying: 'Domestic silver', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW },
  { symbol: 'MON100', name: 'Nasdaq 100 (MO)', category: ETF_CATEGORY.GLOBAL, underlying: 'Nasdaq 100', ter_pct: 0.1, liquidity: ETF_LIQUIDITY.MEDIUM },
  { symbol: 'MASPTOP50', name: 'S&P 500 Top 50 (MO)', category: ETF_CATEGORY.GLOBAL, underlying: 'S&P 500 Top 50', ter_pct: 0.1, liquidity: ETF_LIQUIDITY.LOW },
];

const ROTATION_CATEGORIES = new Set<string>([ETF_CATEGORY.INDEX, ETF_CATEGORY.SECTOR]);

export function etfSymbols(category?: string): string[] {
  const rows = filterEtfCatalog(category);
  return rows.map((row) => row.symbol);
}

export function filterEtfCatalog(category?: string): EtfCatalogEntry[] {
  if (!category || category === ETF_CATEGORY.ROTATION) {
    if (category === ETF_CATEGORY.ROTATION) {
      return ETF_CATALOG.filter((row) => ROTATION_CATEGORIES.has(row.category));
    }
    return ETF_CATALOG;
  }
  return ETF_CATALOG.filter((row) => row.category === category);
}

export function etfMetaFor(symbol: string): EtfCatalogEntry | null {
  const sym = symbol.toUpperCase().trim();
  return ETF_CATALOG.find((row) => row.symbol === sym) ?? null;
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

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
  radar: boolean;
  note?: string;
}

export interface EtfsFileConfig {
  version: number;
  entries: EtfCatalogEntry[];
}

const CATEGORIES = new Set<string>([
  ETF_CATEGORY.INDEX,
  ETF_CATEGORY.SECTOR,
  ETF_CATEGORY.THEMATIC,
  ETF_CATEGORY.COMMODITY,
  ETF_CATEGORY.GLOBAL,
]);

const LIQUIDITIES = new Set<string>([ETF_LIQUIDITY.HIGH, ETF_LIQUIDITY.MEDIUM, ETF_LIQUIDITY.LOW]);

/** Built-in defaults — used when config is not loaded yet. */
export const DEFAULT_ETF_CATALOG: EtfCatalogEntry[] = [
  { symbol: 'NIFTYBEES', name: 'Nifty 50 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, radar: true, note: 'Regime proxy · core index' },
  { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.HIGH, radar: true },
  { symbol: 'HDFCNIFETF', name: 'HDFC Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'ICICINIFTY', name: 'ICICI Pru Nifty 50 ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'BANKBEES', name: 'Bank Nifty BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Bank', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, radar: true, note: 'Bank index proxy' },
  { symbol: 'SETFNIFBK', name: 'SBI Bank Nifty ETF', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Bank', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'JUNIORBEES', name: 'Nifty Next 50 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty Next 50', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, radar: true },
  { symbol: 'NV20BEES', name: 'Nifty NV20 BeES', category: ETF_CATEGORY.INDEX, underlying: 'Nifty 50 Value 20', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW, radar: false },
  { symbol: 'ITBEES', name: 'Nifty IT BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty IT', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, radar: true },
  { symbol: 'PHARMABEES', name: 'Nifty Pharma BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Pharma', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'AUTOBEES', name: 'Nifty Auto BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Auto', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'PSUBNKBEES', name: 'PSU Bank BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty PSU Bank', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'INFRABEES', name: 'Infra BeES', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty Infra', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'CPSEETF', name: 'CPSE ETF', category: ETF_CATEGORY.SECTOR, underlying: 'Nifty CPSE', ter_pct: 0.07, liquidity: ETF_LIQUIDITY.LOW, radar: false },
  { symbol: 'MOM100', name: 'Nifty 100 Momentum', category: ETF_CATEGORY.THEMATIC, underlying: 'Nifty 100 Momentum 30', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'HDFCMOMENT', name: 'Nifty 200 Momentum 30', category: ETF_CATEGORY.THEMATIC, underlying: 'Nifty 200 Momentum 30', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW, radar: false },
  { symbol: 'GOLDBEES', name: 'Gold BeES', category: ETF_CATEGORY.COMMODITY, underlying: 'Domestic gold (995)', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.HIGH, radar: true, note: 'Gold proxy · different vol profile' },
  { symbol: 'SILVERBEES', name: 'Silver BeES', category: ETF_CATEGORY.COMMODITY, underlying: 'Domestic silver', ter_pct: 0.05, liquidity: ETF_LIQUIDITY.LOW, radar: false },
  { symbol: 'MON100', name: 'Nasdaq 100 (MO)', category: ETF_CATEGORY.GLOBAL, underlying: 'Nasdaq 100', ter_pct: 0.1, liquidity: ETF_LIQUIDITY.MEDIUM, radar: false },
  { symbol: 'MASPTOP50', name: 'S&P 500 Top 50 (MO)', category: ETF_CATEGORY.GLOBAL, underlying: 'S&P 500 Top 50', ter_pct: 0.1, liquidity: ETF_LIQUIDITY.LOW, radar: false },
];

export const DEFAULT_ETFS_FILE: EtfsFileConfig = { version: 1, entries: DEFAULT_ETF_CATALOG };

type EtfCatalogGetter = () => EtfCatalogEntry[];
let etfCatalogGetter: EtfCatalogGetter | null = null;

/** Wired by config.ts after AppConfig load. */
export function bindEtfCatalogGetter(getter: EtfCatalogGetter): void {
  etfCatalogGetter = getter;
}

export function getEtfCatalog(): EtfCatalogEntry[] {
  const rows = etfCatalogGetter?.();
  if (rows && rows.length > 0) return rows;
  return DEFAULT_ETF_CATALOG;
}

export function etfMetaFor(symbol: string): EtfCatalogEntry | null {
  const sym = symbol.toUpperCase().trim().replace(/\.(NS|BO)$/i, '');
  return getEtfCatalog().find((row) => row.symbol === sym) ?? null;
}

export function radarEtfCatalog(): EtfCatalogEntry[] {
  return getEtfCatalog().filter((row) => row.radar);
}

export function normalizeEtfCatalog(raw: unknown): EtfCatalogEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: unknown[] }).entries
      : [];
  const out: EtfCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase()
      .replace(/\.(NS|BO)$/i, '');
    if (!/^[A-Z0-9]{2,24}$/.test(symbol) || seen.has(symbol)) continue;
    const category = String(row.category ?? ETF_CATEGORY.INDEX).toLowerCase().trim();
    const liquidity = String(row.liquidity ?? ETF_LIQUIDITY.MEDIUM).toLowerCase().trim();
    if (!CATEGORIES.has(category) || !LIQUIDITIES.has(liquidity)) continue;
    const name = String(row.name ?? symbol).trim() || symbol;
    const underlying = String(row.underlying ?? '').trim();
    const ter = Number(row.ter_pct ?? 0);
    const radarExplicit = row.radar;
    const radar =
      typeof radarExplicit === 'boolean' ? radarExplicit : liquidity === ETF_LIQUIDITY.HIGH;
    const note = String(row.note ?? '').trim();
    seen.add(symbol);
    out.push({
      symbol,
      name,
      category,
      underlying,
      ter_pct: Number.isFinite(ter) && ter >= 0 ? ter : 0,
      liquidity,
      radar,
      ...(note ? { note } : {}),
    });
  }
  return out;
}

function parseCsvRows(content: string): string[][] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur.trim());
    return row;
  });
}

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function col(header: string[], ...aliases: string[]): number {
  for (const alias of aliases) {
    const i = header.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

function parseBool(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'no', 'n'].includes(v)) return false;
  return undefined;
}

/**
 * NSE-style or admin ETF CSV.
 * Headers (any subset): symbol/ticker, name, category, underlying, ter_pct, liquidity, radar, note.
 * Symbol-only lists (like EQUITY_L.csv) are valid — other fields default.
 */
export function parseEtfCsv(csv: string): EtfCatalogEntry[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];
  const header = rows[0].map(normHeader);
  const hasHeader = header.some((h) =>
    ['symbol', 'ticker', 'name', 'underlying', 'category', 'liquidity', 'ter', 'ter_pct', 'radar'].includes(h),
  );
  const start = hasHeader ? 1 : 0;
  const h = hasHeader ? header : [];
  const symIdx = hasHeader ? col(h, 'symbol', 'ticker', 'nse_symbol') : 0;
  if (symIdx < 0) return [];
  const nameIdx = hasHeader ? col(h, 'name', 'etf_name', 'security_name', 'name_of_the_etf', 'name_of_company') : -1;
  const catIdx = hasHeader ? col(h, 'category') : -1;
  const undIdx = hasHeader ? col(h, 'underlying', 'underlying_asset', 'underlying_index') : -1;
  const terIdx = hasHeader ? col(h, 'ter_pct', 'ter', 'expense_ratio') : -1;
  const liqIdx = hasHeader ? col(h, 'liquidity') : -1;
  const radarIdx = hasHeader ? col(h, 'radar') : -1;
  const noteIdx = hasHeader ? col(h, 'note', 'notes', 'comment') : -1;

  const raw: Record<string, unknown>[] = [];
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    const symbol = cells[symIdx] ?? '';
    if (!symbol) continue;
    const radar = radarIdx >= 0 ? parseBool(cells[radarIdx] ?? '') : undefined;
    raw.push({
      symbol,
      name: nameIdx >= 0 ? cells[nameIdx] : '',
      category: catIdx >= 0 ? cells[catIdx] : ETF_CATEGORY.INDEX,
      underlying: undIdx >= 0 ? cells[undIdx] : '',
      ter_pct: terIdx >= 0 ? cells[terIdx] : 0,
      liquidity: liqIdx >= 0 ? cells[liqIdx] : ETF_LIQUIDITY.MEDIUM,
      ...(radar !== undefined ? { radar } : {}),
      note: noteIdx >= 0 ? cells[noteIdx] : '',
    });
  }
  return normalizeEtfCatalog(raw);
}

/** Merge uploaded rows into the live catalog (CSV wins on set fields; keeps richer existing names). */
export function mergeEtfCatalog(base: EtfCatalogEntry[], incoming: EtfCatalogEntry[]): EtfCatalogEntry[] {
  const map = new Map(base.map((row) => [row.symbol, row]));
  for (const row of incoming) {
    const prev = map.get(row.symbol);
    if (!prev) {
      map.set(row.symbol, row);
      continue;
    }
    map.set(row.symbol, {
      ...prev,
      ...row,
      name: row.name && row.name !== row.symbol ? row.name : prev.name,
      underlying: row.underlying || prev.underlying,
      note: row.note || prev.note,
    });
  }
  return [...map.values()];
}

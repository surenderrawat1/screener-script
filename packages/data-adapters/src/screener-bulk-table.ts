import { createHash } from 'node:crypto';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { httpGet } from './http.js';
import { recordScreenerPageFetch, screenerHtmlRowCount } from './screener-health.js';
import type { ScreenerRatios } from './screener-in.js';

/** PHP ScreenerInParser::ALL_LISTED_URL — paginated NSE/BSE table (ROCE > 15 screen). */
export const SCREENER_ALL_LISTED_URL =
  'https://www.screener.in/screens/357649/all-stocks-with-roce-gt-15/';

export interface ScreenerBulkRow {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  market_cap_cr: number;
  div_yield: number;
  profit_yoy: number;
  sales_yoy: number;
  roce: number;
  source: 'screener.in';
}

function bulkPageUrl(baseUrl: string, page: number, limit: number): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}page=${page}&limit=${limit}`;
}

function bulkPageCacheKey(url: string): string {
  const hash = createHash('md5').update(url).digest('hex');
  return cacheKey(CACHE_PREFIX.SCREENER_TABLE, `page:${hash}`);
}

function parseNum(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** PHP ScreenerInParser::parseTable parity. */
export function parseScreenerBulkTable(html: string): ScreenerBulkRow[] {
  const rows: ScreenerBulkRow[] = [];
  const re =
    /<tr data-row-company-id="\d+">\s*<td[^>]*>[\d.]+<\/td>\s*<td[^>]*>\s*<a href="\/company\/([^/]+)\/[^"]*"[^>]*>([^<]+)<\/a>\s*<\/td>\s*((?:<td[^>]*>[^<]*<\/td>\s*)+)/gs;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const cellRe = /<td[^>]*>([^<]*)<\/td>/g;
    const vals: string[] = [];
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(match[3])) !== null) {
      vals.push(cell[1].trim());
    }
    if (vals.length < 8) continue;

    rows.push({
      symbol: match[1].toUpperCase(),
      name: match[2].trim(),
      price: parseNum(vals[0]),
      pe: parseNum(vals[1]),
      market_cap_cr: parseNum(vals[2]),
      div_yield: parseNum(vals[3]),
      profit_yoy: parseNum(vals[5]),
      sales_yoy: parseNum(vals[7]),
      roce: parseNum(vals[8] ?? '0'),
      source: 'screener.in',
    });
  }
  return rows;
}

export async function fetchBulkTablePage(
  page: number,
  options: { limit?: number; refresh?: boolean; baseUrl?: string } = {},
): Promise<ScreenerBulkRow[]> {
  const limit = options.limit ?? 50;
  const baseUrl = options.baseUrl ?? SCREENER_ALL_LISTED_URL;
  const url = bulkPageUrl(baseUrl, page, limit);
  const key = bulkPageCacheKey(url);

  if (!options.refresh) {
    const cached = await cacheGetJson<ScreenerBulkRow[]>(key);
    if (cached?.length) return cached;
  }

  const html = await httpGet(url);
  const htmlOk = Boolean(html && html.length > 200);
  const parsed = htmlOk && html ? parseScreenerBulkTable(html) : [];
  void recordScreenerPageFetch(htmlOk, htmlOk && html ? Math.max(parsed.length, screenerHtmlRowCount(html)) : 0).catch(
    () => {},
  );

  if (!htmlOk || parsed.length === 0) return [];

  await cacheSetJson(key, parsed, getCacheTtl().screener_table);
  return parsed;
}

export async function fetchBulkTablePages(
  fromPage: number,
  toPage: number,
  options: { limit?: number; refresh?: boolean } = {},
): Promise<ScreenerBulkRow[]> {
  const pages = Math.max(fromPage, 1);
  const end = Math.max(toPage, pages);
  const chunks = await Promise.all(
    Array.from({ length: end - pages + 1 }, (_, i) => fetchBulkTablePage(pages + i, options)),
  );
  return chunks.flat();
}

function dedupeBulkRows(rows: ScreenerBulkRow[]): ScreenerBulkRow[] {
  const seen = new Set<string>();
  const out: ScreenerBulkRow[] = [];
  for (const row of rows) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    out.push(row);
  }
  return out;
}

/** PHP buildBulkLookupForSymbols — scan bulk pages for requested symbols. */
export async function buildBulkLookupForSymbols(
  symbols: string[],
  maxPages = 5,
  refresh = false,
): Promise<Map<string, ScreenerBulkRow>> {
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  if (want.size === 0) return new Map();

  const pages = Math.min(maxPages, Math.max(1, Math.ceil(want.size / 40)));
  const rows = dedupeBulkRows(await fetchBulkTablePages(1, pages, { refresh }));
  const map = new Map<string, ScreenerBulkRow>();
  for (const row of rows) {
    if (want.has(row.symbol)) map.set(row.symbol, row);
  }
  return map;
}

/** PHP loadBulkUniverse — symbol list for total_nse when no CSV upload exists. */
export async function fetchBulkUniverseSymbols(maxScan: number, pages = 4, refresh = false): Promise<string[]> {
  const rows = dedupeBulkRows(await fetchBulkTablePages(1, Math.max(1, pages), { refresh }));
  const cap = maxScan > 0 ? maxScan : rows.length;
  return rows.slice(0, cap).map((r) => r.symbol);
}

export function bulkRowToRatios(row: ScreenerBulkRow): ScreenerRatios {
  return {
    roce: row.roce,
    roe: 0,
    pe: row.pe,
    book_value: 0,
    sales_yoy: row.sales_yoy,
    profit_yoy: row.profit_yoy,
    debt_to_equity: 0,
    market_cap_cr: row.market_cap_cr,
    div_yield: row.div_yield,
  };
}

/** Fill gaps on an incomplete company-ratio row using bulk table data. */
export function mergeRatiosWithBulk(base: ScreenerRatios, bulk: ScreenerBulkRow): ScreenerRatios {
  return {
    roce: base.roce > 0 ? base.roce : bulk.roce,
    roe: base.roe,
    pe: base.pe > 0 ? base.pe : bulk.pe,
    book_value: base.book_value,
    sales_yoy: base.sales_yoy !== 0 ? base.sales_yoy : bulk.sales_yoy,
    profit_yoy: base.profit_yoy !== 0 ? base.profit_yoy : bulk.profit_yoy,
    debt_to_equity: base.debt_to_equity,
    market_cap_cr: base.market_cap_cr > 0 ? base.market_cap_cr : bulk.market_cap_cr,
    div_yield: base.div_yield && base.div_yield > 0 ? base.div_yield : bulk.div_yield,
  };
}

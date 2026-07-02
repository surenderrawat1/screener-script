import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { httpGet, normalizeDebtToEquity } from './http.js';

export interface ScreenerRatios {
  roce: number;
  roe: number;
  pe: number;
  sales_yoy: number;
  profit_yoy: number;
  debt_to_equity: number;
  market_cap_cr: number;
}

function parseRatios(html: string): Record<string, string> {
  const ratios: Record<string, string> = {};
  const re = /<span class="name">\s*([^<]+?)\s*<\/span>.*?<span class="number">([^<]+)<\/span>/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim().replace(/\s+/g, ' ');
    ratios[key] = m[2].trim().replace(/,/g, '');
  }
  return ratios;
}

function num(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function ratiosToMetrics(ratios: Record<string, string>): ScreenerRatios {
  let de = num(ratios['Debt to equity']);
  if (de > 5) de = de / 100;

  return {
    roce: num(ratios.ROCE),
    roe: num(ratios.ROE),
    pe: num(ratios['Stock P/E']),
    sales_yoy: num(ratios['Sales growth']),
    profit_yoy: num(ratios['Profit growth']),
    debt_to_equity: normalizeDebtToEquity(de),
    market_cap_cr: num(ratios['Market Cap']),
  };
}

export async function fetchScreenerRatios(symbol: string, refresh = false): Promise<ScreenerRatios | null> {
  const slug = symbol.toLowerCase().replace(/\.(ns|bo)$/, '');
  const cacheKeyStr = cacheKey(CACHE_PREFIX.SCREENER_TABLE, slug);
  if (!refresh) {
    const cached = await cacheGetJson<ScreenerRatios>(cacheKeyStr);
    if (cached) return cached;
  }

  const url = `https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`;
  const html = await httpGet(url);
  if (!html) return null;

  const metrics = ratiosToMetrics(parseRatios(html));
  if (metrics.roce <= 0 && metrics.roe <= 0) return null;

  await cacheSetJson(cacheKeyStr, metrics, CACHE_TTL.screener_table);
  return metrics;
}

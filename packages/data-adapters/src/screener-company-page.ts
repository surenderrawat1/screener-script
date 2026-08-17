import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { httpGet } from './http.js';
import { recordScreenerPageFetch, screenerHtmlRowCount } from './screener-health.js';

export function screenerCompanySlug(symbol: string): string {
  return symbol.toLowerCase().replace(/\.(ns|bo)$/, '');
}

export function screenerCompanyUrl(symbol: string): string {
  const slug = screenerCompanySlug(symbol);
  return `https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`;
}

/** Single cached HTML fetch shared by ratios, annual, shareholding parsers (S-B). */
export async function fetchScreenerCompanyHtml(symbol: string, refresh = false): Promise<string | null> {
  const slug = screenerCompanySlug(symbol);
  const cacheKeyStr = cacheKey(CACHE_PREFIX.SCREENER_TABLE, `page:${slug}`);
  if (!refresh) {
    const cached = await cacheGetJson<{ html: string }>(cacheKeyStr);
    if (cached?.html) return cached.html;
  }

  const html = await httpGet(screenerCompanyUrl(symbol));
  const htmlOk = Boolean(html && html.length > 200);
  void recordScreenerPageFetch(htmlOk, htmlOk && html ? screenerHtmlRowCount(html) : 0).catch(() => {});
  if (!html) return null;

  await cacheSetJson(cacheKeyStr, { html }, getCacheTtl().screener_table);
  return html;
}

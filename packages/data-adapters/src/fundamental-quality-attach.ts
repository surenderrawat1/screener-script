import { applyFundamentalQuality } from '@sv/swing';
import { fetchStockData } from './stock-data-fetcher.js';

const QUALITY_FETCH_CONCURRENCY = 8;

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length || 1);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** Attach cached ROE/ROCE (+ sector) and apply ≥15% quality gate to swing hits. */
export async function attachFundamentalQualityToHits(
  hits: Record<string, unknown>[],
  refresh = false,
): Promise<Record<string, unknown>[]> {
  if (
    !refresh &&
    hits.length > 0 &&
    hits.every(
      (h) =>
        h.fundamental_quality_status != null ||
        h.fundamental_quality_ok != null ||
        (Number(h.roe ?? 0) > 0 && Number(h.roce ?? 0) > 0),
    )
  ) {
    return hits.map((hit) =>
      applyFundamentalQuality(hit, {
        roe: Number(hit.roe ?? 0),
        roce: Number(hit.roce ?? 0),
        sector: hit.sector != null ? String(hit.sector) : '',
        industry: hit.industry != null ? String(hit.industry) : '',
        symbol: String(hit.symbol ?? ''),
      }),
    );
  }

  return mapConcurrent(hits, QUALITY_FETCH_CONCURRENCY, async (hit) => {
    const sym = String(hit.symbol ?? '')
      .toUpperCase()
      .replace(/\.(NS|BO)$/, '');
    if (!sym) return applyFundamentalQuality(hit);

    let roe = Number(hit.roe ?? 0);
    let roce = Number(hit.roce ?? 0);
    let sector = hit.sector != null ? String(hit.sector) : '';
    let industry = hit.industry != null ? String(hit.industry) : '';
    if (roe <= 0 || roce <= 0 || !sector || refresh) {
      const fetched = await fetchStockData(sym, { refresh }).catch(() => null);
      const m = fetched?.metrics;
      if (m) {
        if (roe <= 0 || refresh) roe = Number(m.roe ?? roe);
        if (roce <= 0 || refresh) roce = Number(m.roce ?? roce);
        if (!sector || refresh) sector = String(m.sector ?? sector);
        if (!industry || refresh) industry = String(m.industry ?? industry);
      }
    }
    return applyFundamentalQuality(hit, { roe, roce, sector, industry, symbol: sym });
  });
}

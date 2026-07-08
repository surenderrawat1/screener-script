import { api } from '../../api';

/** Fetch latest Yahoo price for a symbol (live quote when session open). */
export async function fetchSymbolPrice(symbol: string): Promise<number | null> {
  const sym = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!sym) return null;
  try {
    const res = await api<{ metrics?: { price?: number } }>(
      `/api/v1/stock/${encodeURIComponent(sym)}?refresh=true`,
    );
    const price = Number(res.metrics?.price);
    return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
  } catch {
    return null;
  }
}

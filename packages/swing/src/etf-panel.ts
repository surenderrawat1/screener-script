import {
  etfCategoryLabel,
  etfLiquidityLabel,
  etfMetaFor,
  etfRegimeContextNote,
  isLowLiquidityEtf,
} from './etf-universe.js';
import { agoLabel, MORNING_TOP_HITS } from './morning-routine.js';

export interface EtfPanelHit {
  symbol: string;
  name: string;
  category: string;
  underlying: string;
  ter_pct: number;
  liquidity: string;
  low_liquidity: boolean;
  regime_note: string | null;
  verdict: string;
  strict_verdict: string;
  price: number | null;
  swing_rank: number;
  stale: boolean;
  as_of_date: string;
}

export interface EtfPanel {
  ok: boolean;
  error: string;
  hits: EtfPanelHit[];
  hit_count: number;
  elapsed_sec: number | null;
  stale_count: number;
  from_cache: boolean;
  cached_at: string | null;
  cached_ago: string | null;
  placeholder?: boolean;
}

export function emptyEtfPanel(error = ''): EtfPanel {
  return {
    ok: false,
    error,
    hits: [],
    hit_count: 0,
    elapsed_sec: null,
    stale_count: 0,
    from_cache: false,
    cached_at: null,
    cached_ago: null,
  };
}

export function formatEtfPanel(
  scan: Record<string, unknown>,
  cachedAt: string,
  fromCache: boolean,
  topHits = MORNING_TOP_HITS,
): EtfPanel {
  const rawHits = Array.isArray(scan.hits) ? (scan.hits as Record<string, unknown>[]) : [];
  const top = rawHits.slice(0, topHits);
  const hits: EtfPanelHit[] = [];

  for (const hit of top) {
    const sym = String(hit.symbol ?? '');
    const meta = etfMetaFor(sym);
    hits.push({
      symbol: sym,
      name: meta?.name ?? sym,
      category: etfCategoryLabel(String(meta?.category ?? '')),
      underlying: String(meta?.underlying ?? ''),
      ter_pct: Number(meta?.ter_pct ?? 0),
      liquidity: etfLiquidityLabel(String(meta?.liquidity ?? '')),
      low_liquidity: isLowLiquidityEtf(meta),
      regime_note: etfRegimeContextNote(meta),
      verdict: String(hit.verdict ?? ''),
      strict_verdict: String(hit.strict_verdict ?? ''),
      price: typeof hit.price === 'number' ? hit.price : null,
      swing_rank: Number(hit.swing_rank ?? 0),
      stale: Boolean(hit.stale),
      as_of_date: String(hit.as_of_date ?? ''),
    });
  }

  const savedTs = cachedAt ? Date.parse(cachedAt) : NaN;
  const cachedAgo = Number.isFinite(savedTs)
    ? agoLabel(Math.max(0, Math.floor((Date.now() - savedTs) / 1000)))
    : null;

  return {
    ok: !scan.error,
    error: String(scan.error ?? ''),
    hits,
    hit_count: rawHits.length,
    elapsed_sec: typeof scan.elapsed_sec === 'number' ? scan.elapsed_sec : null,
    stale_count: Number(scan.stale ?? 0),
    from_cache: fromCache,
    cached_at: cachedAt || null,
    cached_ago: cachedAgo,
  };
}

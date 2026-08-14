import { etfMetaFor, radarEtfCatalog } from '@sv/swing';

export interface IntradayInstrumentMeta {
  id: string;
  label: string;
  cache_key: string;
  yahoo_symbols: string[];
  kind: 'index' | 'stock';
  recommended_preset: string;
}

const INDICES: Record<string, IntradayInstrumentMeta> = {
  nifty50: {
    id: 'nifty50',
    label: 'Nifty 50',
    cache_key: 'NIFTY50',
    yahoo_symbols: ['^NSEI', 'NIFTYBEES.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'index',
  },
  banknifty: {
    id: 'banknifty',
    label: 'Bank Nifty',
    cache_key: 'BANKNIFTY',
    yahoo_symbols: ['^NSEBANK', 'BANKBEES.NS'],
    recommended_preset: 'banknifty_tuned',
    kind: 'index',
  },
  sensex: {
    id: 'sensex',
    label: 'Sensex',
    cache_key: 'SENSEX',
    yahoo_symbols: ['^BSESN', 'SENSEXETF.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'index',
  },
  finnifty: {
    id: 'finnifty',
    label: 'Fin Nifty',
    cache_key: 'FINNIFTY',
    yahoo_symbols: ['NIFTY_FIN_SERVICE.NS', 'FINIETF.NS'],
    recommended_preset: 'banknifty_tuned',
    kind: 'index',
  },
};

/** Liquid NSE names for intraday quick picks (PHP IntradayInstrument::LIQUID_STOCKS parity). */
const LIQUID_STOCKS: Record<string, IntradayInstrumentMeta> = {
  tcs: { id: 'tcs', label: 'TCS', cache_key: 'TCS', yahoo_symbols: ['TCS.NS'], recommended_preset: 'cfa_precision', kind: 'stock' },
  reliance: {
    id: 'reliance',
    label: 'Reliance',
    cache_key: 'RELIANCE',
    yahoo_symbols: ['RELIANCE.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  hdfcbank: {
    id: 'hdfcbank',
    label: 'HDFC Bank',
    cache_key: 'HDFCBANK',
    yahoo_symbols: ['HDFCBANK.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  infy: { id: 'infy', label: 'Infosys', cache_key: 'INFY', yahoo_symbols: ['INFY.NS'], recommended_preset: 'cfa_precision', kind: 'stock' },
  icicibank: {
    id: 'icicibank',
    label: 'ICICI Bank',
    cache_key: 'ICICIBANK',
    yahoo_symbols: ['ICICIBANK.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  sbin: { id: 'sbin', label: 'SBI', cache_key: 'SBIN', yahoo_symbols: ['SBIN.NS'], recommended_preset: 'cfa_precision', kind: 'stock' },
  bhartiartl: {
    id: 'bhartiartl',
    label: 'Bharti Airtel',
    cache_key: 'BHARTIARTL',
    yahoo_symbols: ['BHARTIARTL.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  itc: { id: 'itc', label: 'ITC', cache_key: 'ITC', yahoo_symbols: ['ITC.NS'], recommended_preset: 'cfa_precision', kind: 'stock' },
  lt: { id: 'lt', label: 'L&T', cache_key: 'LT', yahoo_symbols: ['LT.NS'], recommended_preset: 'cfa_precision', kind: 'stock' },
  axisbank: {
    id: 'axisbank',
    label: 'Axis Bank',
    cache_key: 'AXISBANK',
    yahoo_symbols: ['AXISBANK.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  kotakbank: {
    id: 'kotakbank',
    label: 'Kotak Bank',
    cache_key: 'KOTAKBANK',
    yahoo_symbols: ['KOTAKBANK.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
  maruti: {
    id: 'maruti',
    label: 'Maruti',
    cache_key: 'MARUTI',
    yahoo_symbols: ['MARUTI.NS'],
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  },
};

const ALL = { ...INDICES, ...LIQUID_STOCKS };

const YAHOO_SUFFIX = /\.(NS|BO)$/i;
const QUERY_TOKEN = /^(\^[A-Z0-9._-]{1,24}|[A-Z0-9][A-Z0-9._-]{0,23})$/i;

export function parseInstrumentQuery(raw: string): {
  query: string;
  base: string;
  explicitYahoo: string | null;
  isCaret: boolean;
} | null {
  const query = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!query) return null;
  const isCaret = query.startsWith('^');
  const explicitYahoo = YAHOO_SUFFIX.test(query) ? query : null;
  const base = query.replace(YAHOO_SUFFIX, '').replace(/^\^/, '');
  if (!base || !QUERY_TOKEN.test(isCaret ? query : base)) return null;
  return { query, base, explicitYahoo, isCaret };
}

export function yahooSymbolsForQuery(raw: string): string[] {
  const parsed = parseInstrumentQuery(raw);
  if (!parsed) return [];
  if (parsed.isCaret) return [parsed.query];
  if (parsed.explicitYahoo) return [parsed.explicitYahoo];
  return [`${parsed.base}.NS`, `${parsed.base}.BO`];
}

function catalogLookup(raw: string): IntradayInstrumentMeta | null {
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  if (ALL[lower]) return ALL[lower];
  const parsed = parseInstrumentQuery(raw);
  if (!parsed) return null;
  const byId = ALL[parsed.base.toLowerCase()];
  if (byId) return byId;
  const compact = parsed.base;
  for (const meta of Object.values(ALL)) {
    if (meta.cache_key === compact) return meta;
    if (meta.label.toUpperCase().replace(/\s+/g, '') === compact) return meta;
    if (parsed.isCaret && meta.yahoo_symbols.some((s) => s.toUpperCase() === parsed.query)) {
      return meta;
    }
  }
  return null;
}

function synthesizeSpotInstrument(parsed: NonNullable<ReturnType<typeof parseInstrumentQuery>>): IntradayInstrumentMeta {
  const etf = etfMetaFor(parsed.base);
  return {
    id: parsed.base.toLowerCase(),
    label: etf?.name ?? parsed.base,
    cache_key: parsed.base,
    yahoo_symbols: yahooSymbolsForQuery(parsed.query),
    recommended_preset: 'cfa_precision',
    kind: 'stock',
  };
}

/** Known radar tabs only — does not synthesize free-text tickers. */
export function isCatalogInstrument(id: string): boolean {
  return Boolean(ALL[id.toLowerCase().trim()]);
}

/**
 * Resolve any index id, liquid stock, ETF, or NSE/BSE ticker.
 * Unknown valid tickers are synthesized (spot-only). Invalid tokens return null.
 */
export function resolveInstrument(idOrSymbol: string): IntradayInstrumentMeta | null {
  const known = catalogLookup(idOrSymbol);
  const parsed = parseInstrumentQuery(idOrSymbol);
  if (known) {
    if (parsed?.explicitYahoo) {
      return { ...known, yahoo_symbols: [parsed.explicitYahoo] };
    }
    return known;
  }
  if (!parsed) return null;
  if (parsed.isCaret) {
    return {
      id: parsed.base.toLowerCase(),
      label: parsed.query,
      cache_key: parsed.base,
      yahoo_symbols: [parsed.query],
      recommended_preset: 'cfa_precision',
      kind: 'index',
    };
  }
  return synthesizeSpotInstrument(parsed);
}

export function resolveInstrumentFromSymbol(symbol: string, instrumentId?: string): IntradayInstrumentMeta | null {
  if (symbol?.trim()) {
    const fromSymbol = resolveInstrument(symbol);
    if (fromSymbol) return fromSymbol;
  }
  if (instrumentId?.trim()) return resolveInstrument(instrumentId);
  return null;
}

/** Empty → nifty50. Known/synthesized → canonical id. Never remaps a valid ticker to Nifty. */
export function normalizeInstrumentId(id: string): string {
  const key = id.trim();
  if (!key) return 'nifty50';
  return resolveInstrument(key)?.id ?? key.toLowerCase().replace(/\.(ns|bo)$/i, '');
}

export function instrumentIds(): string[] {
  return Object.keys(ALL);
}

export function indexInstrumentIds(): string[] {
  return Object.keys(INDICES);
}

export function stockInstrumentIds(): string[] {
  return Object.keys(LIQUID_STOCKS);
}

/** Stratzy paper proof book — aligns with 60d BT (Nifty + Bank Nifty, 15m). */
export function stratzyPaperInstrumentIds(): string[] {
  return ['nifty50', 'banknifty'];
}

export function listIntradayInstruments(): IntradayInstrumentMeta[] {
  return [...Object.values(INDICES), ...Object.values(LIQUID_STOCKS)];
}

/** High-liquidity ETFs as optional quick picks (still resolvable via free-text). */
export function listEtfQuickPicks(): IntradayInstrumentMeta[] {
  return radarEtfCatalog().map((row) => {
    const meta = resolveInstrument(row.symbol);
    return meta ?? synthesizeSpotInstrument({
      query: row.symbol,
      base: row.symbol,
      explicitYahoo: null,
      isCaret: false,
    });
  });
}

/**
 * v2 recommended preset (authoritative). PHP is a source of *additive* gates only —
 * never replace a v2 default with a looser/older PHP preset.
 */
export function recommendedPresetForInstrument(id: string, interval: '5m' | '15m' = '15m'): string {
  if (interval === '5m') return 'trend_scalp_5m';
  const meta = resolveInstrument(id);
  return meta?.recommended_preset ?? 'cfa_precision';
}

/** Stricter single-name floors adopted from PHP (raises the bar; does not loosen index presets). */
export function entryFilterOverrides(instrument?: { kind?: string } | null): Record<string, unknown> {
  if (!instrument || instrument.kind === 'index') return {};
  return {
    min_mtf_deploy: 60,
    require_actionable_trigger: true,
    min_setup_grade: 'B',
    skip_chop: true,
    max_trades_per_session: 1,
  };
}

/**
 * Live radar pick: keep the instrument default when it passes the active TF,
 * otherwise first passing preset from a conservative fallback ladder.
 */
export function pickLiveRecommendedPreset(
  instrumentId: string,
  interval: '5m' | '15m',
  presetEval: Array<Record<string, unknown>>,
): string {
  const preferred = recommendedPresetForInstrument(instrumentId, interval);
  const passKey = interval === '5m' ? 'pass_5m' : 'pass_15m';
  const passing = (id: string) => Boolean(presetEval.find((p) => p.id === id)?.[passKey]);
  if (passing(preferred)) return preferred;
  if (interval === '5m') return preferred;
  const ladder = [preferred, 'quality', 'strict_mtf', 'banknifty_tuned', 'production', 'cfa_precision', 'baseline'];
  const seen = new Set<string>();
  for (const id of ladder) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (passing(id)) return id;
  }
  return preferred;
}

export function instrumentKind(id: string): 'index' | 'stock' {
  return resolveInstrument(id)?.kind ?? 'stock';
}

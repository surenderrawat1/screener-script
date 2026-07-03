export interface IntradayInstrumentMeta {
  id: string;
  label: string;
  cache_key: string;
  yahoo_symbols: string[];
  kind: 'index' | 'stock';
}

const INDICES: Record<string, IntradayInstrumentMeta> = {
  nifty50: {
    id: 'nifty50',
    label: 'Nifty 50',
    cache_key: 'NIFTY50',
    yahoo_symbols: ['^NSEI', 'NIFTYBEES.NS'],
    kind: 'index',
  },
  banknifty: {
    id: 'banknifty',
    label: 'Bank Nifty',
    cache_key: 'BANKNIFTY',
    yahoo_symbols: ['^NSEBANK', 'BANKBEES.NS'],
    kind: 'index',
  },
};

/** Liquid NSE names for intraday quick picks (PHP IntradayInstrument::LIQUID_STOCKS parity). */
const LIQUID_STOCKS: Record<string, IntradayInstrumentMeta> = {
  tcs: { id: 'tcs', label: 'TCS', cache_key: 'TCS', yahoo_symbols: ['TCS.NS'], kind: 'stock' },
  reliance: {
    id: 'reliance',
    label: 'Reliance',
    cache_key: 'RELIANCE',
    yahoo_symbols: ['RELIANCE.NS'],
    kind: 'stock',
  },
  hdfcbank: {
    id: 'hdfcbank',
    label: 'HDFC Bank',
    cache_key: 'HDFCBANK',
    yahoo_symbols: ['HDFCBANK.NS'],
    kind: 'stock',
  },
  infy: { id: 'infy', label: 'Infosys', cache_key: 'INFY', yahoo_symbols: ['INFY.NS'], kind: 'stock' },
  icicibank: {
    id: 'icicibank',
    label: 'ICICI Bank',
    cache_key: 'ICICIBANK',
    yahoo_symbols: ['ICICIBANK.NS'],
    kind: 'stock',
  },
  sbin: { id: 'sbin', label: 'SBI', cache_key: 'SBIN', yahoo_symbols: ['SBIN.NS'], kind: 'stock' },
  bhartiartl: {
    id: 'bhartiartl',
    label: 'Bharti Airtel',
    cache_key: 'BHARTIARTL',
    yahoo_symbols: ['BHARTIARTL.NS'],
    kind: 'stock',
  },
  itc: { id: 'itc', label: 'ITC', cache_key: 'ITC', yahoo_symbols: ['ITC.NS'], kind: 'stock' },
  lt: { id: 'lt', label: 'L&T', cache_key: 'LT', yahoo_symbols: ['LT.NS'], kind: 'stock' },
  axisbank: {
    id: 'axisbank',
    label: 'Axis Bank',
    cache_key: 'AXISBANK',
    yahoo_symbols: ['AXISBANK.NS'],
    kind: 'stock',
  },
  kotakbank: {
    id: 'kotakbank',
    label: 'Kotak Bank',
    cache_key: 'KOTAKBANK',
    yahoo_symbols: ['KOTAKBANK.NS'],
    kind: 'stock',
  },
  maruti: {
    id: 'maruti',
    label: 'Maruti',
    cache_key: 'MARUTI',
    yahoo_symbols: ['MARUTI.NS'],
    kind: 'stock',
  },
};

const ALL = { ...INDICES, ...LIQUID_STOCKS };

export function normalizeInstrumentId(id: string): string {
  const key = id.toLowerCase().trim();
  return ALL[key] ? key : 'nifty50';
}

export function resolveInstrument(idOrSymbol: string): IntradayInstrumentMeta | null {
  const raw = idOrSymbol.toLowerCase().trim();
  if (ALL[raw]) return ALL[raw];

  const sym = idOrSymbol.toUpperCase().replace(/\.NS$/, '');
  for (const meta of Object.values(ALL)) {
    if (meta.cache_key === sym || meta.label.toUpperCase() === sym) {
      return meta;
    }
  }
  return null;
}

export function resolveInstrumentFromSymbol(symbol: string, instrumentId?: string): IntradayInstrumentMeta | null {
  if (instrumentId) {
    const byId = resolveInstrument(instrumentId);
    if (byId) return byId;
  }
  return resolveInstrument(symbol);
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

export function listIntradayInstruments(): IntradayInstrumentMeta[] {
  return [...Object.values(INDICES), ...Object.values(LIQUID_STOCKS)];
}

/** Recommended entry-filter preset id (matches PHP IntradayInstrument). */
export function recommendedPresetForInstrument(id: string, interval: '5m' | '15m' = '15m'): string {
  const meta = resolveInstrument(id);
  const key = meta?.id ?? normalizeInstrumentId(id);
  if (interval === '5m') return 'trend_scalp_5m';
  if (key === 'banknifty') return 'banknifty_tuned';
  return 'cfa_precision';
}

export function instrumentKind(id: string): 'index' | 'stock' {
  return resolveInstrument(id)?.kind ?? 'index';
}

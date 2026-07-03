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

const LIQUID_STOCKS: Record<string, IntradayInstrumentMeta> = {
  tcs: {
    id: 'tcs',
    label: 'TCS',
    cache_key: 'TCS',
    yahoo_symbols: ['TCS.NS'],
    kind: 'stock',
  },
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
  infy: {
    id: 'infy',
    label: 'Infosys',
    cache_key: 'INFY',
    yahoo_symbols: ['INFY.NS'],
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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfigRoot } from '@sv/shared';

export type ExchangeRestriction = 'asm' | 'gsm' | 't2t';

export interface ExchangeListData {
  as_of: string;
  asm: string[];
  gsm: string[];
  t2t: string[];
}

export interface ExchangeListSummary {
  as_of: string;
  asm: number;
  gsm: number;
  t2t: number;
  total: number;
}

const LABELS: Record<ExchangeRestriction, string> = {
  asm: 'ASM',
  gsm: 'GSM',
  t2t: 'T2T',
};

let cachedData: ExchangeListData | null = null;
let cachedLookup: Map<string, ExchangeRestriction> | null = null;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().split('.')[0] ?? '';
}

function dataPath(): string {
  return join(resolveConfigRoot(), 'data/exchange/asm_gsm_manual.json');
}

function loadData(): ExchangeListData {
  if (cachedData) return cachedData;

  const path = dataPath();
  if (!existsSync(path)) {
    cachedData = { as_of: '', asm: [], gsm: [], t2t: [] };
    return cachedData;
  }

  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const normalize = (list: unknown): string[] => {
      if (!Array.isArray(list)) return [];
      return [...new Set(list.map((s) => normalizeSymbol(String(s))).filter(Boolean))];
    };
    cachedData = {
      as_of: String(json.as_of ?? ''),
      asm: normalize(json.asm),
      gsm: normalize(json.gsm),
      t2t: normalize(json.t2t),
    };
  } catch {
    cachedData = { as_of: '', asm: [], gsm: [], t2t: [] };
  }

  return cachedData;
}

function buildLookup(): Map<string, ExchangeRestriction> {
  if (cachedLookup) return cachedLookup;

  const data = loadData();
  const lookup = new Map<string, ExchangeRestriction>();
  for (const key of ['asm', 'gsm', 't2t'] as const) {
    for (const sym of data[key]) {
      if (!lookup.has(sym)) lookup.set(sym, key);
    }
  }
  cachedLookup = lookup;
  return lookup;
}

/** Reset in-memory cache (tests). */
export function resetExchangeListCache(): void {
  cachedData = null;
  cachedLookup = null;
}

export function isExchangeRestricted(symbol: string): ExchangeRestriction | null {
  const sym = normalizeSymbol(symbol);
  if (!sym) return null;
  return buildLookup().get(sym) ?? null;
}

export function exchangeRestrictionLabel(key: ExchangeRestriction | string): string {
  return LABELS[key as ExchangeRestriction] ?? String(key).toUpperCase();
}

export function exchangeListSummary(): ExchangeListSummary {
  const data = loadData();
  return {
    as_of: data.as_of,
    asm: data.asm.length,
    gsm: data.gsm.length,
    t2t: data.t2t.length,
    total: data.asm.length + data.gsm.length + data.t2t.length,
  };
}

export function filterUnrestrictedSymbols(symbols: string[]): {
  symbols: string[];
  restricted_skipped: number;
  exchange_list_as_of: string;
} {
  const summary = exchangeListSummary();
  if (summary.total === 0) {
    return { symbols, restricted_skipped: 0, exchange_list_as_of: summary.as_of };
  }

  const out: string[] = [];
  let restricted_skipped = 0;
  for (const sym of symbols) {
    if (isExchangeRestricted(sym)) restricted_skipped++;
    else out.push(sym);
  }
  return { symbols: out, restricted_skipped, exchange_list_as_of: summary.as_of };
}

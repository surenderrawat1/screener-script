import { allVerifyFieldKeys, defaultValueForField, VERIFY_FULL_PHASES } from './phases.js';
import { VERIFY_SECTOR_OPTIONS } from './sectors.js';
import type { VerifyFieldDef, VerifyFullInput, VerifyFullPrefill } from './types.js';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function reviewDateDefault(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function fieldMap(): Map<string, VerifyFieldDef> {
  const map = new Map<string, VerifyFieldDef>();
  for (const phase of VERIFY_FULL_PHASES) {
    for (const field of phase.fields) {
      map.set(field.key, field);
    }
  }
  return map;
}

const FIELD_BY_KEY = fieldMap();

export function buildEmptyVerifyInput(symbol = ''): VerifyFullInput {
  const input: VerifyFullInput = {};
  for (const key of allVerifyFieldKeys()) {
    const field = FIELD_BY_KEY.get(key);
    input[key] = field ? defaultValueForField(field) : '';
  }
  if (symbol) {
    input.stock_name = symbol.toUpperCase();
    input.fetch_symbol = symbol.toUpperCase();
  }
  input.analysis_date = todayIso();
  input.review_date = reviewDateDefault();
  input.sector = 'general';
  return input;
}

export function buildVerifyFullPrefill(symbol = ''): VerifyFullPrefill {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  return {
    symbol: normalized,
    input: buildEmptyVerifyInput(normalized),
    auto_keys: [],
    phases: VERIFY_FULL_PHASES,
    sectors: VERIFY_SECTOR_OPTIONS,
  };
}

export function normalizeVerifySymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
}

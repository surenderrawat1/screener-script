import { normalizeSectorKey } from '../cfa-valuation-engine.js';
import type { DerivedMetrics, VerifyInput } from './types.js';

export function sectorHintKey(
  input: VerifyInput,
  sectorHints: Record<string, string> = {},
): string | null {
  const sym = String(input.fetch_symbol ?? input.stock_name ?? '')
    .trim()
    .split('.')[0]
    ?.toUpperCase() ?? '';

  if (sym === '') return null;

  const raw = sectorHints[sym];
  if (raw === undefined || raw === null || raw === '') return null;

  return normalizeSectorKey(String(raw));
}

export function resolveEffectiveSectorKey(
  input: VerifyInput,
  sectorHints: Record<string, string> = {},
): string {
  const formKey = normalizeSectorKey(String(input.sector ?? 'general'));
  const hintKey = sectorHintKey(input, sectorHints);

  if (formKey !== 'general') return formKey;
  if (hintKey !== null && hintKey !== 'general') return hintKey;

  return formKey;
}

export function resolvePhase6SectorRouting(
  input: VerifyInput,
  metrics: DerivedMetrics,
  sectorHints: Record<string, string> = {},
): { key: string; note: string; form_key: string; hint_key: string } {
  const formKey = normalizeSectorKey(String(input.sector ?? 'general'));
  const hintKey = sectorHintKey(input, sectorHints) ?? '';
  const key = String(metrics.sector_key ?? resolveEffectiveSectorKey(input, sectorHints));
  let note = '';

  if (formKey === 'general' && hintKey !== '' && hintKey !== 'general' && key === hintKey) {
    note = `Form sector general — routed via NSE hint to ${hintKey}`;
  } else if (hintKey !== '' && formKey !== 'general' && hintKey !== formKey) {
    note = `Form sector=${formKey} but NSE hint=${hintKey} — using form selection`;
  }

  return { key, note, form_key: formKey, hint_key: hintKey };
}

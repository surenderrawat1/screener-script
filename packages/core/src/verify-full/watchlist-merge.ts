import type { VerifyFullInput } from './types.js';

const THESIS_KEYS = [
  'review_date',
  'thesis_business',
  'thesis_financials',
  'thesis_valuation',
  'invalidation_1',
  'invalidation_2',
] as const;

export function mergeSavedFields(
  input: VerifyFullInput,
  entry: Record<string, unknown> | null | undefined,
): VerifyFullInput {
  if (!entry) return input;
  const out = { ...input };
  for (const key of THESIS_KEYS) {
    const saved = String(entry[key] ?? '').trim();
    const current = String(out[key] ?? '').trim();
    if (saved && !current) out[key] = saved;
  }
  return out;
}

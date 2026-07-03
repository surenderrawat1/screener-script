import type { VerifyFullInput } from './types.js';

export interface ThesisValidation {
  valid: boolean;
  errors: string[];
  watchlist_ready: boolean;
}

const MIN_THESIS = 20;
const MIN_INVALIDATION = 10;

export function validateThesisInput(input: VerifyFullInput): ThesisValidation {
  const errors: string[] = [];

  const business = String(input.thesis_business ?? '').trim();
  const financials = String(input.thesis_financials ?? '').trim();
  const valuation = String(input.thesis_valuation ?? '').trim();
  const inv1 = String(input.invalidation_1 ?? '').trim();
  const inv2 = String(input.invalidation_2 ?? '').trim();
  const reviewDate = String(input.review_date ?? '').trim();

  if (business.length < MIN_THESIS) {
    errors.push(`Business thesis needs ≥ ${MIN_THESIS} characters (${business.length}/${MIN_THESIS})`);
  }
  if (financials.length < MIN_THESIS) {
    errors.push(`Financials thesis needs ≥ ${MIN_THESIS} characters (${financials.length}/${MIN_THESIS})`);
  }
  if (valuation.length < MIN_THESIS) {
    errors.push(`Valuation thesis needs ≥ ${MIN_THESIS} characters (${valuation.length}/${MIN_THESIS})`);
  }
  if (inv1.length < MIN_INVALIDATION || inv2.length < MIN_INVALIDATION) {
    errors.push(`Both invalidation triggers need ≥ ${MIN_INVALIDATION} characters each`);
  }
  if (!reviewDate) {
    errors.push('Review date is required to save thesis to watchlist');
  }

  const attested =
    input.manual_attestation === true ||
    input.manual_attestation === '1' ||
    input.manual_attestation === 1;
  if (
    (input.auto_prefilled === true ||
      input.auto_prefilled === '1' ||
      input.auto_prefilled === 1 ||
      String(input.auto_prefilled ?? '') === 'yes') &&
    !attested
  ) {
    errors.push('Check attestation — confirm Phase 0, 7, and thesis are personally verified');
  }

  return {
    valid: errors.length === 0,
    errors,
    watchlist_ready:
      business.length >= MIN_THESIS &&
      financials.length >= MIN_THESIS &&
      valuation.length >= MIN_THESIS &&
      inv1.length >= MIN_INVALIDATION &&
      inv2.length >= MIN_INVALIDATION &&
      reviewDate.length > 0,
  };
}

export function thesisFieldHint(
  value: string | number | boolean | undefined,
  minLen: number,
): string {
  const len = String(value ?? '').trim().length;
  if (len >= minLen) return `${len} chars — OK`;
  return `${len}/${minLen} chars`;
}

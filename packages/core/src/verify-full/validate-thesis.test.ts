import { describe, expect, it } from 'vitest';
import { validateThesisInput } from './validate-thesis.js';

describe('validateThesisInput', () => {
  const valid = {
    thesis_business: 'A'.repeat(20),
    thesis_financials: 'B'.repeat(20),
    thesis_valuation: 'C'.repeat(20),
    invalidation_1: 'D'.repeat(10),
    invalidation_2: 'E'.repeat(10),
    review_date: '2026-12-31',
    manual_attestation: true,
  };

  it('passes complete thesis', () => {
    const v = validateThesisInput(valid);
    expect(v.valid).toBe(true);
    expect(v.watchlist_ready).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('fails short business thesis', () => {
    const v = validateThesisInput({ ...valid, thesis_business: 'short' });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('Business thesis'))).toBe(true);
  });

  it('requires review date for watchlist', () => {
    const v = validateThesisInput({ ...valid, review_date: '' });
    expect(v.watchlist_ready).toBe(false);
    expect(v.errors.some((e) => e.includes('Review date'))).toBe(true);
  });

  it('requires attestation when auto-prefilled', () => {
    const v = validateThesisInput({
      ...valid,
      auto_prefilled: '1',
      manual_attestation: false,
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('attestation'))).toBe(true);
  });
});

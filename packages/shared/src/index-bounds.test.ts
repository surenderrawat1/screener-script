import { describe, expect, it } from 'vitest';
import { validateIndexSymbolCount } from './indices.js';

describe('validateIndexSymbolCount', () => {
  it('accepts typical Nifty 500 size', () => {
    expect(validateIndexSymbolCount('nifty500', 499)).toBeNull();
    expect(validateIndexSymbolCount('nifty500', 500)).toBeNull();
  });

  it('rejects Total Market size for Nifty 500', () => {
    const err = validateIndexSymbolCount('nifty500', 750);
    expect(err).toMatch(/750 symbols/);
    expect(err).toMatch(/TOTAL-MKT/i);
  });
});

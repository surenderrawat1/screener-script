import { describe, expect, it } from 'vitest';
import { FormState } from './form-state.js';
import { buildEmptyVerifyInput, buildVerifyFullPrefill } from './prefill.js';
import { VERIFY_FULL_PHASES } from './phases.js';
import { mergeSavedFields } from './watchlist-merge.js';

describe('buildVerifyFullPrefill', () => {
  it('returns 9 phases and empty auto_keys', () => {
    const prefill = buildVerifyFullPrefill('tcs');
    expect(prefill.symbol).toBe('TCS');
    expect(prefill.phases).toHaveLength(9);
    expect(prefill.auto_keys).toEqual([]);
    expect(prefill.input.stock_name).toBe('TCS');
    expect(prefill.input.analysis_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prefill.input.review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('strips exchange suffix from symbol', () => {
    expect(buildVerifyFullPrefill('reliance.ns').symbol).toBe('RELIANCE');
  });
});

describe('buildEmptyVerifyInput', () => {
  it('includes all phase field keys', () => {
    const input = buildEmptyVerifyInput();
    const phaseKeys = new Set(VERIFY_FULL_PHASES.flatMap((p) => p.fields.map((f) => f.key)));
    for (const key of phaseKeys) {
      expect(input).toHaveProperty(key);
    }
  });
});

describe('FormState', () => {
  it('manual overrides auto and clears auto key', () => {
    const state = new FormState();
    state.mergeAuto(
      { stock_name: 'TCS', roe: '28', auto_prefilled: '1' },
      { stock_name: 'TCS.NS', roe: '30' },
      ['stock_name', 'roe'],
    );
    expect(state.get('stock_name')).toBe('TCS.NS');
    expect(state.isAuto('stock_name')).toBe(false);
    expect(state.get('roe')).toBe('30');
    expect(state.isAuto('roe')).toBe(false);
    expect(state.autoCount()).toBe(0);
  });

  it('keeps auto when manual omits field', () => {
    const state = new FormState();
    state.mergeAuto({ eps: '120' }, {}, ['eps']);
    expect(state.get('eps')).toBe('120');
    expect(state.isAuto('eps')).toBe(true);
  });

  it('empty manual object does not wipe auto-filled phase data', () => {
    const state = new FormState();
    state.mergeAuto(
      {
        roe: 51.8,
        current_price: 2093,
        revenue_latest: 267021,
        sector: 'it',
        p1_industry_outlook: 'growing',
      },
      {},
      ['roe', 'current_price', 'revenue_latest', 'sector', 'p1_industry_outlook'],
    );
    expect(state.get('roe')).toBe('51.8');
    expect(state.get('current_price')).toBe('2093');
    expect(state.get('revenue_latest')).toBe('267021');
    expect(state.get('sector')).toBe('it');
    expect(state.isAuto('roe')).toBe(true);
    expect(state.autoCount()).toBe(5);
  });

  it('unchecked checkbox in manual does not clear auto', () => {
    const state = new FormState();
    state.mergeAuto(
      { p2_chairman_honest: '1' },
      { p2_chairman_honest: false },
      ['p2_chairman_honest'],
    );
    expect(state.isChecked('p2_chairman_honest')).toBe(true);
    expect(state.isAuto('p2_chairman_honest')).toBe(true);
  });

  it('piotroski placeholder -1 in empty prefill does not wipe auto F-Score', () => {
    const state = new FormState();
    const empty = buildEmptyVerifyInput('TCS');
    state.mergeAuto({ piotroski_score: 7, dcf_iv: 1951 }, empty, ['piotroski_score', 'dcf_iv']);
    expect(state.get('piotroski_score')).toBe('7');
    expect(state.isAuto('piotroski_score')).toBe(true);
    expect(state.get('dcf_iv')).toBe('1951');
  });

  it('loadManual clears auto keys', () => {
    const state = new FormState();
    state.loadManual({ stock_name: 'INFY' });
    expect(state.autoCount()).toBe(0);
    expect(state.get('stock_name')).toBe('INFY');
  });
});

describe('mergeSavedFields', () => {
  it('fills empty thesis slots from watchlist entry', () => {
    const input = buildEmptyVerifyInput('TCS');
    const merged = mergeSavedFields(input, {
      thesis_business: 'Quality IT franchise',
    });
    expect(merged.thesis_business).toBe('Quality IT franchise');
    expect(merged.stock_name).toBe('TCS');
  });
});

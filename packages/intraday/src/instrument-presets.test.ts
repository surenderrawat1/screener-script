import { describe, expect, it } from 'vitest';
import { evaluatePresets, passes, presetOptions, presetOptionsForInstrument } from './entry-filter.js';
import {
  entryFilterOverrides,
  pickLiveRecommendedPreset,
  recommendedPresetForInstrument,
  resolveInstrument,
} from './instruments.js';

const tcs = resolveInstrument('tcs')!;
const nifty = resolveInstrument('nifty50')!;
const bank = resolveInstrument('banknifty')!;
const sensex = resolveInstrument('sensex')!;
const fin = resolveInstrument('finnifty')!;

const longPlan = { ok: true, bias: 'long', trigger: { status: 'READY', actionable: true } };
const waitingPlan = { ok: true, bias: 'long', trigger: { status: 'WAITING', actionable: false } };
const bull = {
  ok: true,
  direction: 'bullish',
  confidence: 62,
  net_score: 30,
  ema_stack_bull: true,
  setup_quality: { grade: 'A' },
};
const mtfOk = { ok: true, aligned: true, conflict: false, deploy_pct: 75 };
const analysis5Long = { ok: true, price: 101, ema50: 100, sma9: 101, sma50: 100 };
const with5m = (opts: Record<string, unknown>) => ({ ...opts, analysis_5m: analysis5Long });

describe('instrument preset options (I-B2)', () => {
  it('stock overrides are stricter than index', () => {
    expect(entryFilterOverrides(nifty)).toEqual({});
    expect(entryFilterOverrides(tcs)).toMatchObject({
      min_mtf_deploy: 60,
      require_actionable_trigger: true,
      min_setup_grade: 'B',
      skip_chop: true,
      max_trades_per_session: 1,
    });
  });

  it('raises numeric floors with max() and keeps stock trigger gate', () => {
    const indexCfa = presetOptionsForInstrument('cfa_precision', nifty);
    const stockCfa = presetOptionsForInstrument('cfa_precision', tcs);
    expect(indexCfa.min_mtf_deploy).toBe(55);
    expect(stockCfa.min_mtf_deploy).toBe(60);
    expect(stockCfa.require_actionable_trigger).toBe(true);

    const indexBase = presetOptionsForInstrument('baseline', nifty);
    const stockBase = presetOptionsForInstrument('baseline', tcs);
    expect(indexBase.require_actionable_trigger).toBeFalsy();
    expect(stockBase.require_actionable_trigger).toBe(true);
    expect(stockBase.min_mtf_deploy).toBe(60);
    expect(stockBase.skip_chop).toBe(true);
    expect(presetOptions('baseline').min_mtf_deploy).toBeUndefined();
  });

  it('TCS requires an actionable trigger; Nifty baseline does not', () => {
    expect(passes(bull, waitingPlan, mtfOk, with5m(presetOptionsForInstrument('baseline', nifty))).pass).toBe(true);
    const tcsWait = passes(bull, waitingPlan, mtfOk, with5m(presetOptionsForInstrument('baseline', tcs)));
    expect(tcsWait.pass).toBe(false);
    expect(tcsWait.reasons.some((r) => /actionable/i.test(r))).toBe(true);
    expect(passes(bull, longPlan, mtfOk, with5m(presetOptionsForInstrument('baseline', tcs))).pass).toBe(true);
  });
});

describe('recommended preset (I-B3)', () => {
  it('keeps v2 defaults (not older PHP presets)', () => {
    expect(recommendedPresetForInstrument('nifty50', '15m')).toBe('cfa_precision');
    expect(recommendedPresetForInstrument('banknifty', '15m')).toBe('banknifty_tuned');
    expect(recommendedPresetForInstrument('sensex', '15m')).toBe('cfa_precision');
    expect(recommendedPresetForInstrument('finnifty', '15m')).toBe('banknifty_tuned');
    expect(recommendedPresetForInstrument('tcs', '15m')).toBe('cfa_precision');
    expect(recommendedPresetForInstrument('nifty50', '5m')).toBe('trend_scalp_5m');
    expect(recommendedPresetForInstrument('tcs', '5m')).toBe('trend_scalp_5m');
    expect(bank.recommended_preset).toBe('banknifty_tuned');
    expect(sensex.recommended_preset).toBe('cfa_precision');
    expect(fin.recommended_preset).toBe('banknifty_tuned');
  });

  it('falls back to the first passing ladder preset when the default fails', () => {
    const evalRows = [
      { id: 'cfa_precision', pass_15m: false },
      { id: 'quality', pass_15m: true },
      { id: 'strict_mtf', pass_15m: false },
      { id: 'production', pass_15m: true },
      { id: 'baseline', pass_15m: true },
    ];
    expect(pickLiveRecommendedPreset('nifty50', '15m', evalRows)).toBe('quality');
    expect(pickLiveRecommendedPreset('banknifty', '15m', [
      { id: 'strict_mtf', pass_15m: true },
      { id: 'quality', pass_15m: true },
      { id: 'banknifty_tuned', pass_15m: true },
    ])).toBe('banknifty_tuned');
    expect(pickLiveRecommendedPreset('banknifty', '15m', [
      { id: 'banknifty_tuned', pass_15m: false },
      { id: 'quality', pass_15m: true },
      { id: 'strict_mtf', pass_15m: true },
    ])).toBe('quality');
    expect(pickLiveRecommendedPreset('nifty50', '5m', [{ id: 'trend_scalp_5m', pass_5m: false }])).toBe(
      'trend_scalp_5m',
    );
  });

  it('evaluatePresets marks the live recommended row and applies stock gates', () => {
    const analysis = { ...bull, trade_plan: waitingPlan };
    const analysis5 = { ...analysis5Long, trade_plan: waitingPlan };
    const indexEval = evaluatePresets(analysis5, analysis, mtfOk, nifty, '15m');
    const stockEval = evaluatePresets(analysis5, analysis, mtfOk, tcs, '15m');
    expect(indexEval).toHaveLength(14);
    const indexBase = indexEval.find((p) => p.id === 'baseline')!;
    const stockBase = stockEval.find((p) => p.id === 'baseline')!;
    expect(indexBase.pass_15m).toBe(true);
    expect(stockBase.pass_15m).toBe(false);
    expect(stockEval.filter((p) => p.recommended)).toHaveLength(1);
  });
});

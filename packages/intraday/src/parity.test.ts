import { describe, expect, it } from 'vitest';
import { build } from './live-playbook.js';
import {
  evaluatePresets,
  passes,
  preflightChecklist,
  preset,
  presetIds,
  presetOptions,
} from './entry-filter.js';
import { entryWindow } from './session-clock.js';
import { classify } from './session-regime.js';
import { fromAnalysis as ema50FromAnalysis } from './ema50-bias.js';
import { fromAnalysis as gc9FromAnalysis } from './gc9-dc9.js';

describe('nifty intraday parity', () => {
  const plan = {
    ok: true,
    bias: 'long',
    bias_label: 'Long bias',
    time_stop_ist: '15:15',
    entry: { type: 'market', price: 100, condition: 'Test entry' },
    stop_loss: { price: 99, pts: 1, pct: 1, label: 'Stop' },
    exits: [
      { tier: 'T1', price: 101, rr: 1, action: 'Book 40%' },
      { tier: 'T2', price: 102, rr: 2, action: 'Book 40%' },
      { tier: 'T3', price: 103, rr: 3, action: 'Book 20%' },
    ],
    trigger: { status: 'READY', label: 'Ready', distance_pts: 0, actionable: true },
    invalidation: 'Close below stop',
    trail: { trail_pts: 12.5, label: 'Trail after T2' },
  };
  const analysis = {
    ok: true,
    price: 100.5,
    interval: '15m',
    direction: 'bullish',
    confidence: 62,
    net_score: 30,
    bar_minutes_ist: 11 * 60,
    entry_window: { open: true, label: '10:15–14:45' },
    setup_quality: { grade: 'A', score: 72 },
    session_regime: { key: 'lean_up', label: 'Mild up' },
    ema_stack_bull: true,
  };
  const analysis5 = {
    ok: true,
    price: 100.5,
    ema50: 99,
    ema50_bias: { bias: 'long', label: '5m above EMA-50', ok: true },
    gc9_dc9_bias: { bias: 'long', label: 'GC9', ok: true },
    sma9: 101,
    sma50: 100,
    gc9_active: true,
  };
  const mtf = { ok: true, aligned: true, deploy_pct: 80, conflict: false };
  const presetEval = [{ id: 'cfa_precision', label: 'CFA precision', pass_15m: true, reasons_15m: [] }];

  it('live playbook builds for valid long plan', () => {
    const pb = build(plan, analysis, analysis5, mtf, presetEval, 'cfa_precision', '15m');
    expect(pb.ok).toBe(true);
    expect(pb.steps).toHaveLength(7);
    expect(pb.actionable).toBe(true);
    expect(String(pb.headline)).toContain('GO');
  });

  it('playbook not actionable when preset blocks', () => {
    const blocked = build(
      plan,
      { ...analysis, confidence: 30 },
      analysis5,
      mtf,
      [{ id: 'cfa_precision', label: 'CFA precision', pass_15m: false, reasons_15m: ['Low confidence'] }],
      'cfa_precision',
      '15m',
    );
    expect(blocked.actionable).toBe(false);
  });

  it('preflight checklist passes aligned setup', () => {
    const checklist = preflightChecklist(analysis, plan, mtf, analysis5, 'cfa_precision', '15m');
    expect(checklist.ok).toBe(true);
  });

  it('playbook stand-aside when no plan', () => {
    const aside = build(null, analysis, analysis5, mtf, presetEval, 'cfa_precision', '15m');
    expect(aside.ok).toBe(false);
  });

  it('thirteen intraday entry presets', () => {
    expect(presetIds()).toHaveLength(13);
    expect(preset('trend_scalp_5m')).not.toBeNull();
    expect(presetOptions('trend_scalp_5m').exit_profile).toBe('quick_scalp');
  });

  it('baseline and strict MTF pass bullish long', () => {
    const basePlan = { ok: true, bias: 'long', trigger: { status: 'READY', actionable: true } };
    const baseAnalysis = { ok: true, direction: 'bullish', confidence: 62 };
    const baseMtf = { ok: true, aligned: true, conflict: false, deploy_pct: 75 };
    const analysis5Long = { ok: true, price: 101, ema50: 100, sma9: 101, sma50: 100 };
    const with5m = (opts: Record<string, unknown>) => ({ ...opts, analysis_5m: analysis5Long });

    expect(passes(baseAnalysis, basePlan, baseMtf, presetOptions('baseline')).pass).toBe(true);
    expect(passes(baseAnalysis, basePlan, baseMtf, with5m(presetOptions('strict_mtf'))).pass).toBe(true);
  });

  it('quality preset blocks chop and low confidence', () => {
    const basePlan = { ok: true, bias: 'long', trigger: { status: 'READY', actionable: true } };
    const baseMtf = { ok: true, aligned: true, conflict: false, deploy_pct: 75 };
    const chop = { ok: true, direction: 'sideways', confidence: 62 };
    expect(passes(chop, basePlan, baseMtf, presetOptions('quality')).pass).toBe(false);
    const lowConf = { ok: true, direction: 'bullish', confidence: 40 };
    expect(passes(lowConf, basePlan, baseMtf, presetOptions('quality')).pass).toBe(false);
  });

  it('evaluatePresets returns all presets', () => {
    const eval15 = evaluatePresets(
      { ...analysis5, trade_plan: plan },
      { ...analysis, trade_plan: plan },
      mtf,
    );
    expect(eval15).toHaveLength(13);
  });

  it('entry window IST gates', () => {
    const early = entryWindow(9 * 60 + 30, { min_entry_min_ist: 10 * 60 + 15 });
    expect(early.open).toBe(false);
    const late = entryWindow(11 * 60, { min_entry_min_ist: 10 * 60 + 15 });
    expect(late.open).toBe(true);
  });

  it('after OR preset blocks pre-10:15', () => {
    const basePlan = { ok: true, bias: 'long', trigger: { status: 'READY', actionable: true } };
    const baseMtf = { ok: true, aligned: true, conflict: false, deploy_pct: 75 };
    const orBlock = passes(
      {
        confidence: 55,
        direction: 'bullish',
        bar_minutes_ist: 9 * 60 + 45,
        session_regime: { key: 'unknown', label: 'Warming up' },
      },
      basePlan,
      baseMtf,
      presetOptions('after_or'),
    );
    expect(orBlock.pass).toBe(false);
    const orOpen = passes(
      {
        confidence: 55,
        direction: 'bullish',
        bar_minutes_ist: 10 * 60 + 30,
        session_regime: { key: 'lean_up', label: 'Mild up' },
      },
      basePlan,
      baseMtf,
      { ...presetOptions('after_or'), analysis_5m: { ok: true, price: 101, ema50: 100, sma9: 101, sma50: 100 } },
    );
    expect(orOpen.pass).toBe(true);
  });

  it('strong up session classifies as trend up', () => {
    const trendBars: Record<string, unknown>[] = [];
    let p = 24_000;
    for (let i = 0; i < 12; i++) {
      p += 18;
      trendBars.push({
        open: p - 5,
        high: p + 8,
        low: p - 6,
        close: p,
      });
    }
    const trendRegime = classify(trendBars, '15m');
    expect(['trend_up', 'lean_up']).toContain(trendRegime.key);
  });

  it('ema50 and gc9 bias from analysis', () => {
    const ema = ema50FromAnalysis({ ok: true, price: 101, ema50: 100 });
    expect(ema.bias).toBe('long');
    const gc = gc9FromAnalysis({ ok: true, sma9: 101, sma50: 100, gc9_active: true });
    expect(gc.bias).toBe('long');
  });
});

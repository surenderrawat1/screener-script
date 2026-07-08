import { describe, expect, it } from 'vitest';
import { investmentReady, runVerificationEngine } from '../verification-engine.js';
import type { Gate, PhaseResult, VerificationResult } from './types.js';

function passGate(id: string): Gate {
  return { id, label: id, status: 'pass', points: 1, max: 1, critical: false, note: '' };
}

function failGate(id: string): Gate {
  return { id, label: id, status: 'fail', points: 0, max: 1, critical: false, note: '' };
}

function phase(
  number: number,
  gates: Gate[],
  extra: Partial<PhaseResult> = {},
): PhaseResult {
  return {
    number,
    title: `Phase ${number}`,
    gates,
    score: gates.reduce((s, g) => s + g.points, 0),
    max: gates.length,
    critical_fail: false,
    gate_note: null,
    investor_gate_blocked: false,
    ...extra,
  };
}

function baseReadyResult(): VerificationResult {
  return {
    stock_name: 'Test',
    analysis_date: '2026-01-01',
    sector: 'it',
    metrics: {
      margin_of_safety: 18,
      valuation_flags: [],
    } as unknown as VerificationResult['metrics'],
    phases: [
      phase(0, [passGate('0.1'), passGate('0.2')]),
      phase(1, [passGate('1.1')]),
      phase(5, [passGate('5.1'), passGate('5.2'), passGate('5.3')]),
      phase(7, [passGate('7.1')]),
      phase(8, [
        passGate('8.1'),
        passGate('8.2'),
        passGate('8.3'),
        passGate('8.4'),
        passGate('8.5'),
      ]),
    ],
    scorecard: { rows: [], total: 40, max: 56, percent: 71, grade: 'B' },
    critical_fails: [],
    red_flag_scan: { flags: [], count: 0, quick_reject: false },
    verdict: {
      action: 'BUY',
      color: 'green',
      summary: '',
      score: 40,
      mos: 18,
      grade: 'B',
      mos_zone: 'fair',
    },
    position_size: null,
    investor_gate: false,
    executive_summary: {
      headline: '',
      pillars: {},
      strengths: [],
      risks: [],
      next_steps: [],
      conviction: 'Medium',
    },
    data_quality: {
      passed: true,
      pass_count: 7,
      auto_count: 5,
      total_count: 7,
      gates: [],
    },
    investment_ready: {
      ready: false,
      automatable_ready: false,
      manual_phases_pending: true,
      screening_mode: false,
      reasons: [],
      checklist: {} as VerificationResult['investment_ready']['checklist'],
    },
  };
}

describe('investmentReady — validate-logic.php parity', () => {
  it('full bar met → investment-ready', () => {
    const ready = investmentReady(baseReadyResult());
    expect(ready.ready).toBe(true);
    expect(ready.automatable_ready).toBe(true);
  });

  it('score 34 → not ready', () => {
    const r = baseReadyResult();
    r.scorecard.total = 34;
    expect(investmentReady(r).ready).toBe(false);
  });

  it('MOS 12% → not ready', () => {
    const r = baseReadyResult();
    r.metrics.margin_of_safety = 12;
    expect(investmentReady(r).ready).toBe(false);
  });

  it('2 red flags → not ready', () => {
    const r = baseReadyResult();
    r.red_flag_scan.count = 2;
    expect(investmentReady(r).ready).toBe(false);
  });

  it('incomplete Phase 8 → not ready', () => {
    const r = baseReadyResult();
    r.phases = [
      ...r.phases.slice(0, 4),
      phase(8, [failGate('8.1')]),
    ];
    expect(investmentReady(r).ready).toBe(false);
  });

  it('auto mode without Phase 8 → not ready', () => {
    const r = baseReadyResult();
    r.phases = r.phases.slice(0, 4);
    expect(investmentReady(r, { auto_mode: true }).ready).toBe(false);
  });

  it('auto mode without attestation → not ready', () => {
    expect(investmentReady(baseReadyResult(), { auto_mode: true }).ready).toBe(false);
  });

  it('auto mode with attestation → ready when bar met', () => {
    expect(
      investmentReady(baseReadyResult(), { auto_mode: true, manual_attestation: true }).ready,
    ).toBe(true);
  });

  it('extreme MOS → not investment-ready', () => {
    const r = baseReadyResult();
    r.metrics.margin_of_safety = 65;
    r.metrics.valuation_flags = ['mos_extreme'];
    expect(investmentReady(r).ready).toBe(false);
  });

  it('screening mode → never investment-ready', () => {
    expect(investmentReady(baseReadyResult(), { screening_mode: true }).ready).toBe(false);
  });
});

describe('runVerificationEngine', () => {
  it('returns scorecard and verdict for TCS-like input', () => {
    const result = runVerificationEngine({
      stock_name: 'Tata Consultancy Services',
      fetch_symbol: 'TCS',
      sector: 'it',
      current_price: 4000,
      eps: 120,
      book_value: 250,
      roe: 45,
      roce: 38,
      pe_ratio: 33,
      debt_to_equity: 0.05,
      revenue_growth: 8,
      eps_growth: 12,
      market_cap_cr: 1450000,
      fcf_cr: 35000,
      p1_promoter_pledge: 0,
      p0_emergency_fund: true,
      p0_debt_cleared: true,
      p0_sip_habit: true,
      p0_asset_allocation: true,
      p0_emotional_discipline: true,
      p1_business_model: true,
      p1_revenue_model: true,
      p1_industry_outlook: 'growing',
      p1_circle_competence: true,
      p1_promoter_stable: true,
      thesis_why: 'Quality IT compounder',
      thesis_moat: 'Brand and scale',
      thesis_valuation: 'MOS from DCF',
      invalidation_1: 'Revenue decline 2 quarters',
      invalidation_2: 'Margin compression',
      review_date: '2026-12-31',
      manual_attestation: true,
    });

    expect(result.scorecard.total).toBeGreaterThan(0);
    expect(result.scorecard.max).toBe(56);
    expect(result.phases).toHaveLength(9);
    expect(result.verdict.action).toBeTruthy();
    expect(result.executive_summary.headline).toBeTruthy();
    expect(result.metrics.margin_of_safety).toBeDefined();
    expect((result.metrics.fair_pe_detail as { fair_pe?: number }).fair_pe).toBe(result.metrics.fair_pe);
    expect((result.metrics.fair_pe_detail as { rationale?: string }).rationale).toContain('production CFA engine');
  });

  it('keeps MOS unknown when valuation inputs are missing', () => {
    const result = runVerificationEngine({
      stock_name: 'Unknown Inputs Ltd',
      fetch_symbol: 'UNKNOWN',
      sector: 'general',
      current_price: 0,
      eps: 0,
      pe_ratio: 0,
      book_value: 0,
      roe: 0,
      roce: 0,
      p0_emergency_fund: true,
      p0_debt_cleared: true,
      p0_sip_habit: true,
      p0_asset_allocation: true,
      p0_emotional_discipline: true,
      p1_business_model: true,
      p1_revenue_model: true,
      p1_circle_competence: true,
    });

    expect(result.metrics.margin_of_safety).toBeNull();
    expect(result.metrics.mos_zone).toBe('Unknown');
    expect(result.verdict.action).toBe('NEED DATA');
    expect(result.verdict.mos_zone).toBe('Unknown');
    expect(result.position_size).toBeNull();
    expect(result.executive_summary.headline).toContain('MOS is unavailable');
  });
});

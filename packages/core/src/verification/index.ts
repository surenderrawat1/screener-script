import { buildExecutiveSummary } from '../executive-summary.js';
import { evaluateDataQuality } from '../data-quality-gate.js';
import type { GateContext } from './gate-helpers.js';
import { investmentReady } from './investment-ready.js';
import { computeDerivedMetrics } from './metrics.js';
import {
  evaluatePhase0,
  evaluatePhase1,
  evaluatePhase2,
  evaluatePhase3,
  evaluatePhase4,
  evaluatePhase5,
  evaluatePhase6,
  evaluatePhase7,
  evaluatePhase8,
  resolveEffectiveSectorKey,
} from './phases.js';
import { applyEpsModeToInput, sanitizeVerifyInput } from './sanitize.js';
import type { PhaseResult, RunVerificationOptions, VerificationResult, VerifyInput } from './types.js';
import {
  buildScorecard,
  determineVerdict,
  runRedFlagScan,
  suggestPositionSize,
} from './verdict.js';

function phaseHasGate(phase: PhaseResult, gateId: string): boolean {
  return phase.gates.some((g) => g.id === gateId);
}

function requiresGrahamForDataQuality(
  phase4: PhaseResult,
  metrics: VerificationResult['metrics'],
  input: VerifyInput,
): boolean {
  if (phaseHasGate(phase4, '4.graham')) return true;

  const flags = metrics.valuation_flags ?? [];
  if (flags.includes('graham_floor_active')) return true;

  const graham = metrics.graham_number ?? 0;
  const price = Number(input.current_price ?? 0);
  if (graham > 0 && !metrics.graham_credible && price > 0 && price <= graham * 1.1) {
    return true;
  }

  return false;
}

export function runVerificationEngine(
  raw: Record<string, unknown>,
  options: RunVerificationOptions = {},
): VerificationResult {
  const sectorHints = options.sectorHints ?? {};
  const input = applyEpsModeToInput(sanitizeVerifyInput(raw));

  const ctx: GateContext = {
    criticalFails: [],
    gateWarnings: [],
  };

  const metrics = computeDerivedMetrics(input, sectorHints);

  const phase0 = evaluatePhase0(input, ctx);
  const phase1 = evaluatePhase1(input, metrics, ctx);
  const phase2 = evaluatePhase2(input, metrics, ctx);
  const phase3 = evaluatePhase3(input, metrics, ctx);
  const phase4 = evaluatePhase4(input, metrics, ctx);
  const phase5 = evaluatePhase5(input, metrics, ctx);
  const phase6 = evaluatePhase6(input, metrics, ctx, sectorHints);
  const phase7 = evaluatePhase7(input, metrics, ctx);
  const phase8 = evaluatePhase8(input, ctx);

  const phases = [phase0, phase1, phase2, phase3, phase4, phase5, phase6, phase7, phase8];
  const scorecard = buildScorecard(phases);
  const redFlagScan = runRedFlagScan(input, metrics);
  const verdict = determineVerdict(input, scorecard, metrics, redFlagScan, ctx.criticalFails);

  const sym = String(input.fetch_symbol ?? input.stock_name ?? '');
  const sectorKey = String(metrics.sector_key ?? resolveEffectiveSectorKey(input, sectorHints));
  const requireGraham = requiresGrahamForDataQuality(phase4, metrics, input);

  const dataQuality = evaluateDataQuality(
    {
      ...metrics,
      symbol: sym,
      sector_key: sectorKey,
      graham_credible: Boolean(metrics.graham_credible),
      altman_skip: Boolean(input.altman_skip),
      z_score_source: String(metrics.z_score_source ?? 'missing'),
    },
    options.cacheMeta ?? null,
    {
      require_graham_credible: requireGraham,
      sectorHints,
      ...options.dataQualityOptions,
    },
  );

  const partial: VerificationResult = {
    stock_name: String(input.stock_name ?? 'Unknown'),
    analysis_date: String(input.analysis_date ?? ''),
    sector: String(input.sector ?? 'general'),
    metrics,
    phases,
    scorecard,
    critical_fails: ctx.criticalFails,
    red_flag_scan: redFlagScan,
    verdict,
    position_size: suggestPositionSize(verdict, metrics),
    investor_gate: Boolean(phase0.investor_gate_blocked),
    executive_summary: {
      headline: '',
      pillars: {},
      strengths: [],
      risks: [],
      next_steps: [],
      conviction: 'None',
    },
    data_quality: dataQuality,
    investment_ready: {
      ready: false,
      automatable_ready: false,
      manual_phases_pending: true,
      screening_mode: false,
      reasons: [],
      checklist: {
        score_ok: false,
        mos_ok: false,
        mos_sane: false,
        no_critical_fails: false,
        red_flags_ok: false,
        data_quality_ok: false,
        phase0_complete: false,
        phase1_complete: false,
        phase5_complete: false,
        phase7_complete: false,
        phase8_complete: false,
        manual_attestation_ok: false,
        manual_phases_pending: true,
      },
    },
  };

  partial.executive_summary = buildExecutiveSummary(partial);
  partial.investment_ready = investmentReady(partial, {
    auto_mode: Boolean(input.auto_prefilled),
    manual_attestation: Boolean(input.manual_attestation),
    screening_mode: Boolean(options.screening_mode),
  });

  return partial;
}

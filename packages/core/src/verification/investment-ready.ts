import { isMosExtreme, MOS_EXTREME_THRESHOLD } from '../valuation.js';
import type {
  InvestmentReadyResult,
  PhaseResult,
  VerificationResult,
} from './types.js';

function phaseMeetsInvestmentBar(
  phase: PhaseResult | null | undefined,
  requireNoCritical: boolean,
  strictWarn = false,
): boolean {
  if (!phase) return false;
  if (phase.investor_gate_blocked) return false;
  if (requireNoCritical && phase.critical_fail) return false;

  for (const gate of phase.gates) {
    const status = gate.status;
    if (status === 'fail' || status === 'critical') return false;
    if (strictWarn && status === 'warn') return false;
  }

  return true;
}

function phaseThesisComplete(phase: PhaseResult | null | undefined): boolean {
  if (!phase) return false;
  if (phase.gates.length === 0) return false;
  return phase.gates.every((gate) => gate.status === 'pass');
}

export interface InvestmentReadyOptions {
  min_score?: number;
  min_mos?: number;
  max_red_flags?: number;
  auto_mode?: boolean;
  manual_attestation?: boolean;
  screening_mode?: boolean;
}

export function investmentReady(
  result: VerificationResult,
  options: InvestmentReadyOptions = {},
): InvestmentReadyResult {
  const minScore = Number(options.min_score ?? 35);
  const minMos = Number(options.min_mos ?? 15);
  const maxRedFlags = Number(options.max_red_flags ?? 1);
  const autoMode = Boolean(options.auto_mode);
  const manualAttestation = Boolean(options.manual_attestation);
  const screeningMode = Boolean(options.screening_mode);

  const sc = result.scorecard;
  const metrics = result.metrics;
  const phases = result.phases;

  const phaseByNum: Record<number, PhaseResult> = {};
  for (const phase of phases) {
    phaseByNum[phase.number] = phase;
  }

  const scoreOk = sc.total >= minScore;
  const mosVal = metrics.margin_of_safety;
  const mosOk = mosVal >= minMos;
  const noCritical = result.critical_fails.length === 0;
  const redCount = result.red_flag_scan.count;
  const redFlagsOk = redCount <= maxRedFlags;
  const dataQualityOk = !result.data_quality || result.data_quality.passed;
  const valFlags = metrics.valuation_flags ?? [];
  const mosExtreme = valFlags.includes('mos_extreme') || isMosExtreme(mosVal);
  const mosSanOk = !mosExtreme;
  const attestationOk = !autoMode || manualAttestation;

  const phase0Ok = phaseMeetsInvestmentBar(phaseByNum[0], true);
  const phase1Ok = phaseMeetsInvestmentBar(phaseByNum[1], true, true);
  const phase5Ok = phaseMeetsInvestmentBar(phaseByNum[5], false, true);
  const phase7Ok = phaseMeetsInvestmentBar(phaseByNum[7], false, true);
  const phase8Ok = phaseThesisComplete(phaseByNum[8]);

  const manualPhasesOk = phase0Ok && phase1Ok && phase5Ok && phase7Ok && phase8Ok && attestationOk;
  const manualPending = !manualPhasesOk;

  const checklist = {
    score_ok: scoreOk,
    mos_ok: mosOk,
    mos_sane: mosSanOk,
    no_critical_fails: noCritical,
    red_flags_ok: redFlagsOk,
    data_quality_ok: dataQualityOk,
    phase0_complete: phase0Ok,
    phase1_complete: phase1Ok,
    phase5_complete: phase5Ok,
    phase7_complete: phase7Ok,
    phase8_complete: phase8Ok,
    manual_attestation_ok: attestationOk,
    manual_phases_pending: manualPending,
  };

  const automatableReady =
    scoreOk && mosOk && mosSanOk && noCritical && redFlagsOk && dataQualityOk;

  const reasons: string[] = [];
  if (!scoreOk) {
    reasons.push(`Scorecard ${sc.total}/56 — need ≥ ${minScore} (Grade B)`);
  }
  if (!mosOk) {
    reasons.push(`MOS ${mosVal.toFixed(1)}% — need ≥ ${minMos}%`);
  }
  if (!noCritical) {
    reasons.push('Critical gate failure(s) present');
  }
  if (!redFlagsOk) {
    reasons.push(`${redCount} red flags — need ≤ ${maxRedFlags}`);
  }
  if (!dataQualityOk) {
    reasons.push('Data quality gates incomplete — review D1–D6');
  }
  if (!mosSanOk) {
    reasons.push(
      `MOS ${mosVal.toFixed(1)}% is extreme (|MOS| > ${MOS_EXTREME_THRESHOLD}%) — verify intrinsic manually`,
    );
  }
  if (screeningMode) {
    reasons.push('Screening mode — use Full Verify with personal attestation before investing');
  } else if (autoMode && !attestationOk) {
    reasons.push('Auto-prefilled data — confirm Phase 0, 7, thesis personally (check attestation box)');
  } else if (!manualPhasesOk) {
    if (!phase0Ok) reasons.push('Phase 0 (personal finance) incomplete');
    if (!phase1Ok) reasons.push('Phase 1 (business quality) incomplete, critical fail, or unanswered gate');
    if (!phase5Ok) reasons.push('Phase 5 (quant screens) incomplete — e.g. unreliable Altman Z');
    if (!phase7Ok) reasons.push('Phase 7 (portfolio fit) incomplete or unanswered gate');
    if (!phase8Ok) reasons.push('Phase 8 (thesis + invalidations + review date) incomplete');
  }

  return {
    ready: automatableReady && !manualPending && !screeningMode,
    automatable_ready: automatableReady,
    manual_phases_pending: manualPending || screeningMode,
    screening_mode: screeningMode,
    reasons,
    checklist,
  };
}

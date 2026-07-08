export type GateStatus = 'pass' | 'fail' | 'critical' | 'warn';

export interface Gate {
  id: string;
  label: string;
  status: GateStatus;
  points: number;
  max: number;
  critical: boolean;
  note: string;
}

export interface PhaseResult {
  number: number;
  title: string;
  gates: Gate[];
  score: number;
  max: number;
  critical_fail: boolean;
  gate_note: string | null;
  investor_gate_blocked: boolean;
  sector_key?: string;
}

export interface CriticalFail {
  id: string;
  label: string;
  note: string;
}

export interface ScorecardRow {
  phase: number;
  title: string;
  score: number;
  max: number;
  critical_fail: boolean;
}

export interface Scorecard {
  rows: ScorecardRow[];
  total: number;
  max: number;
  percent: number;
  grade: string;
}

export interface RedFlagScan {
  flags: string[];
  count: number;
  quick_reject: boolean;
}

export interface Verdict {
  action: string;
  color: string;
  summary: string;
  score: number;
  mos: number | null;
  grade: string;
  mos_zone: string;
}

export interface PositionSize {
  conviction: string;
  mos: string;
  size: string;
}

export interface DerivedMetrics {
  eps_mode: string;
  eps: number;
  eps_consolidated: number;
  eps_standalone: number;
  pe: number;
  pb: number;
  peg: number;
  de: number;
  graham_number: number;
  graham_credible: boolean;
  graham_label: string;
  intrinsic_value: number;
  intrinsic_pe: number;
  fair_pe: number;
  fair_pe_detail: unknown;
  mos_method: string;
  margin_of_safety: number | null;
  fcf: number;
  fcf_yield: number;
  moat_count: number;
  moat_strength: string;
  value_trap_count: number;
  altman_z: number;
  altman_zone: string;
  altman_skip: boolean;
  altman_unreliable: boolean;
  z_score_source: string;
  revenue_trend: string;
  piotroski: number;
  quality_score: number;
  quality_breakdown: Record<string, number>;
  dcf_value: number;
  alt_value: number;
  alt_label: string;
  valuation_model: string;
  final_rating: string;
  business_summary: string;
  key_risks: string[];
  sector_label: string;
  mos_zone: string;
  fcf_source: string;
  ebitda_source: string;
  valuation_flags: string[];
  sector_key: string;
}

export interface ExecutiveSummary {
  headline: string;
  pillars: Record<string, string>;
  strengths: string[];
  risks: string[];
  next_steps: string[];
  conviction: string;
}

export interface DataQualityGate {
  id: string;
  label: string;
  pass: boolean | null;
  note: string;
  manual?: boolean;
  cli?: string;
}

export interface DataQualityResult {
  passed: boolean;
  pass_count: number;
  auto_count: number;
  total_count: number;
  gates: DataQualityGate[];
}

export interface InvestmentReadyChecklist {
  score_ok: boolean;
  mos_ok: boolean;
  mos_sane: boolean;
  no_critical_fails: boolean;
  red_flags_ok: boolean;
  data_quality_ok: boolean;
  phase0_complete: boolean;
  phase1_complete: boolean;
  phase5_complete: boolean;
  phase7_complete: boolean;
  phase8_complete: boolean;
  manual_attestation_ok: boolean;
  manual_phases_pending: boolean;
}

export interface InvestmentReadyResult {
  ready: boolean;
  automatable_ready: boolean;
  manual_phases_pending: boolean;
  screening_mode: boolean;
  reasons: string[];
  checklist: InvestmentReadyChecklist;
}

export interface VerificationResult {
  stock_name: string;
  analysis_date: string;
  sector: string;
  metrics: DerivedMetrics;
  phases: PhaseResult[];
  scorecard: Scorecard;
  critical_fails: CriticalFail[];
  red_flag_scan: RedFlagScan;
  verdict: Verdict;
  position_size: PositionSize | null;
  investor_gate: boolean;
  executive_summary: ExecutiveSummary;
  data_quality: DataQualityResult;
  investment_ready: InvestmentReadyResult;
}

export type VerifyInput = Record<string, string | number | boolean | null | undefined>;

export interface RunVerificationOptions {
  cacheMeta?: { created_at?: number; expires_at?: number } | null;
  sectorHints?: Record<string, string>;
  screening_mode?: boolean;
  dataQualityOptions?: {
    require_graham_credible?: boolean;
    cache_stale_days?: number;
  };
}

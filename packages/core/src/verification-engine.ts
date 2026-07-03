export { runVerificationEngine } from './verification/index.js';
export { buildExecutiveSummary } from './executive-summary.js';
export { evaluateDataQuality } from './data-quality-gate.js';
export { investmentReady } from './verification/investment-ready.js';
export type {
  VerificationResult,
  PhaseResult,
  Verdict,
  Scorecard,
  InvestmentReadyResult,
  Gate,
  GateStatus,
  ExecutiveSummary,
  DataQualityResult,
} from './verification/types.js';

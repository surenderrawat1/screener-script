export type EvidenceBasis = 'screening_matrix' | 'full_verify_matrix' | string;
export type ScoreBasis = 'quality_proxy' | 'full_scorecard' | string;
export type DataQualityLevel = 'reported' | 'limited' | 'estimated' | string;
export type EconStatus = 'pass' | 'fail' | 'unproven' | 'missing' | null | undefined;

const BASIS_COPY: Record<string, string> = {
  screening_matrix: 'Screening matrix',
  full_verify_matrix: 'Full verify matrix',
};

const SCORE_COPY: Record<string, string> = {
  quality_proxy: 'Quality proxy',
  full_scorecard: 'Full scorecard',
};

const DATA_COPY: Record<string, string> = {
  reported: 'Reported data',
  limited: 'Limited data',
  estimated: 'Estimated data',
};

const ECON_COPY: Record<string, string> = {
  pass: 'Econ ✓',
  fail: 'Econ ✗',
  unproven: 'Econ ?',
  missing: 'Econ —',
};

const BASIS_HINT: Record<string, string> = {
  screening_matrix: 'Quick screen from quality proxy and MOS. Confirm with Full Verify before sizing.',
  full_verify_matrix: 'Verdict from Full Verify scorecard and manual gates.',
};

const SCORE_HINT: Record<string, string> = {
  quality_proxy: 'CFA quality proxy (/100), not the Full Verify 56-point scorecard.',
  full_scorecard: 'Full Verify scorecard total (/56).',
};

/** Three-tier evidence row: basis · score · data quality · optional econ. */
export function EvidenceStrip({
  recommendationBasis,
  scoreBasis,
  dataQuality,
  econStatus,
  compact = false,
}: {
  recommendationBasis?: EvidenceBasis | null;
  scoreBasis?: ScoreBasis | null;
  dataQuality?: DataQualityLevel | null;
  econStatus?: EconStatus;
  compact?: boolean;
}) {
  const chips: Array<{ key: string; label: string; tone: string; title?: string }> = [];

  if (recommendationBasis) {
    chips.push({
      key: 'basis',
      label: BASIS_COPY[recommendationBasis] ?? recommendationBasis,
      tone: recommendationBasis === 'full_verify_matrix' ? 'evidence-ok' : 'evidence-warn',
      title: BASIS_HINT[recommendationBasis],
    });
  }
  if (scoreBasis) {
    chips.push({
      key: 'score',
      label: SCORE_COPY[scoreBasis] ?? scoreBasis,
      tone: scoreBasis === 'full_scorecard' ? 'evidence-ok' : 'evidence-neutral',
      title: SCORE_HINT[scoreBasis],
    });
  }
  if (dataQuality) {
    chips.push({
      key: 'data',
      label: DATA_COPY[dataQuality] ?? dataQuality,
      tone:
        dataQuality === 'reported'
          ? 'evidence-ok'
          : dataQuality === 'estimated'
            ? 'evidence-danger'
            : 'evidence-warn',
    });
  }
  if (econStatus) {
    chips.push({
      key: 'econ',
      label: ECON_COPY[econStatus] ?? econStatus,
      tone:
        econStatus === 'pass'
          ? 'evidence-ok'
          : econStatus === 'fail'
            ? 'evidence-danger'
            : 'evidence-warn',
      title:
        econStatus === 'fail'
          ? 'Backtest economic edge failed — paper only'
          : econStatus === 'pass'
            ? 'Backtest economic edge passed'
            : undefined,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className={`evidence-strip${compact ? ' evidence-strip-compact' : ''}`} aria-label="Evidence hierarchy">
      {chips.map((chip) => (
        <span key={chip.key} className={`evidence-chip ${chip.tone}`} title={chip.title}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

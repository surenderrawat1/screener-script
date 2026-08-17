/**
 * Infer Phase 2D annual-report gates from fundamentals + Screener profile text.
 * Screening-grade — confirm flagged items in the actual AR before investing.
 * Port of PHP `AnnualReportLogic`.
 */

export interface AnnualReportCheck {
  ok: boolean;
  note: string;
  flagged?: boolean | string[];
  hits?: string[];
}

export interface AnnualReportScan {
  score: number;
  status: 'pass' | 'warn' | 'fail';
  checks: {
    chairman: AnnualReportCheck;
    auditor: AnnualReportCheck;
    contingent: AnnualReportCheck;
    accounting: AnnualReportCheck;
  };
  inferred: true;
  profile_loaded: boolean;
  evaluated_at: string;
}

export interface AnnualReportGates {
  p2_chairman_honest: string;
  p2_auditor_clean: string;
  p2_contingent_ok: string;
  p2_accounting_ok: string;
}

export interface AnnualReportInferResult {
  gates: AnnualReportGates;
  annual_report: AnnualReportScan;
}

export interface AnnualReportFundamentals {
  cfo_cr?: number;
  pat_cr?: number;
  revenue_history?: number[];
  revenue_growth?: number;
  screener_meta?: string;
  summary?: string;
  business_profile?: {
    about?: string;
    key_points?: string;
  };
}

export interface AnnualReportProfile {
  about?: string;
  key_points?: string;
  business_plans?: {
    key_points_excerpt?: string;
  };
}

const AUDITOR_RED_FLAGS = [
  'qualified opinion',
  'adverse opinion',
  'disclaimer of opinion',
  'emphasis of matter',
  'auditor resignation',
  "auditor's report qualified",
  'material weakness',
  'going concern',
  'fraud reported',
  'fraud in',
] as const;

const CONTINGENT_RED_FLAGS = [
  'litigation',
  'contingent liabilit',
  'penalty imposed',
  'show cause notice',
  'sebi order',
  'nclt',
  'insolvency',
  'ibc proceedings',
  'credit rating downgrade',
  'downgraded to',
  'fraud investigation',
  'income tax raid',
  'gst notice',
  'regulatory action',
] as const;

function fundamentalsFromData(data: AnnualReportFundamentals): {
  cfo: number;
  pat: number;
  cfo_pat_ok: boolean;
  revenue_declining: boolean;
  revenue_growth: number;
} {
  const revs = (data.revenue_history ?? []).filter((v) => Number.isFinite(v) && v > 0);
  const revCount = revs.length;
  const declining =
    revCount >= 3 &&
    revs[revCount - 1]! < revs[revCount - 2]! &&
    revs[revCount - 2]! < revs[revCount - 3]!;

  const cfo = Number(data.cfo_cr ?? 0);
  const pat = Number(data.pat_cr ?? 0);
  const cfoPatOk = pat <= 0 ? cfo >= 0 : cfo >= pat * 0.65;

  return {
    cfo,
    pat,
    cfo_pat_ok: cfoPatOk,
    revenue_declining: declining,
    revenue_growth: Number(data.revenue_growth ?? 0),
  };
}

function profileTextBlob(
  data: AnnualReportFundamentals,
  profile: AnnualReportProfile | null | undefined,
): string {
  const parts: string[] = [
    String(data.screener_meta ?? ''),
    String(data.summary ?? ''),
  ];

  if (profile && Object.keys(profile).length > 0) {
    parts.push(String(profile.about ?? ''));
    parts.push(String(profile.key_points ?? ''));
    parts.push(String(profile.business_plans?.key_points_excerpt ?? ''));
  } else if (data.business_profile) {
    parts.push(String(data.business_profile.about ?? ''));
    parts.push(String(data.business_profile.key_points ?? ''));
  }

  return parts.join('\n').toLowerCase();
}

function checkAccounting(
  input: ReturnType<typeof fundamentalsFromData>,
  data: AnnualReportFundamentals,
): AnnualReportCheck {
  const flags: string[] = [];
  if (!input.cfo_pat_ok) flags.push('CFO trails PAT (<65% conversion)');
  if (input.revenue_declining) flags.push('Revenue declining 2+ years');
  if (Number(data.pat_cr ?? 0) < 0) flags.push('Negative PAT');

  return {
    ok: flags.length === 0,
    note:
      flags.length === 0
        ? 'Cash flows and earnings trend look consistent.'
        : flags.join('; '),
    flagged: flags,
  };
}

function checkTextClean(
  blob: string,
  needles: readonly string[],
  label: string,
): AnnualReportCheck {
  if (blob === '') {
    return {
      ok: true,
      note: `No Screener commentary — ${label} gate passes on absence of flagged text.`,
      flagged: false,
      hits: [],
    };
  }

  const hits = needles.filter((needle) => blob.includes(needle));
  return {
    ok: hits.length === 0,
    note:
      hits.length === 0
        ? `No ${label} red-flag phrases in Screener profile.`
        : `Flagged phrases: ${hits.slice(0, 4).join(', ')}`,
    flagged: hits.length > 0,
    hits,
  };
}

function checkChairmanNarrative(
  input: ReturnType<typeof fundamentalsFromData>,
  accountingOk: boolean,
): AnnualReportCheck {
  if (input.revenue_declining) {
    return {
      ok: false,
      note: 'Revenue trend declining — narrative vs numbers mismatch risk.',
    };
  }
  if (!accountingOk) {
    return {
      ok: false,
      note: 'Accounting quality weak — chairman letter cannot offset numbers.',
    };
  }
  if (input.revenue_growth < -5) {
    return {
      ok: false,
      note: 'Sales YoY contraction — verify management explanation in AR.',
    };
  }
  return { ok: true, note: 'Revenue trend and cash earnings broadly aligned.' };
}

/** Infer Phase 2D AR gates — PHP `AnnualReportLogic::inferGates`. */
export function inferAnnualReportGates(
  data: AnnualReportFundamentals,
  profile: AnnualReportProfile | null | undefined = null,
): AnnualReportInferResult {
  const input = fundamentalsFromData(data);
  const textBlob = profileTextBlob(data, profile);
  const profileLoaded = profile != null && Object.keys(profile).length > 0;

  const accounting = checkAccounting(input, data);
  const contingent = checkTextClean(textBlob, CONTINGENT_RED_FLAGS, 'contingent');
  const auditor = checkTextClean(textBlob, AUDITOR_RED_FLAGS, 'auditor');
  const chairman = checkChairmanNarrative(input, accounting.ok);

  if (accounting.ok) {
    auditor.ok = auditor.ok && !auditor.flagged;
    contingent.ok = contingent.ok && !contingent.flagged;
  }

  if (!profileLoaded) {
    auditor.note = `${auditor.note} Profile not loaded — auditor gate uses fundamentals only.`;
    contingent.note = `${contingent.note} Profile not loaded — contingent gate uses fundamentals only.`;
  }

  const checks = { chairman, auditor, contingent, accounting };
  const score = Object.values(checks).filter((c) => c.ok).length;
  const status: AnnualReportScan['status'] =
    score >= 3 ? 'pass' : score >= 2 ? 'warn' : 'fail';

  return {
    gates: {
      p2_chairman_honest: chairman.ok ? '1' : '',
      p2_auditor_clean: auditor.ok ? '1' : '',
      p2_contingent_ok: contingent.ok ? '1' : '',
      p2_accounting_ok: accounting.ok ? '1' : '',
    },
    annual_report: {
      score,
      status,
      checks,
      inferred: true,
      profile_loaded: profileLoaded,
      evaluated_at: new Date().toISOString(),
    },
  };
}

const AR_GATE_KEYS = [
  'p2_chairman_honest',
  'p2_auditor_clean',
  'p2_contingent_ok',
  'p2_accounting_ok',
] as const;

function isExplicitFail(value: unknown): boolean {
  return value === '0' || value === 0 || value === false || value === 'no';
}

/** Merge AR gates into autofill input; preserve screener/shareholding explicit fails. */
export function mergeAnnualReportGates(
  input: Record<string, string | number | boolean>,
  gates: AnnualReportGates,
): Record<string, string | number | boolean> {
  const out = { ...input };
  for (const key of AR_GATE_KEYS) {
    if (isExplicitFail(input[key])) continue;
    out[key] = gates[key];
  }
  return out;
}

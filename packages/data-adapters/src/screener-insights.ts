/** Screener.in machine-generated pros/cons → CFA decision flags. */

export type ScreenerInsightSeverity = 'critical' | 'watch' | 'info';

export type ScreenerInsightCategory =
  | 'governance'
  | 'profitability'
  | 'leverage'
  | 'growth'
  | 'earnings_quality'
  | 'dividend'
  | 'other';

export interface ScreenerInsightWarning {
  text: string;
  severity: ScreenerInsightSeverity;
  category: ScreenerInsightCategory;
  /** Short label for UI chips */
  label: string;
}

const RULES: Array<{
  test: RegExp;
  severity: ScreenerInsightSeverity;
  category: ScreenerInsightCategory;
  label: string;
}> = [
  { test: /pledge/i, severity: 'critical', category: 'governance', label: 'Promoter pledge' },
  { test: /promoter holding (?:is )?(?:decreasing|declining|fallen)/i, severity: 'watch', category: 'governance', label: 'Promoter holding' },
  { test: /low return on equity|roe of [0-9.]+% over last/i, severity: 'watch', category: 'profitability', label: 'Low ROE' },
  { test: /low return on capital|roce/i, severity: 'watch', category: 'profitability', label: 'Low ROCE' },
  { test: /interest coverage/i, severity: 'watch', category: 'leverage', label: 'Interest coverage' },
  { test: /contingent liabilit/i, severity: 'watch', category: 'leverage', label: 'Contingent liabilities' },
  { test: /debt.*(?:high|increas|ris)/i, severity: 'watch', category: 'leverage', label: 'Debt' },
  { test: /debt to equity/i, severity: 'watch', category: 'leverage', label: 'Debt/equity' },
  { test: /poor sales growth|declining sales|sales degrowth|negative sales growth/i, severity: 'watch', category: 'growth', label: 'Sales growth' },
  { test: /profit (?:declin|fall|degrowth)|negative profit|loss/i, severity: 'watch', category: 'profitability', label: 'Profit trend' },
  { test: /other income|exceptional item|one.?time/i, severity: 'info', category: 'earnings_quality', label: 'Earnings quality' },
  { test: /dividend payout (?:has been )?low|no dividend|stopped dividend/i, severity: 'info', category: 'dividend', label: 'Dividend payout' },
  { test: /working capital|receivable days|inventory days/i, severity: 'watch', category: 'earnings_quality', label: 'Working capital' },
  { test: /related party|promoter.*loan|rpt/i, severity: 'watch', category: 'governance', label: 'Related-party' },
  { test: /auditor|qualification|resign/i, severity: 'critical', category: 'governance', label: 'Auditor' },
];

function decodeHtml(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse `<div class="pros|cons">` bullet lists from Screener company HTML. */
export function parseScreenerProsCons(html: string): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];

  for (const kind of ['pros', 'cons'] as const) {
    const blockRe = new RegExp(
      `<div class="${kind}"[^>]*>[\\s\\S]*?<ul>([\\s\\S]*?)<\\/ul>`,
      'i',
    );
    const block = html.match(blockRe)?.[1] ?? '';
    const itemRe = /<li>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(block)) !== null) {
      const text = decodeHtml(m[1].replace(/<[^>]+>/g, ''));
      if (!text) continue;
      if (kind === 'pros') pros.push(text);
      else cons.push(text);
    }
  }

  return { pros, cons };
}

export function classifyScreenerCons(cons: string[]): ScreenerInsightWarning[] {
  const out: ScreenerInsightWarning[] = [];
  const seen = new Set<string>();

  for (const raw of cons) {
    const text = raw.trim();
    if (!text) continue;

    let matched = false;
    for (const rule of RULES) {
      if (!rule.test.test(text)) continue;
      const key = `${rule.category}:${rule.label}:${text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text,
        severity: rule.severity,
        category: rule.category,
        label: rule.label,
      });
      matched = true;
      break;
    }

    if (!matched) {
      const key = `other:${text.slice(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          text,
          severity: 'info',
          category: 'other',
          label: 'Other',
        });
      }
    }
  }

  const rank: Record<ScreenerInsightSeverity, number> = { critical: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function buildScreenerInsights(pros: string[], cons: string[]) {
  const warnings = classifyScreenerCons(cons);
  return {
    pros,
    cons,
    warnings,
    has_critical: warnings.some((w) => w.severity === 'critical'),
    has_watch: warnings.some((w) => w.severity === 'watch'),
    source: 'screener.in',
  };
}

export interface ScreenerVerifierGatePatch {
  field: string;
  value: string | number;
  reason: string;
  severity: ScreenerInsightSeverity;
}

/** Map Screener checklist flags into Full Verify Phase 1–2 soft gates (conservative defaults). */
export function applyScreenerWarningsToVerifierAutofill(
  input: Record<string, string | number | boolean | undefined>,
  autoKeys: string[],
  warnings: ScreenerInsightWarning[],
): {
  input: Record<string, string | number | boolean | undefined>;
  auto_keys: string[];
  adjustments: ScreenerVerifierGatePatch[];
} {
  if (!warnings.length) {
    return { input, auto_keys: autoKeys, adjustments: [] };
  }

  const out = { ...input };
  const keys = new Set(autoKeys);
  const adjustments: ScreenerVerifierGatePatch[] = [];
  const seenFields = new Set<string>();

  function patch(
    field: string,
    value: string | number,
    reason: string,
    severity: ScreenerInsightSeverity,
  ) {
    if (seenFields.has(field)) return;
    seenFields.add(field);
    out[field] = value;
    keys.add(field);
    adjustments.push({ field, value, reason, severity });
  }

  for (const w of warnings) {
    switch (w.label) {
      case 'Promoter holding':
        patch('p1_promoter_stable', 'no', w.text, w.severity);
        break;
      case 'Related-party':
        patch('p1_rpt_normal', 'no', w.text, w.severity);
        break;
      case 'Auditor':
        patch('p1_auditor_clean', 'no', w.text, w.severity);
        patch('p2_auditor_clean', '0', w.text, w.severity);
        break;
      case 'Contingent liabilities':
        patch('p2_contingent_ok', '0', w.text, w.severity);
        break;
      case 'Interest coverage':
        patch('interest_coverage', 2, w.text, w.severity);
        break;
      case 'Debt':
      case 'Debt/equity':
        patch('p2_de_ok', 'no', w.text, w.severity);
        break;
      case 'Earnings quality':
        patch('p2_pat_quality', 'no', w.text, w.severity);
        patch('p2_accounting_ok', '0', w.text, w.severity);
        break;
      case 'Working capital':
        patch('p2_wc_ok', 'no', w.text, w.severity);
        patch('receivable_days_trend', 'ballooning', w.text, w.severity);
        break;
      case 'Sales growth':
        patch('p2_revenue_growing', 'no', w.text, w.severity);
        break;
      case 'Profit trend':
        patch('p2_pat_quality', 'no', w.text, w.severity);
        break;
      case 'Low ROE':
        patch('roe_3yr_above_15', 'no', w.text, w.severity);
        break;
      case 'Low ROCE':
        patch('roce_near_roe', 'no', w.text, w.severity);
        break;
      default:
        break;
    }
  }

  return { input: out, auto_keys: [...keys], adjustments };
}

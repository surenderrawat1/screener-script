import { parseSectionTable } from './screener-financials.js';

export type ShareholdingTrend = 'increasing' | 'declining' | 'stable' | 'unknown';

export interface ShareholdingCategory {
  label: string;
  latest_pct: number;
  prev_pct: number | null;
  change_pp: number | null;
  trend: ShareholdingTrend;
  history: Record<string, number | null>;
}

export interface ScreenerShareholding {
  periods: string[];
  latest_period: string;
  categories: ShareholdingCategory[];
  promoter: ShareholdingCategory | null;
  fii: ShareholdingCategory | null;
  dii: ShareholdingCategory | null;
  public: ShareholdingCategory | null;
  source: 'screener.in';
}

const ROW_ALIASES: Record<string, 'promoter' | 'fii' | 'dii' | 'public' | 'other'> = {
  promoters: 'promoter',
  promoter: 'promoter',
  'promoter group': 'promoter',
  fiis: 'fii',
  fii: 'fii',
  'foreign institutions': 'fii',
  diis: 'dii',
  dii: 'dii',
  'domestic institutions': 'dii',
  public: 'public',
  'public+': 'public',
  'retail and others': 'public',
};

function normalizeRowLabel(label: string): string {
  return label.replace(/\s*\+$/, '').trim().toLowerCase();
}

function trendFromChange(changePp: number | null): ShareholdingTrend {
  if (changePp === null || !Number.isFinite(changePp)) return 'unknown';
  if (changePp >= 0.5) return 'increasing';
  if (changePp <= -0.5) return 'declining';
  return 'stable';
}

function categoryFromRow(
  label: string,
  periods: string[],
  row: Record<string, number | null>,
): ShareholdingCategory | null {
  const nums = periods
    .map((p) => row[p])
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) return null;

  const latest = nums[nums.length - 1];
  const prev = nums.length >= 2 ? nums[nums.length - 2] : null;
  const changePp = prev != null ? Math.round((latest - prev) * 100) / 100 : null;

  return {
    label: label.replace(/\s*\+$/, '').trim(),
    latest_pct: Math.round(latest * 100) / 100,
    prev_pct: prev != null ? Math.round(prev * 100) / 100 : null,
    change_pp: changePp,
    trend: trendFromChange(changePp),
    history: { ...row },
  };
}

export function parseScreenerShareholding(html: string): ScreenerShareholding | null {
  const table = parseSectionTable(html, 'shareholding');
  if (!table.periods.length || !Object.keys(table.rows).length) return null;

  const categories: ShareholdingCategory[] = [];
  const byKind: Partial<Record<'promoter' | 'fii' | 'dii' | 'public', ShareholdingCategory>> = {};

  for (const [rawLabel, row] of Object.entries(table.rows)) {
    const kind = ROW_ALIASES[normalizeRowLabel(rawLabel)];
    const cat = categoryFromRow(rawLabel, table.periods, row);
    if (!cat) continue;
    categories.push(cat);
    if (kind && kind !== 'other' && !byKind[kind]) byKind[kind] = cat;
  }

  if (!categories.length) return null;

  return {
    periods: table.periods,
    latest_period: table.periods[table.periods.length - 1] ?? '',
    categories,
    promoter: byKind.promoter ?? null,
    fii: byKind.fii ?? null,
    dii: byKind.dii ?? null,
    public: byKind.public ?? null,
    source: 'screener.in',
  };
}

export function shareholdingTrendNote(cat: ShareholdingCategory | null): string {
  if (!cat) return '';
  if (cat.trend === 'unknown') return `As of latest quarter (${cat.latest_pct}%)`;
  const dir =
    cat.trend === 'increasing' ? '↑' : cat.trend === 'declining' ? '↓' : '→';
  const delta =
    cat.change_pp != null
      ? `${cat.change_pp >= 0 ? '+' : ''}${cat.change_pp} pp vs prior quarter`
      : '';
  return [dir, delta].filter(Boolean).join(' · ');
}

export interface ShareholdingVerifierPatch {
  field: string;
  value: string | number;
  reason: string;
}

/** Promoter/FII trend → Full Verify Phase 1 governance hints. */
export function shareholdingVerifierPatches(
  shareholding: ScreenerShareholding | null | undefined,
): ShareholdingVerifierPatch[] {
  if (!shareholding) return [];
  const out: ShareholdingVerifierPatch[] = [];
  const period = shareholding.latest_period;

  if (shareholding.promoter?.trend === 'declining') {
    out.push({
      field: 'p1_promoter_stable',
      value: 'no',
      reason: `Promoter holding ${shareholding.promoter.latest_pct}% (${shareholding.promoter.change_pp ?? 0} pp QoQ) — ${period}`,
    });
  } else if (shareholding.promoter?.trend === 'stable' || shareholding.promoter?.trend === 'increasing') {
    out.push({
      field: 'p1_promoter_stable',
      value: 'yes',
      reason: `Promoter holding ${shareholding.promoter.latest_pct}% stable/rising — ${period}`,
    });
  }

  if (shareholding.fii && Math.abs(shareholding.fii.change_pp ?? 0) >= 1) {
    out.push({
      field: 'mr_business_vs_sentiment',
      value:
        shareholding.fii.trend === 'increasing'
          ? 'FII stake rising — check if price already reflects institutional interest.'
          : 'FII stake falling — review if exit is structural or rebalancing.',
      reason: `FII ${shareholding.fii.latest_pct}% (${shareholding.fii.change_pp ?? 0} pp QoQ) — ${period}`,
    });
  }

  return out;
}

export function applyShareholdingVerifierPatches(
  input: Record<string, string | number | boolean | undefined>,
  autoKeys: string[],
  shareholding: ScreenerShareholding | null | undefined,
) {
  const patches = shareholdingVerifierPatches(shareholding);
  if (!patches.length) return { input, auto_keys: autoKeys, adjustments: patches };
  const out = { ...input };
  const keys = new Set(autoKeys);
  for (const p of patches) {
    out[p.field] = p.value;
    keys.add(p.field);
  }
  return { input: out, auto_keys: [...keys], adjustments: patches };
}

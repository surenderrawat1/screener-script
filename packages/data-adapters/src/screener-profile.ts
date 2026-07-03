import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, CACHE_TTL } from '@sv/shared';
import { httpGet } from './http.js';
import { parseSectionTable } from './screener-financials.js';

const EXPENDITURE_ROWS = [
  'Expenses',
  'Cash from Operating Activity',
  'Cash from Investing Activity',
  'Cash from Financing Activity',
  'Net Cash Flow',
  'Fixed Assets',
  'CWIP',
  'Depreciation',
  'Interest',
  'Other Expenses',
];

const PLAN_KEYWORDS = [
  'capex',
  'capital expenditure',
  'investment',
  'guidance',
  'outlook',
  'plan',
  'target',
  'capacity',
  'expansion',
  'commission',
  'project',
  'fy20',
  'fy21',
  'fy22',
  'fy23',
  'fy24',
  'fy25',
  'fy26',
  'fy27',
  'roadmap',
  'strategy',
];

export interface ConcallLink {
  period: string;
  transcript_url: string;
  ppt_url: string;
  rec_url: string;
  ai_summary_url: string;
  ai_summary_title: string;
  has_ai_summary: boolean;
}

export interface ExpenditureItem {
  label: string;
  latest_period: string;
  latest_cr: number | null;
  history: Record<string, number | null>;
}

export interface ScreenerProfile {
  about: string;
  key_points: string;
  website: string;
  bse_code: string;
  nse_symbol: string;
  concalls: ConcallLink[];
  expenditures: {
    unit: string;
    items: ExpenditureItem[];
    tables: Record<string, string[]>;
  };
  business_plans: {
    highlights: string[];
    key_points_excerpt: string;
    recent_concalls: string[];
  };
  source: string;
  fetched_at: string;
}

function cleanHtmlText(html: string): string {
  let text = html.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/\s+/g, ' ').replace(/\s*\[\d+\]\s*/g, ' ');
  return text.trim();
}

function extractAbout(html: string): string {
  const m = html.match(/<div class="sub show-more-box about"[^>]*>(.*?)<\/div>/si);
  return m ? cleanHtmlText(m[1]) : '';
}

function extractKeyPoints(html: string): string {
  const m = html.match(/<div class="sub commentary[^"]*"[^>]*>(.*?)<\/div>/si);
  return m ? cleanHtmlText(m[1]) : '';
}

function extractExchangeLinks(html: string): { website: string; bse_code: string; nse_symbol: string } {
  let website = '';
  const wm = html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*<i class="icon-link"><\/i>/i);
  if (wm) website = wm[1].trim();

  let bse = '';
  const bm = html.match(/BSE:\s*(\d+)/i);
  if (bm) bse = bm[1].trim();

  let nse = '';
  const nm = html.match(/NSE:\s*([A-Z0-9.&-]+)/i);
  if (nm) nse = nm[1].toUpperCase().trim();

  return { website, bse_code: bse, nse_symbol: nse };
}

function firstHref(html: string, label: string): string {
  const pattern = new RegExp(`<a[^>]+href="([^"]+)"[^>]*>${label}</a>`, 'i');
  const m = html.match(pattern);
  return m ? m[1].trim() : '';
}

function extractConcalls(html: string): ConcallLink[] {
  const block = html.match(/<div class="documents concalls.*?<ul class="list-links">(.*?)<\/ul>/si);
  if (!block) return [];

  const rowRe = /<li class="flex[^"]*">.*?<div[^>]*>([^<]+)<\/div>(.*?)<\/li>/gis;
  const items: ConcallLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block[1])) !== null && items.length < 8) {
    const period = m[1].trim();
    const body = m[2];
    let aiUrl = '';
    let aiTitle = '';
    const am = body.match(/data-url="(\/concalls\/summary\/\d+\/)"[^>]*data-title="([^"]+)"/si);
    if (am) {
      aiUrl = `https://www.screener.in${am[1]}`;
      aiTitle = am[2];
    }
    items.push({
      period,
      transcript_url: firstHref(body, 'Transcript'),
      ppt_url: firstHref(body, 'PPT'),
      rec_url: firstHref(body, 'REC'),
      ai_summary_url: aiUrl,
      ai_summary_title: aiTitle,
      has_ai_summary: aiUrl !== '',
    });
  }
  return items;
}

function findMergedRow(
  merged: Record<string, Record<string, number | null>>,
  label: string,
): Record<string, number | null> | null {
  if (merged[label]) return merged[label];
  const norm = label.toLowerCase();
  for (const [key, series] of Object.entries(merged)) {
    const k = key.replace(/\s*\+$/, '').toLowerCase();
    if (k === norm || k.startsWith(norm) || norm.startsWith(k)) return series;
  }
  return null;
}

function buildExpenditureSnapshot(html: string) {
  const quarters = parseSectionTable(html, 'quarters');
  const cashFlow = parseSectionTable(html, 'cash-flow');
  const balance = parseSectionTable(html, 'balance-sheet');
  const profitLoss = parseSectionTable(html, 'profit-loss');
  const merged = { ...quarters.rows, ...cashFlow.rows, ...balance.rows, ...profitLoss.rows };

  const items: ExpenditureItem[] = [];
  for (const label of EXPENDITURE_ROWS) {
    const series = findMergedRow(merged, label);
    if (!series) continue;
    const periodKeys = Object.keys(series);
    const latestPeriod = periodKeys.length ? periodKeys[periodKeys.length - 1] : '';
    const latestVal = latestPeriod ? series[latestPeriod] : null;
    const historyEntries = periodKeys.slice(-5);
    const history: Record<string, number | null> = {};
    for (const p of historyEntries) history[p] = series[p];
    items.push({ label, latest_period: latestPeriod, latest_cr: latestVal ?? null, history });
  }

  return {
    unit: 'Rs Cr (consolidated, Screener.in)',
    items,
    tables: {
      quarters: quarters.periods,
      cash_flow: cashFlow.periods,
      balance_sheet: balance.periods,
      profit_loss: profitLoss.periods,
    },
  };
}

function extractBusinessPlans(about: string, keyPoints: string, concalls: ConcallLink[]) {
  const blob = `${about}\n${keyPoints}`;
  const highlights: string[] = [];
  const sentences = blob.split(/\n+|(?<=[.!?])\s+|<br\s*\/?>/i);
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length < 20) continue;
    const lower = s.toLowerCase();
    if (PLAN_KEYWORDS.some((kw) => lower.includes(kw))) {
      highlights.push(s);
    }
    if (highlights.length >= 8) break;
  }

  const events: string[] = [];
  for (const c of concalls.slice(0, 4)) {
    if (c.period) {
      events.push(c.ai_summary_title || `Concall — ${c.period}`);
    }
  }

  return {
    highlights: [...new Set(highlights)],
    key_points_excerpt: keyPoints.slice(0, 1200),
    recent_concalls: events,
  };
}

export function parseScreenerProfileHtml(html: string): ScreenerProfile {
  const about = extractAbout(html);
  const keyPoints = extractKeyPoints(html);
  const links = extractExchangeLinks(html);
  const concalls = extractConcalls(html);
  const expenditures = buildExpenditureSnapshot(html);
  const plans = extractBusinessPlans(about, keyPoints, concalls);

  return {
    about,
    key_points: keyPoints,
    website: links.website,
    bse_code: links.bse_code,
    nse_symbol: links.nse_symbol,
    concalls,
    expenditures,
    business_plans: plans,
    source: 'screener.in',
    fetched_at: new Date().toISOString(),
  };
}

export async function fetchScreenerProfile(
  symbol: string,
  mode: 'consolidated' | 'standalone' = 'consolidated',
  refresh = false,
): Promise<ScreenerProfile | null> {
  const slug = symbol.toLowerCase().replace(/\.(ns|bo)$/, '');
  if (!slug) return null;

  const cacheKeyStr = cacheKey(CACHE_PREFIX.SCREENER_TABLE, `profile:${mode}:${slug}`);
  if (!refresh) {
    const cached = await cacheGetJson<ScreenerProfile>(cacheKeyStr);
    if (cached?.source) return cached;
  }

  const base = `https://www.screener.in/company/${encodeURIComponent(slug)}/`;
  const url = mode === 'standalone' ? base : `${base}consolidated/`;
  const html = await httpGet(url);
  if (!html) return null;

  const profile = parseScreenerProfileHtml(html);
  await cacheSetJson(cacheKeyStr, profile, CACHE_TTL.screener_table);
  return profile;
}

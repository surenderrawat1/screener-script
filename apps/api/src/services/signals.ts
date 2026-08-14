import {
  getChartPatternsMorningPanel,
  getSwingAutoSnapshotDurable,
  inboxSignalsFromChartPatterns,
} from '@sv/data-adapters';
import { prisma, JobStatus, JobType } from '@sv/db';
import {
  intradayPositionsPanel,
  swingPositionsPanel,
} from '@sv/swing';
import { refreshOpenPositions } from './swing-auto.js';
import { listSwingPositions } from './swing-positions.js';
import { listIntradayPositions, trackOpenIntradayPositions } from './intraday-positions.js';
import { listWatchlist } from './watchlist.js';
import { listVerificationHistory } from './verification-history.js';

export type SignalBook = 'swing' | 'intraday' | 'watchlist' | 'screener' | 'verify' | 'pattern';
export type SignalSide = 'entry' | 'exit' | 'review';
export type SignalUrgency = 'danger' | 'warn' | 'ok' | 'info';
export type EconStatus = 'pass' | 'fail' | 'unproven' | 'missing';

export interface InboxSignal {
  id: string;
  book: SignalBook;
  side: SignalSide;
  symbol: string;
  name?: string;
  verdict?: string;
  strict_verdict?: string;
  decision_label?: string;
  decision_score?: number;
  price?: number | null;
  mos?: number | null;
  quality_score?: number | null;
  high_conviction?: boolean;
  recommendation_basis?: string;
  score_basis?: string;
  data_quality?: string;
  econ_status?: EconStatus;
  source_href: string;
  detail?: string;
  as_of?: string;
  urgency?: SignalUrgency;
}

const DISCLAIMER =
  'Research inbox only — cached snapshots and last position refresh. Confirm on NSE before orders.';

const URGENCY_RANK: Record<SignalUrgency, number> = {
  danger: 0,
  warn: 1,
  ok: 2,
  info: 3,
};

function econFromSwingHit(hit: Record<string, unknown>): EconStatus {
  const grade = String(hit.backtest_grade ?? '').toLowerCase();
  const n = Number(hit.backtest_trades ?? 0);
  if (!grade || n === 0) return 'missing';
  if (n < 10) return 'unproven';
  if (grade === 'fail' || grade === 'weak') return 'fail';
  if (hit.net_edge_ok === true && (grade === 'strong' || grade === 'ok')) return 'pass';
  if (hit.net_edge_ok === false) return 'fail';
  return 'unproven';
}

function reviewDue(reviewDate: string): boolean {
  if (!reviewDate) return false;
  const rd = new Date(reviewDate);
  if (Number.isNaN(rd.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return rd <= today;
}

function swingHcSignals(
  snapshot: { saved_at?: string; tiers?: Record<string, unknown> } | null,
): InboxSignal[] {
  if (!snapshot) return [];
  const tiers = (snapshot.tiers ?? {}) as Record<string, unknown>;
  const rawHits = Array.isArray(tiers.high_conviction)
    ? (tiers.high_conviction as Record<string, unknown>[])
    : [];
  const asOf = String(snapshot.saved_at ?? '') || undefined;

  return rawHits.map((hit) => {
    const symbol = String(hit.symbol ?? '');
    return {
      id: `swing-hc:${symbol}`,
      book: 'swing',
      side: 'entry',
      symbol,
      name: hit.name ? String(hit.name) : undefined,
      verdict: hit.verdict ? String(hit.verdict) : undefined,
      strict_verdict: hit.strict_verdict ? String(hit.strict_verdict) : undefined,
      decision_label: String(hit.decision_label ?? hit.decision_action ?? ''),
      decision_score: Number(hit.decision_score ?? 0) || undefined,
      price: typeof hit.price === 'number' ? hit.price : null,
      mos: typeof hit.mos === 'number' ? hit.mos : null,
      quality_score: typeof hit.quality_score === 'number' ? hit.quality_score : null,
      high_conviction: true,
      recommendation_basis: 'screening_matrix',
      score_basis: 'quality_proxy',
      econ_status: econFromSwingHit(hit),
      source_href: '/swing/auto?tier=high_conviction',
      detail: 'Swing Auto high conviction',
      as_of: asOf,
      urgency: 'ok',
    };
  });
}

function swingExitSignals(
  swing: ReturnType<typeof swingPositionsPanel>,
): InboxSignal[] {
  return (swing.urgent ?? []).map((row) => ({
    id: `swing-exit:${row.symbol}`,
    book: 'swing',
    side: 'exit',
    symbol: row.symbol,
    verdict: 'EXIT',
    strict_verdict: 'EXIT',
    detail:
      row.triggers?.length > 0
        ? `Swing exit · ${row.triggers.join(', ')}`
        : 'Swing position triggered EXIT rules',
    source_href: '/positions',
    urgency: 'danger' as const,
  }));
}

function intradayExitSignals(
  intraday: ReturnType<typeof intradayPositionsPanel>,
): InboxSignal[] {
  return (intraday.urgent ?? []).map((row) => ({
    id: `intraday-exit:${row.symbol}:${row.label}`,
    book: 'intraday',
    side: 'exit',
    symbol: row.symbol || row.label,
    verdict: row.action || 'EXIT',
    strict_verdict: row.action || 'EXIT',
    detail: `Intraday · ${row.label} · ${row.action}`,
    source_href: '/intraday/positions',
    urgency: 'danger' as const,
  }));
}

async function screenerRecentSignals(
  userId: string | undefined,
  options: { jobsToScan?: number; rowsPerJob?: number } = {},
): Promise<InboxSignal[]> {
  // Avoid cross-user leakage when called without a session user.
  if (!userId) return [];

  const jobsToScan = Math.min(Math.max(options.jobsToScan ?? 3, 1), 10);
  const rowsPerJob = Math.min(Math.max(options.rowsPerJob ?? 3, 1), 10);

  const jobs = await prisma.job.findMany({
    where: {
      type: JobType.screener,
      status: JobStatus.done,
      ...(userId ? { createdBy: userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: jobsToScan,
    select: { id: true, createdAt: true, input: true, result: true },
  });

  const out: InboxSignal[] = [];

  for (const job of jobs) {
    const input = (job.input ?? {}) as Record<string, unknown>;
    const result = job.result as Record<string, unknown> | null;
    const rows = Array.isArray(result?.rows) ? (result!.rows as Record<string, unknown>[]) : [];
    const preset = input.preset ? String(input.preset) : undefined;
    const universe = input.universe ? String(input.universe) : undefined;

    const href =
      universe && preset
        ? `/screener?universe=${encodeURIComponent(universe)}&preset=${encodeURIComponent(preset)}`
        : universe
          ? `/screener?universe=${encodeURIComponent(universe)}`
          : '/screener';

    const createdIso = job.createdAt.toISOString();

    for (const row of rows.slice(0, rowsPerJob)) {
      const symbol = String(row.symbol ?? '');
      if (!symbol) continue;

      const mos = typeof row.mos === 'number' ? row.mos : null;
      const qualityScore = typeof row.composite_score === 'number' ? row.composite_score : null;
      const verdict = row.recommendation ? String(row.recommendation) : undefined;

      out.push({
        id: `screener:${symbol}:${job.id}`,
        book: 'screener',
        side: 'entry',
        symbol,
        name: row.name ? String(row.name) : undefined,
        verdict,
        strict_verdict: verdict,
        decision_label: verdict,
        decision_score: typeof row.verify_score === 'number' ? row.verify_score : undefined,
        price: typeof row.price === 'number' ? row.price : null,
        mos,
        quality_score: qualityScore,
        recommendation_basis: row.recommendation_basis ? String(row.recommendation_basis) : undefined,
        score_basis: row.score_basis ? String(row.score_basis) : undefined,
        data_quality: row.ta_ready === true ? 'reported' : undefined,
        high_conviction: row.passed === true,
        source_href: href,
        detail: `Screener hit (run ${createdIso})`,
        as_of: createdIso,
        urgency: mos != null ? (mos >= 15 ? 'ok' : 'warn') : 'info',
      });
    }
  }

  // Dedupe by symbol, keeping strongest MOS.
  const bestBySymbol = new Map<string, InboxSignal>();
  for (const s of out) {
    const existing = bestBySymbol.get(s.symbol);
    if (!existing) {
      bestBySymbol.set(s.symbol, s);
      continue;
    }
    if (existing.mos != null && s.mos != null && s.mos > existing.mos) bestBySymbol.set(s.symbol, s);
    else if (existing.mos == null && s.mos != null) bestBySymbol.set(s.symbol, s);
  }

  return [...bestBySymbol.values()];
}

async function verifyHistorySignals(
  userId: string | undefined,
  limit = 10,
): Promise<InboxSignal[]> {
  if (!userId) return [];
  const history = await listVerificationHistory(userId, limit);
  const runs = history.runs ?? [];

  return runs
    .filter((r) => Boolean(r.symbol))
    .map((r) => {
      const mos = typeof r.mos === 'number' ? r.mos : null;
      const mosUrgency: SignalUrgency =
        mos == null ? 'info' : mos >= 15 ? 'ok' : mos >= 0 ? 'warn' : 'danger';

      return {
        id: `verify-history:${r.id}`,
        book: 'verify' as const,
        side: 'review',
        symbol: r.symbol,
        verdict: r.recommendation,
        strict_verdict: r.recommendation,
        decision_label: r.recommendation,
        mos,
        quality_score: typeof r.quality_score === 'number' ? r.quality_score : null,
        recommendation_basis: 'full_verify_matrix',
        score_basis: 'full_scorecard',
        data_quality: 'reported',
        source_href: `/verify/full?symbol=${encodeURIComponent(r.symbol)}`,
        detail: `Recent ${r.mode ?? 'verify'} run`,
        as_of: r.createdAt,
        urgency: mosUrgency,
      };
    });
}

function watchlistReviewSignals(
  items: Array<{ symbol: string; meta: unknown }>,
): InboxSignal[] {
  const signals: InboxSignal[] = [];
  for (const item of items) {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    const reviewDate = String(meta.review_date ?? '');
    if (!reviewDue(reviewDate)) continue;
    signals.push({
      id: `watchlist-review:${item.symbol}`,
      book: 'watchlist',
      side: 'review',
      symbol: item.symbol,
      verdict: String(meta.last_verdict ?? 'Review due'),
      mos: meta.last_mos != null ? Number(meta.last_mos) : null,
      quality_score: meta.last_score != null ? Number(meta.last_score) : null,
      recommendation_basis:
        String(meta.recommendation_basis ?? '') ||
        (meta.verify_mode === 'full' ? 'full_verify_matrix' : 'screening_matrix'),
      score_basis:
        String(meta.score_basis ?? '') ||
        (meta.verify_mode === 'full' ? 'full_scorecard' : 'quality_proxy'),
      source_href: `/verify/full?symbol=${encodeURIComponent(item.symbol)}`,
      detail: reviewDate ? `Review due ${reviewDate}` : 'Thesis review due',
      urgency: 'warn',
    });
  }
  return signals;
}

function sortSignals(signals: InboxSignal[]): InboxSignal[] {
  return [...signals].sort((a, b) => {
    const ua = URGENCY_RANK[a.urgency ?? 'info'];
    const ub = URGENCY_RANK[b.urgency ?? 'info'];
    if (ua !== ub) return ua - ub;
    const scoreA = a.decision_score ?? 0;
    const scoreB = b.decision_score ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.symbol.localeCompare(b.symbol);
  });
}

export async function getSignalsInbox(
  userId: string | undefined,
  options: { live?: boolean; books?: SignalBook[]; limit?: number } = {},
) {
  const live = options.live !== false;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const booksFilter = options.books?.length ? new Set(options.books) : null;

  const [snapshot, swingResult, intradayResult, watchlist, chartPatterns] = await Promise.all([
    getSwingAutoSnapshotDurable(),
    userId ? listSwingPositions(userId, 'open') : Promise.resolve({ positions: [] }),
    userId ? listIntradayPositions(userId, 'open') : Promise.resolve({ positions: [] }),
    userId ? listWatchlist(userId) : Promise.resolve({ watchlist: { items: [] }, summary: { total: 0, due: 0, upcoming: 0 } }),
    getChartPatternsMorningPanel().catch(() => ({
      available: false,
      scan_date: null,
      pattern_count: 0,
      breakout_count: 0,
      confirmed_count: 0,
      forming_count: 0,
      hits: [],
      href: '/patterns',
    })),
  ]);

  const [swingTracked, intradayTracked] = live
    ? await Promise.all([
        refreshOpenPositions(swingResult.positions),
        trackOpenIntradayPositions(intradayResult.positions),
      ])
    : [swingResult.positions, intradayResult.positions];

  const swing = swingPositionsPanel(swingTracked, { live });
  const intraday = intradayPositionsPanel(intradayTracked, { available: true, live });
  const patternSignals: InboxSignal[] = inboxSignalsFromChartPatterns(chartPatterns).map((row) => ({
    ...row,
    recommendation_basis: 'chart_pattern',
    score_basis: 'pattern_confidence',
  }));

  const all: InboxSignal[] = [
    ...swingExitSignals(swing),
    ...intradayExitSignals(intraday),
    ...swingHcSignals(snapshot),
    ...patternSignals,
    ...(await screenerRecentSignals(userId, { jobsToScan: 3, rowsPerJob: 3 })),
    ...(await verifyHistorySignals(userId, 8)),
    ...watchlistReviewSignals(watchlist.watchlist.items),
  ];

  let signals = booksFilter ? all.filter((s) => booksFilter.has(s.book)) : all;
  signals = sortSignals(signals).slice(0, limit);

  return {
    built_at: new Date().toISOString(),
    live,
    summary: {
      total: signals.length,
      exit_count: all.filter((s) => s.side === 'exit').length,
      hc_count: all.filter((s) => s.side === 'entry').length,
      review_count: all.filter((s) => s.side === 'review').length,
      by_book: {
        swing: all.filter((s) => s.book === 'swing').length,
        intraday: all.filter((s) => s.book === 'intraday').length,
        watchlist: all.filter((s) => s.book === 'watchlist').length,
        screener: all.filter((s) => s.book === 'screener').length,
        verify: all.filter((s) => s.book === 'verify').length,
        pattern: all.filter((s) => s.book === 'pattern').length,
      },
    },
    signals,
    disclaimer: DISCLAIMER,
  };
}

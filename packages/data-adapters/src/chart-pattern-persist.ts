import { prisma, type Prisma } from '@sv/db';
import type { ChartPatternResult, DetectedPattern } from '@sv/swing';

export interface PersistChartPatternOptions {
  symbol: string;
  scanDate: string;
  lastBarDate: string;
  barCount: number;
  trigger?: string;
}

export interface ChartPatternDetectionRow {
  pattern_key: string;
  pattern: string;
  kind: string;
  type: string;
  status: string;
  confidence: number;
  timeframe: string;
  start_date: string;
  end_date: string;
  last_bar_date: string;
  support: number | null;
  resistance: number | null;
  breakout: number | null;
  target: number | null;
  stop_loss: number | null;
  volume_confirmed: boolean;
  rsi_confirmed: boolean;
  macd_confirmed: boolean;
  points: Record<string, number | string>;
  detail: string;
}

export interface ChartPatternSnapshotView {
  symbol: string;
  scan_date: string;
  last_bar_date: string;
  bar_count: number;
  pattern_count: number;
  swing_highs: number;
  swing_lows: number;
  mtf: ChartPatternResult['mtf'] | null;
  backtest: ChartPatternResult['backtest'] | null;
  trigger: string;
  patterns: ChartPatternDetectionRow[];
}

/** Map engine output to DB row payloads (pure — unit-testable). */
export function patternDetectionRowsFromResult(
  patterns: DetectedPattern[],
  ctx: { symbol: string; scanDate: string; lastBarDate: string },
): ChartPatternDetectionRow[] {
  return patterns.map((p) => ({
    pattern_key: p.id,
    pattern: p.pattern,
    kind: p.kind,
    type: p.type,
    status: p.status,
    confidence: p.confidence,
    timeframe: p.timeframe,
    start_date: p.start_date,
    end_date: p.end_date,
    last_bar_date: ctx.lastBarDate,
    support: p.support,
    resistance: p.resistance,
    breakout: p.breakout,
    target: p.target,
    stop_loss: p.stop_loss,
    volume_confirmed: p.volume_confirmed,
    rsi_confirmed: Boolean(p.rsi_confirmed),
    macd_confirmed: Boolean(p.macd_confirmed),
    points: p.points,
    detail: p.detail,
  }));
}

function rowToApi(row: {
  patternKey: string;
  pattern: string;
  kind: string;
  type: string;
  status: string;
  confidence: number;
  timeframe: string;
  startDate: string;
  endDate: string;
  lastBarDate: string;
  support: number | null;
  resistance: number | null;
  breakout: number | null;
  target: number | null;
  stopLoss: number | null;
  volumeConfirmed: boolean;
  rsiConfirmed: boolean;
  macdConfirmed: boolean;
  points: unknown;
  detail: string;
}): ChartPatternDetectionRow {
  return {
    pattern_key: row.patternKey,
    pattern: row.pattern,
    kind: row.kind,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    timeframe: row.timeframe,
    start_date: row.startDate,
    end_date: row.endDate,
    last_bar_date: row.lastBarDate,
    support: row.support,
    resistance: row.resistance,
    breakout: row.breakout,
    target: row.target,
    stop_loss: row.stopLoss,
    volume_confirmed: row.volumeConfirmed,
    rsi_confirmed: row.rsiConfirmed,
    macd_confirmed: row.macdConfirmed,
    points: (row.points ?? {}) as Record<string, number | string>,
    detail: row.detail,
  };
}

/** Replace today's snapshot + detections for a symbol (idempotent per scan date). */
export async function persistChartPatternResult(
  result: ChartPatternResult,
  options: PersistChartPatternOptions,
): Promise<{ pattern_count: number }> {
  const symbol = options.symbol.trim().toUpperCase();
  const trigger = options.trigger ?? 'on_demand';
  const rows = patternDetectionRowsFromResult(result.patterns, {
    symbol,
    scanDate: options.scanDate,
    lastBarDate: options.lastBarDate,
  });

  await prisma.$transaction(async (tx) => {
    const existing = await tx.chartPatternSnapshot.findUnique({
      where: { symbol_scanDate: { symbol, scanDate: options.scanDate } },
      select: { id: true },
    });

    if (existing) {
      await tx.chartPatternDetection.deleteMany({ where: { snapshotId: existing.id } });
      await tx.chartPatternSnapshot.update({
        where: { id: existing.id },
        data: {
          lastBarDate: options.lastBarDate,
          barCount: options.barCount,
          patternCount: rows.length,
          swingHighs: result.swing_count.highs,
          swingLows: result.swing_count.lows,
          mtf: (result.mtf ?? undefined) as Prisma.InputJsonValue | undefined,
          backtest: (result.backtest ?? undefined) as Prisma.InputJsonValue | undefined,
          trigger,
        },
      });
      if (rows.length > 0) {
        await tx.chartPatternDetection.createMany({
          data: rows.map((row) => ({
            snapshotId: existing.id,
            symbol,
            scanDate: options.scanDate,
            patternKey: row.pattern_key,
            pattern: row.pattern,
            kind: row.kind,
            type: row.type,
            status: row.status,
            confidence: row.confidence,
            timeframe: row.timeframe,
            startDate: row.start_date,
            endDate: row.end_date,
            lastBarDate: row.last_bar_date,
            support: row.support,
            resistance: row.resistance,
            breakout: row.breakout,
            target: row.target,
            stopLoss: row.stop_loss,
            volumeConfirmed: row.volume_confirmed,
            rsiConfirmed: row.rsi_confirmed,
            macdConfirmed: row.macd_confirmed,
            points: row.points,
            detail: row.detail,
          })),
        });
      }
      return;
    }

    const snapshot = await tx.chartPatternSnapshot.create({
      data: {
        symbol,
        scanDate: options.scanDate,
        lastBarDate: options.lastBarDate,
        barCount: options.barCount,
        patternCount: rows.length,
        swingHighs: result.swing_count.highs,
        swingLows: result.swing_count.lows,
        mtf: (result.mtf ?? undefined) as Prisma.InputJsonValue | undefined,
        backtest: (result.backtest ?? undefined) as Prisma.InputJsonValue | undefined,
        trigger,
      },
    });

    if (rows.length > 0) {
      await tx.chartPatternDetection.createMany({
        data: rows.map((row) => ({
          snapshotId: snapshot.id,
          symbol,
          scanDate: options.scanDate,
          patternKey: row.pattern_key,
          pattern: row.pattern,
          kind: row.kind,
          type: row.type,
          status: row.status,
          confidence: row.confidence,
          timeframe: row.timeframe,
          startDate: row.start_date,
          endDate: row.end_date,
          lastBarDate: row.last_bar_date,
          support: row.support,
          resistance: row.resistance,
          breakout: row.breakout,
          target: row.target,
          stopLoss: row.stop_loss,
          volumeConfirmed: row.volume_confirmed,
          rsiConfirmed: row.rsi_confirmed,
          macdConfirmed: row.macd_confirmed,
          points: row.points,
          detail: row.detail,
        })),
      });
    }
  });

  return { pattern_count: rows.length };
}

export async function getLatestChartPatternSnapshot(
  symbol: string,
  scanDate?: string,
): Promise<ChartPatternSnapshotView | null> {
  const normalized = symbol.trim().toUpperCase();
  const snapshot = scanDate
    ? await prisma.chartPatternSnapshot.findUnique({
        where: { symbol_scanDate: { symbol: normalized, scanDate } },
        include: { detections: { orderBy: { confidence: 'desc' } } },
      })
    : await prisma.chartPatternSnapshot.findFirst({
        where: { symbol: normalized },
        orderBy: { scanDate: 'desc' },
        include: { detections: { orderBy: { confidence: 'desc' } } },
      });

  if (!snapshot) return null;

  return {
    symbol: snapshot.symbol,
    scan_date: snapshot.scanDate,
    last_bar_date: snapshot.lastBarDate,
    bar_count: snapshot.barCount,
    pattern_count: snapshot.patternCount,
    swing_highs: snapshot.swingHighs,
    swing_lows: snapshot.swingLows,
    mtf: (snapshot.mtf as unknown as ChartPatternResult['mtf']) ?? null,
    backtest: (snapshot.backtest as unknown as ChartPatternResult['backtest']) ?? null,
    trigger: snapshot.trigger,
    patterns: snapshot.detections.map(rowToApi),
  };
}

export interface ChartPatternFeedQuery {
  scan_date?: string;
  kind?: string;
  status?: string;
  type?: string;
  symbol?: string;
  min_confidence?: number;
  limit?: number;
}

export async function queryChartPatternFeed(query: ChartPatternFeedQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  let scanDate = query.scan_date;

  if (!scanDate) {
    const latest = await prisma.chartPatternSnapshot.findFirst({
      orderBy: { scanDate: 'desc' },
      select: { scanDate: true },
    });
    scanDate = latest?.scanDate;
  }

  if (!scanDate) {
    return { scan_date: null, count: 0, patterns: [] as ChartPatternDetectionRow[] };
  }

  const rows = await prisma.chartPatternDetection.findMany({
    where: {
      scanDate,
      ...(query.symbol
        ? { symbol: query.symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '') }
        : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.min_confidence != null ? { confidence: { gte: query.min_confidence } } : {}),
    },
    orderBy: [{ confidence: 'desc' }, { symbol: 'asc' }],
    take: limit,
  });

  return {
    scan_date: scanDate,
    count: rows.length,
    patterns: rows.map((row) => ({
      ...rowToApi(row),
      symbol: row.symbol,
    })),
  };
}

export interface ChartPatternsMorningHit {
  symbol: string;
  pattern: string;
  kind: string;
  type: string;
  status: string;
  confidence: number;
  timeframe: string;
}

export interface ChartPatternsMorningPanel {
  available: boolean;
  scan_date: string | null;
  pattern_count: number;
  breakout_count: number;
  confirmed_count: number;
  forming_count: number;
  hits: ChartPatternsMorningHit[];
  href: string;
}

export interface ChartPatternInboxSignal {
  id: string;
  book: 'pattern';
  side: 'entry' | 'review';
  symbol: string;
  verdict: string;
  strict_verdict: string;
  decision_label: string;
  decision_score: number;
  high_conviction: boolean;
  source_href: string;
  detail: string;
  as_of?: string;
  urgency: 'ok' | 'warn' | 'info';
}

/** Map morning-panel hits into Signals inbox rows (pure). */
export function inboxSignalsFromChartPatterns(
  panel: ChartPatternsMorningPanel,
  limit = 12,
): ChartPatternInboxSignal[] {
  if (!panel.available || panel.hits.length === 0) return [];
  const take = Math.min(Math.max(limit, 1), 30);
  return panel.hits.slice(0, take).map((hit) => {
    const actionable = hit.status === 'breakout' || hit.status === 'confirmed';
    const href = `/patterns?symbol=${encodeURIComponent(hit.symbol)}`;
    return {
      id: `pattern:${hit.symbol}:${hit.kind}:${hit.timeframe}`,
      book: 'pattern',
      side: actionable ? 'entry' : 'review',
      symbol: hit.symbol,
      verdict: hit.status.toUpperCase(),
      strict_verdict: hit.status.toUpperCase(),
      decision_label: hit.pattern,
      decision_score: hit.confidence,
      high_conviction: actionable && hit.confidence >= 75,
      source_href: href,
      detail: `${hit.pattern} · ${hit.type} · ${hit.timeframe} · ${hit.confidence}%`,
      as_of: panel.scan_date ?? undefined,
      urgency: hit.status === 'breakout' ? 'ok' : hit.status === 'confirmed' ? 'ok' : 'info',
    };
  });
}

/** Pure summary builder — unit-testable. */
export function buildChartPatternsMorningPanel(input: {
  scan_date: string | null;
  pattern_count: number;
  breakout_count: number;
  confirmed_count: number;
  forming_count: number;
  hits: ChartPatternsMorningHit[];
}): ChartPatternsMorningPanel {
  const available = input.scan_date != null && input.pattern_count > 0;
  return {
    available,
    scan_date: input.scan_date,
    pattern_count: input.pattern_count,
    breakout_count: input.breakout_count,
    confirmed_count: input.confirmed_count,
    forming_count: input.forming_count,
    hits: input.hits,
    href: '/patterns?min_confidence=60',
  };
}

/** Top actionable patterns from the latest daily scan for Morning briefing. */
export async function getChartPatternsMorningPanel(limit = 8): Promise<ChartPatternsMorningPanel> {
  const latest = await prisma.chartPatternSnapshot.findFirst({
    orderBy: { scanDate: 'desc' },
    select: { scanDate: true },
  });
  const scanDate = latest?.scanDate ?? null;
  if (!scanDate) {
    return buildChartPatternsMorningPanel({
      scan_date: null,
      pattern_count: 0,
      breakout_count: 0,
      confirmed_count: 0,
      forming_count: 0,
      hits: [],
    });
  }

  const [counts, hitsRows] = await Promise.all([
    prisma.chartPatternDetection.groupBy({
      by: ['status'],
      where: { scanDate },
      _count: { _all: true },
    }),
    prisma.chartPatternDetection.findMany({
      where: {
        scanDate,
        OR: [{ status: { in: ['breakout', 'confirmed'] } }, { confidence: { gte: 65 } }],
      },
      orderBy: [{ confidence: 'desc' }, { symbol: 'asc' }],
      take: Math.min(Math.max(limit, 1), 20),
      select: {
        symbol: true,
        pattern: true,
        kind: true,
        type: true,
        status: true,
        confidence: true,
        timeframe: true,
      },
    }),
  ]);

  let pattern_count = 0;
  let breakout_count = 0;
  let confirmed_count = 0;
  let forming_count = 0;
  for (const row of counts) {
    const n = row._count._all;
    pattern_count += n;
    if (row.status === 'breakout') breakout_count = n;
    else if (row.status === 'confirmed') confirmed_count = n;
    else if (row.status === 'forming') forming_count = n;
  }

  return buildChartPatternsMorningPanel({
    scan_date: scanDate,
    pattern_count,
    breakout_count,
    confirmed_count,
    forming_count,
    hits: hitsRows.map((row) => ({
      symbol: row.symbol,
      pattern: row.pattern,
      kind: row.kind,
      type: row.type,
      status: row.status,
      confidence: row.confidence,
      timeframe: row.timeframe,
    })),
  });
}

export interface ChartPatternScanRunView {
  run_date: string;
  trigger: string;
  symbols_total: number;
  symbols_ok: number;
  symbols_failed: number;
  patterns_found: number;
  duration_ms: number;
  status: string;
  error: string | null;
  created_at: string;
}

/** Map DB scan run row to API shape (pure — unit-testable). */
export function scanRunToApi(row: {
  runDate: string;
  trigger: string;
  symbolsTotal: number;
  symbolsOk: number;
  symbolsFailed: number;
  patternsFound: number;
  durationMs: number;
  status: string;
  error: string | null;
  createdAt: Date;
}): ChartPatternScanRunView {
  return {
    run_date: row.runDate,
    trigger: row.trigger,
    symbols_total: row.symbolsTotal,
    symbols_ok: row.symbolsOk,
    symbols_failed: row.symbolsFailed,
    patterns_found: row.patternsFound,
    duration_ms: row.durationMs,
    status: row.status,
    error: row.error,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listChartPatternScanRuns(limit = 10): Promise<ChartPatternScanRunView[]> {
  const take = Math.min(Math.max(limit, 1), 50);
  const rows = await prisma.chartPatternScanRun.findMany({
    orderBy: [{ runDate: 'desc' }, { createdAt: 'desc' }],
    take,
  });
  return rows.map(scanRunToApi);
}

export async function listChartPatternScanDates(limit = 30): Promise<string[]> {
  const take = Math.min(Math.max(limit, 1), 90);
  const rows = await prisma.chartPatternSnapshot.findMany({
    distinct: ['scanDate'],
    orderBy: { scanDate: 'desc' },
    take,
    select: { scanDate: true },
  });
  return rows.map((r) => r.scanDate);
}

export async function recordChartPatternScanRun(data: {
  runDate: string;
  trigger?: string;
  symbolsTotal: number;
  symbolsOk: number;
  symbolsFailed: number;
  patternsFound: number;
  durationMs: number;
  status?: string;
  error?: string;
}) {
  const trigger = data.trigger ?? 'daily_sync';
  return prisma.chartPatternScanRun.upsert({
    where: { runDate_trigger: { runDate: data.runDate, trigger } },
    create: {
      runDate: data.runDate,
      trigger,
      symbolsTotal: data.symbolsTotal,
      symbolsOk: data.symbolsOk,
      symbolsFailed: data.symbolsFailed,
      patternsFound: data.patternsFound,
      durationMs: data.durationMs,
      status: data.status ?? 'done',
      error: data.error,
    },
    update: {
      symbolsTotal: data.symbolsTotal,
      symbolsOk: data.symbolsOk,
      symbolsFailed: data.symbolsFailed,
      patternsFound: data.patternsFound,
      durationMs: data.durationMs,
      status: data.status ?? 'done',
      error: data.error,
    },
  });
}

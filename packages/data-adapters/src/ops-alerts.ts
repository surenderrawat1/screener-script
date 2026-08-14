import { hasActiveWorker } from '@sv/cache';
import { PaperOrderStatus, PaperPositionStatus, prisma } from '@sv/db';
import {
  evaluateOpsAlerts,
  nseSession,
  summarizeOpsAlerts,
  type OpsAlert,
  OPS_PRICE_GAP_PCT,
} from '@sv/shared';
import { PAPER_SOURCE } from '@sv/intraday';
import { getSwingAutoSnapshotDurable } from './auto-swing-scan.js';
import { getEveningGttDigest } from './evening-gtt-signals.js';
import { hasStrategyDailyProofToday } from './strategy-daily-proof.js';
import { liveQuoteForSymbol } from './live-quote.js';

const SWING_PAPER_SOURCE = 'swing_paper_auto';
const SWING_PAPER_ARM_PREFIX = 'swing_paper_auto:';

async function isSwingPaperArmed(userId: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { key: `${SWING_PAPER_ARM_PREFIX}${userId}` },
  });
  return row?.value === true;
}

function gapPct(live: number, reference: number): number {
  if (reference <= 0 || live <= 0) return 0;
  return Math.round(((live - reference) / reference) * 1000) / 10;
}

/**
 * Collect CFA live-money ops alerts for the dashboard / paper panels.
 */
export async function collectOpsAlerts(userId: string): Promise<{
  ok: boolean;
  alerts: OpsAlert[];
  summary: ReturnType<typeof summarizeOpsAlerts>;
  nse: ReturnType<typeof nseSession>;
  checked_at: string;
}> {
  const nse = nseSession();
  const workerOk = await hasActiveWorker();
  const snapshot = await getSwingAutoSnapshotDurable().catch(() => null);

  const wallet = await prisma.paperWallet.findUnique({
    where: { userId_currency: { userId, currency: 'INR' } },
  });
  const swingArmed = await isSwingPaperArmed(userId).catch(() => false);
  const intradayArmed = Boolean(wallet?.autoArmed);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rejected = await prisma.paperOrder.findMany({
    where: {
      userId,
      status: PaperOrderStatus.rejected,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const openPositions = await prisma.paperPosition.findMany({
    where: { userId, status: PaperPositionStatus.open },
    take: 20,
  });

  const priceGaps: Array<{
    symbol: string;
    gap_pct: number;
    live: number;
    reference: number;
    reference_label?: string;
  }> = [];

  if (nse.live_quotes) {
    for (const pos of openPositions) {
      const live = await liveQuoteForSymbol(pos.symbol, false).catch(() => null);
      if (!live || live <= 0) continue;
      const evidence = (pos.evidence as Record<string, unknown> | null) ?? {};
      const last = Number(evidence.last_price ?? 0);
      const reference = last > 0 ? last : pos.entryPrice;
      const label = last > 0 ? 'last evaluated' : 'entry';
      const gap = gapPct(live, reference);
      if (Math.abs(gap) >= OPS_PRICE_GAP_PCT) {
        priceGaps.push({
          symbol: pos.symbol,
          gap_pct: gap,
          live: Math.round(live * 100) / 100,
          reference: Math.round(reference * 100) / 100,
          reference_label: label,
        });
      }
    }
  }

  // Prefer Swing paper last tick from wallet when swing positions exist; wallet.lastTickAt is shared.
  const swingTickAt =
    openPositions.some((p) => p.source === SWING_PAPER_SOURCE) || swingArmed
      ? wallet?.lastTickAt?.toISOString() ?? null
      : wallet?.lastTickAt?.toISOString() ?? null;
  const intradayTickAt =
    openPositions.some((p) => p.source === PAPER_SOURCE) || intradayArmed
      ? wallet?.lastTickAt?.toISOString() ?? null
      : null;

  const alerts = evaluateOpsAlerts({
    nse,
    worker_ok: workerOk,
    swing_snapshot_at: snapshot?.saved_at ?? null,
    swing_paper_armed: swingArmed,
    swing_paper_last_tick_at: swingTickAt,
    intraday_paper_armed: intradayArmed,
    intraday_paper_last_tick_at: intradayTickAt,
    rejected_orders_24h: rejected.length,
    rejected_order_samples: rejected.map(
      (o) => `${o.symbol}: ${o.rejectReason || o.status}`,
    ),
    price_gaps: priceGaps,
  });

  // Post-close schedule health (weekday only) — evening GTT + strategy daily proof.
  if (nse.phase === 'post') {
    const [hh, mm] = nse.ist_time.split(':').map((x) => Number(x));
    const mins = hh * 60 + mm;
    const at = new Date().toISOString();
    if (mins >= 16 * 60 + 30) {
      const digest = await getEveningGttDigest(nse.ist_date).catch(() => null);
      if (!digest) {
        alerts.push({
          id: 'evening_gtt_missing',
          severity: 'warn',
          category: 'worker',
          title: 'Evening GTT digest missing',
          detail: `No evening_gtt:${nse.ist_date} after 16:30 IST — check worker schedule leader.`,
          at,
        });
      }
    }
    if (mins >= 17 * 60) {
      const proofDone = await hasStrategyDailyProofToday().catch(() => false);
      if (!proofDone) {
        alerts.push({
          id: 'strategy_daily_proof_missing',
          severity: 'warn',
          category: 'worker',
          title: 'Strategy daily proof missing',
          detail: `No strategy daily proof for ${nse.ist_date} after 17:00 IST — check worker / cron.`,
          at,
        });
      }
    }
  }

  return {
    ok: true,
    alerts,
    summary: summarizeOpsAlerts(alerts),
    nse,
    checked_at: new Date().toISOString(),
  };
}

/** CFA ops alerts — stale quotes, worker downtime, rejected writes, abnormal gaps. */

import { NSE_PHASE, type NseSession } from './nse-session.js';

export type OpsAlertSeverity = 'info' | 'warn' | 'critical';
export type OpsAlertCategory =
  | 'worker'
  | 'stale_quote'
  | 'rejected_write'
  | 'price_gap'
  | 'paper';

export interface OpsAlert {
  id: string;
  severity: OpsAlertSeverity;
  category: OpsAlertCategory;
  title: string;
  detail: string;
  at: string;
}

/** Snapshot / quote older than this during open session → stale. */
export const OPS_STALE_SNAPSHOT_SEC = 15 * 60;
/** Armed paper with no tick for this long during open → warn. */
export const OPS_PAPER_TICK_STALE_SEC = 3 * 60;
/** Live vs reference move beyond this % → abnormal gap. */
export const OPS_PRICE_GAP_PCT = 5;
/** Critical gap threshold. */
export const OPS_PRICE_GAP_CRITICAL_PCT = 8;

export interface OpsAlertsInput {
  now?: Date | string;
  nse: Pick<NseSession, 'phase' | 'label' | 'live_quotes'>;
  worker_ok: boolean;
  swing_snapshot_at?: string | null;
  swing_paper_armed?: boolean;
  swing_paper_last_tick_at?: string | null;
  intraday_paper_armed?: boolean;
  intraday_paper_last_tick_at?: string | null;
  rejected_orders_24h?: number;
  rejected_order_samples?: string[];
  price_gaps?: Array<{
    symbol: string;
    gap_pct: number;
    live: number;
    reference: number;
    reference_label?: string;
  }>;
}

function ageSec(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

/**
 * Pure evaluator — no I/O. Session-sensitive thresholds apply only while NSE is open.
 */
export function evaluateOpsAlerts(input: OpsAlertsInput): OpsAlert[] {
  const now = input.now ? new Date(input.now) : new Date();
  const nowMs = now.getTime();
  const at = now.toISOString();
  const open = input.nse.phase === NSE_PHASE.OPEN;
  const alerts: OpsAlert[] = [];

  if (!input.worker_ok) {
    alerts.push({
      id: 'worker_down',
      severity: open ? 'critical' : 'warn',
      category: 'worker',
      title: 'Worker heartbeat missing',
      detail: open
        ? 'No active worker during NSE cash session — paper ticks and auto scans will stall.'
        : 'No worker heartbeat. Start `pnpm dev:all` / worker before the next session.',
      at,
    });
  }

  if (open) {
    const snapAge = ageSec(input.swing_snapshot_at, nowMs);
    if (snapAge == null) {
      alerts.push({
        id: 'swing_snapshot_missing',
        severity: 'warn',
        category: 'stale_quote',
        title: 'Swing Auto snapshot missing',
        detail: 'No durable radar snapshot — run a full Swing Auto scan.',
        at,
      });
    } else if (snapAge > OPS_STALE_SNAPSHOT_SEC) {
      alerts.push({
        id: 'swing_snapshot_stale',
        severity: input.swing_paper_armed ? 'critical' : 'warn',
        category: 'stale_quote',
        title: 'Swing Auto snapshot stale',
        detail: `Last snapshot ${fmtAge(snapAge)} ago (limit ${OPS_STALE_SNAPSHOT_SEC / 60}m). Live paper entries require a fresh radar.`,
        at,
      });
    }

    if (input.swing_paper_armed) {
      const tickAge = ageSec(input.swing_paper_last_tick_at, nowMs);
      if (tickAge == null || tickAge > OPS_PAPER_TICK_STALE_SEC) {
        alerts.push({
          id: 'swing_paper_tick_stale',
          severity: 'warn',
          category: 'paper',
          title: 'Swing paper tick stale',
          detail:
            tickAge == null
              ? 'Swing paper is armed but has never ticked — check worker.'
              : `Last Swing paper tick ${fmtAge(tickAge)} ago (limit ${OPS_PAPER_TICK_STALE_SEC / 60}m).`,
          at,
        });
      }
    }

    if (input.intraday_paper_armed) {
      const tickAge = ageSec(input.intraday_paper_last_tick_at, nowMs);
      if (tickAge == null || tickAge > OPS_PAPER_TICK_STALE_SEC) {
        alerts.push({
          id: 'intraday_paper_tick_stale',
          severity: 'warn',
          category: 'paper',
          title: 'Intraday paper tick stale',
          detail:
            tickAge == null
              ? 'Intraday paper is armed but has never ticked — check worker.'
              : `Last intraday paper tick ${fmtAge(tickAge)} ago (limit ${OPS_PAPER_TICK_STALE_SEC / 60}m).`,
          at,
        });
      }
    }
  }

  const rejects = Math.max(0, Number(input.rejected_orders_24h ?? 0));
  if (rejects > 0) {
    const samples = (input.rejected_order_samples ?? []).slice(0, 3).join(' · ');
    alerts.push({
      id: 'paper_rejects',
      severity: rejects >= 5 ? 'critical' : 'warn',
      category: 'rejected_write',
      title: `${rejects} rejected paper order(s) (24h)`,
      detail: samples || 'Inspect paper orders for gate / cash / idempotency rejects.',
      at,
    });
  }

  for (const gap of input.price_gaps ?? []) {
    const abs = Math.abs(Number(gap.gap_pct) || 0);
    if (abs < OPS_PRICE_GAP_PCT) continue;
    const severity: OpsAlertSeverity = abs >= OPS_PRICE_GAP_CRITICAL_PCT ? 'critical' : 'warn';
    alerts.push({
      id: `price_gap:${gap.symbol}`,
      severity,
      category: 'price_gap',
      title: `${gap.symbol} abnormal price gap ${abs.toFixed(1)}%`,
      detail: `Live ₹${gap.live} vs ${gap.reference_label ?? 'reference'} ₹${gap.reference}. Verify quote quality before acting.`,
      at,
    });
  }

  const rank = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}

export function summarizeOpsAlerts(alerts: OpsAlert[]) {
  return {
    count: alerts.length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
    warn: alerts.filter((a) => a.severity === 'warn').length,
    info: alerts.filter((a) => a.severity === 'info').length,
    ok: alerts.every((a) => a.severity === 'info') || alerts.length === 0,
  };
}

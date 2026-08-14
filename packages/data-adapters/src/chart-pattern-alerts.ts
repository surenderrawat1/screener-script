/**
 * Email + WhatsApp digest for chart-pattern breakouts after daily / admin scan.
 */
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, dateKeyInTimezone, getAlertsConfig, getConfigTimezone } from '@sv/shared';
import {
  getChartPatternsMorningPanel,
  type ChartPatternsMorningHit,
  type ChartPatternsMorningPanel,
} from './chart-pattern-persist.js';
import {
  isSignalEmailConfigured,
  notifyTradeSignalEmails,
  type TradeSignalAlert,
} from './signal-alerts.js';
import {
  formatPatternAlertsWhatsAppMessage,
  isWhatsAppFeatureEnabled,
  sendWhatsAppText,
} from './whatsapp-alerts.js';

const LAST_KEY = 'pattern-alerts:last';

export interface ChartPatternAlertBatchResult {
  ok: boolean;
  date_key: string;
  pattern_count: number;
  emails_sent: number;
  whatsapp_sent: boolean;
  skipped?: boolean;
  reason?: string;
}

/** Map morning-panel hits to email/WhatsApp alert rows (pure). */
export function alertsFromChartPatternHits(
  hits: ChartPatternsMorningHit[],
  scanDate: string | null,
  limit = 15,
): TradeSignalAlert[] {
  const take = Math.min(Math.max(limit, 1), 30);
  return hits
    .filter((h) => h.status === 'breakout' || h.status === 'confirmed')
    .slice(0, take)
    .map((hit) => ({
      id: `pattern:${scanDate ?? 'latest'}:${hit.symbol}:${hit.kind}:${hit.status}`,
      book: 'pattern' as const,
      side: 'entry' as const,
      symbol: hit.symbol,
      name: hit.symbol,
      action: hit.status.toUpperCase(),
      action_label: hit.pattern,
      timeframe: hit.timeframe,
      side_bias: hit.type,
      detail: [
        'Chart pattern scan',
        hit.pattern,
        hit.type,
        hit.timeframe,
        `${hit.confidence}%`,
      ].join(' · '),
    }));
}

export async function dispatchChartPatternAlerts(
  options: { force?: boolean; userId?: string; panel?: ChartPatternsMorningPanel } = {},
): Promise<ChartPatternAlertBatchResult> {
  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const emailOn = getAlertsConfig().email?.pattern_alerts !== false;
  const waOn = isWhatsAppFeatureEnabled('pattern_alerts');

  if (!emailOn && !waOn) {
    return {
      ok: true,
      date_key: dayKey,
      pattern_count: 0,
      emails_sent: 0,
      whatsapp_sent: false,
      skipped: true,
      reason: 'pattern_alerts disabled in alerts.yaml',
    };
  }

  const dedupeKey = cacheKey(CACHE_PREFIX.MORNING, LAST_KEY);
  if (!options.force) {
    const last = await cacheGetJson<{ date_key?: string; status?: string }>(dedupeKey);
    if (last?.date_key === dayKey && last.status === 'done') {
      return {
        ok: true,
        date_key: dayKey,
        pattern_count: 0,
        emails_sent: 0,
        whatsapp_sent: false,
        skipped: true,
        reason: 'Already sent today',
      };
    }
  }

  const panel = options.panel ?? (await getChartPatternsMorningPanel(15));
  const alerts = alertsFromChartPatternHits(panel.hits, panel.scan_date ?? dayKey);
  if (alerts.length === 0) {
    return {
      ok: true,
      date_key: panel.scan_date ?? dayKey,
      pattern_count: 0,
      emails_sent: 0,
      whatsapp_sent: false,
      skipped: true,
      reason: 'No breakout/confirmed patterns',
    };
  }

  let emailsSent = 0;
  if (emailOn && isSignalEmailConfigured()) {
    const sent = await notifyTradeSignalEmails(options.userId, alerts);
    if (sent) emailsSent = 1;
  }

  let whatsappSent = false;
  if (waOn) {
    const text = formatPatternAlertsWhatsAppMessage({
      date_key: panel.scan_date ?? dayKey,
      count: alerts.length,
      alerts: alerts.map((a) => ({
        symbol: a.symbol,
        action: a.action,
        pattern: a.action_label,
        detail: a.detail,
      })),
    });
    const wa = await sendWhatsAppText(text, { dedupeKey: `pattern-alerts:${panel.scan_date ?? dayKey}` });
    whatsappSent = wa.sent;
  }

  await cacheSetJson(dedupeKey, { date_key: dayKey, status: 'done' }, 20 * 3600);

  return {
    ok: emailsSent > 0 || whatsappSent || alerts.length > 0,
    date_key: panel.scan_date ?? dayKey,
    pattern_count: alerts.length,
    emails_sent: emailsSent,
    whatsapp_sent: whatsappSent,
  };
}

/**
 * Automatic swing radar alerts — High Conviction (HOT) tier hits from Swing Auto.
 * Email: all HC hits (deduped once/symbol/IST day).
 * Webhook: only newly added HC symbols vs the previous snapshot.
 * Fires after each snapshot save (worker auto-scan + manual force scan).
 */
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import { CACHE_PREFIX, dateKeyInTimezone, getAlertsConfig, getConfigTimezone } from '@sv/shared';
import type { SwingAutoSnapshot } from '@sv/swing';
import {
  isSignalEmailConfigured,
  notifyTradeSignalEmails,
  type TradeSignalAlert,
} from './signal-alerts.js';
import { SWING_PAPER_ARM_PREFIX } from './swing-paper-trader.js';
import {
  formatHotTierWhatsAppMessage,
  isWhatsAppConfigured,
  isWhatsAppFeatureEnabled,
  sendWhatsAppText,
} from './whatsapp-alerts.js';

function fmt(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `₹${Math.round(n * 100) / 100}`;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Build one email alert per High Conviction radar hit. */
export function alertsFromSwingRadarHits(
  hits: Array<Record<string, unknown>>,
  options: { dayKey?: string; regimeLabel?: string | null } = {},
): TradeSignalAlert[] {
  const dayKey = options.dayKey ?? dateKeyInTimezone(getConfigTimezone());
  const regime = options.regimeLabel?.trim() || null;
  const out: TradeSignalAlert[] = [];

  for (const hit of hits) {
    const symbol = String(hit.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!symbol) continue;

    const price = num(hit.price) ?? num(hit.ta_price);
    const stop = num(hit.stop_loss);
    const target = num(hit.profit_target);
    const rMult = num(hit.r_multiple);
    const score = num(hit.decision_score);
    const action = String(hit.decision_action ?? 'BUY');
    const name = String(hit.company_name ?? hit.name ?? symbol).trim() || symbol;
    const truth = (hit.backtest_truth as Record<string, unknown> | undefined) ?? undefined;
    const wr = truth ? num(truth.win_rate_pct) : num(hit.bt_win_rate_pct);
    const expectancy = truth ? num(truth.expectancy_r) : null;
    const pf = truth ? num(truth.profit_factor) : null;

    const parts = [
      'Swing Auto · High Conviction',
      action,
      score != null ? `score ${score}` : null,
      rMult != null ? `R ${rMult}` : null,
      price != null ? `entry ~${fmt(price)}` : null,
      stop != null ? `stop ${fmt(stop)}` : null,
      target != null ? `target ${fmt(target)}` : null,
      wr != null ? `BT WR ${wr}%` : null,
      expectancy != null ? `E ${expectancy}R` : null,
      pf != null ? `PF ${pf}` : null,
      regime ? `regime ${regime}` : null,
    ].filter(Boolean);

    out.push({
      id: `swing-radar:${dayKey}:${symbol}`,
      book: 'swing',
      side: 'entry',
      symbol,
      name,
      action: 'HIGH_CONVICTION',
      price,
      side_bias: 'long',
      timeframe: '1D',
      entry_price: price,
      stop_loss: stop,
      target_t3: target,
      detail: parts.join(' · '),
      action_label: String(hit.decision_label ?? hit.strict_verdict ?? 'High Conviction'),
    });
  }
  return out;
}

function symbolFromHit(hit: Record<string, unknown>): string {
  return String(hit.symbol ?? '')
    .trim()
    .toUpperCase();
}

function hcHitsFromSnapshot(snapshot: SwingAutoSnapshot | null | undefined): Record<string, unknown>[] {
  if (!snapshot?.tiers || !Array.isArray(snapshot.tiers.high_conviction)) return [];
  return snapshot.tiers.high_conviction as Record<string, unknown>[];
}

/** Newly added High Conviction symbols vs previous snapshot (HOT tier additions). */
export function highConvictionAdditions(
  current: SwingAutoSnapshot,
  previous: SwingAutoSnapshot | null | undefined,
): Record<string, unknown>[] {
  const currentHits = hcHitsFromSnapshot(current);
  if (!previous) return currentHits;
  const prev = new Set(hcHitsFromSnapshot(previous).map(symbolFromHit).filter(Boolean));
  return currentHits.filter((hit) => {
    const symbol = symbolFromHit(hit);
    return Boolean(symbol) && !prev.has(symbol);
  });
}

function resolveRadarWebhookUrl(): string | null {
  const dedicated = process.env.SWING_RADAR_WEBHOOK_URL?.trim();
  if (dedicated) return dedicated;
  return process.env.MORNING_ALERT_WEBHOOK_URL?.trim() || null;
}

/**
 * POST newly added High Conviction symbols to Slack/Discord-style webhook.
 * Deduped once per symbol set per IST day.
 */
export async function dispatchSwingRadarWebhook(
  addedHits: Record<string, unknown>[],
  options: { regimeLabel?: string | null } = {},
): Promise<{ sent: boolean; added: number; reason?: string }> {
  const url = resolveRadarWebhookUrl();
  if (!url) {
    return { sent: false, added: addedHits.length, reason: 'Webhook URL not configured' };
  }
  if (process.env.SWING_RADAR_WEBHOOK === '0' || process.env.SWING_RADAR_WEBHOOK === 'false') {
    return { sent: false, added: addedHits.length, reason: 'SWING_RADAR_WEBHOOK disabled' };
  }

  const symbols = addedHits.map(symbolFromHit).filter(Boolean).sort();
  if (symbols.length === 0) {
    return { sent: false, added: 0, reason: 'No High Conviction additions' };
  }

  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const dedupeKey = cacheKey(CACHE_PREFIX.SWING_AUTO, `radar-webhook:${dayKey}:${symbols.join(',')}`);
  const alreadySent = await cacheGetJson(dedupeKey);
  if (alreadySent) {
    return { sent: false, added: symbols.length, reason: 'Already sent today' };
  }

  const regime = options.regimeLabel?.trim() || null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'swing-auto-radar',
        tier: 'high_conviction',
        event: 'hot_tier_additions',
        added: symbols,
        count: symbols.length,
        regime,
        hits: addedHits.map((hit) => ({
          symbol: symbolFromHit(hit),
          price: hit.price ?? hit.ta_price ?? null,
          decision_action: hit.decision_action ?? null,
          decision_score: hit.decision_score ?? null,
          stop_loss: hit.stop_loss ?? null,
          profit_target: hit.profit_target ?? null,
          r_multiple: hit.r_multiple ?? null,
        })),
        href: '/swing/auto?tier=high_conviction',
        sent_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      return { sent: false, added: symbols.length, reason: `Webhook HTTP ${res.status}` };
    }
    await cacheSetJson(dedupeKey, { sent_at: new Date().toISOString(), symbols }, 86400);
    return { sent: true, added: symbols.length };
  } catch (err) {
    return {
      sent: false,
      added: symbols.length,
      reason: err instanceof Error ? err.message : 'Webhook failed',
    };
  }
}

async function resolveRadarRecipients(): Promise<string[]> {
  if (process.env.SIGNAL_ALERT_EMAIL_TO?.trim()) {
    // Override: one mailbox for all radar signals.
    return ['__override__'];
  }
  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: SWING_PAPER_ARM_PREFIX } },
  });
  return settings
    .filter((s) => s.value === true)
    .map((s) => s.key.slice(SWING_PAPER_ARM_PREFIX.length))
    .filter(Boolean);
}

/**
 * Email High Conviction swing signals after an Auto radar snapshot save.
 * Deduped once per symbol per IST day via notifyTradeSignalEmails.
 */
export async function dispatchSwingRadarEmails(
  snapshot: SwingAutoSnapshot,
): Promise<{ sent: boolean; signals: number; reason?: string }> {
  if (!isSignalEmailConfigured()) {
    return { sent: false, signals: 0, reason: 'SMTP not configured' };
  }
  if (process.env.SWING_RADAR_EMAIL === '0' || process.env.SWING_RADAR_EMAIL === 'false') {
    return { sent: false, signals: 0, reason: 'SWING_RADAR_EMAIL disabled' };
  }
  if (getAlertsConfig().email?.swing_radar === false) {
    return { sent: false, signals: 0, reason: 'alerts.yaml email.swing_radar=false' };
  }

  const hc = hcHitsFromSnapshot(snapshot);
  const regime = (snapshot.scan?.regime as Record<string, unknown> | undefined) ?? null;
  const alerts = alertsFromSwingRadarHits(hc, {
    regimeLabel: String(regime?.label ?? regime?.key ?? '') || null,
  });
  if (alerts.length === 0) {
    return { sent: false, signals: 0, reason: 'No High Conviction hits' };
  }

  const recipients = await resolveRadarRecipients();
  if (recipients.length === 0) {
    return {
      sent: false,
      signals: alerts.length,
      reason: 'No SIGNAL_ALERT_EMAIL_TO and no swing-paper-armed users',
    };
  }

  let sentAny = false;
  for (const recipient of recipients) {
    const userId = recipient === '__override__' ? undefined : recipient;
    const ok = await notifyTradeSignalEmails(userId, alerts);
    if (ok) sentAny = true;
    // With override, one send is enough.
    if (recipient === '__override__') break;
  }

  return { sent: sentAny, signals: alerts.length };
}

/**
 * Email + webhook + WhatsApp for High Conviction (HOT) tier after a snapshot save.
 * Webhook/WhatsApp fire only for newly added symbols vs the previous snapshot.
 */
export async function dispatchSwingRadarAlerts(
  snapshot: SwingAutoSnapshot,
  previous?: SwingAutoSnapshot | null,
): Promise<{
  email: { sent: boolean; signals: number; reason?: string };
  webhook: { sent: boolean; added: number; reason?: string };
  whatsapp: { sent: boolean; added: number; reason?: string };
}> {
  const regime = (snapshot.scan?.regime as Record<string, unknown> | undefined) ?? null;
  const regimeLabel = String(regime?.label ?? regime?.key ?? '') || null;
  const added = highConvictionAdditions(snapshot, previous);

  const [email, webhook, whatsapp] = await Promise.all([
    dispatchSwingRadarEmails(snapshot),
    dispatchSwingRadarWebhook(added, { regimeLabel }),
    dispatchSwingRadarWhatsApp(added, { regimeLabel }),
  ]);

  return { email, webhook, whatsapp };
}

/**
 * WhatsApp for newly added High Conviction symbols (Meta Cloud API or CallMeBot).
 */
export async function dispatchSwingRadarWhatsApp(
  addedHits: Record<string, unknown>[],
  options: { regimeLabel?: string | null } = {},
): Promise<{ sent: boolean; added: number; reason?: string }> {
  if (!isWhatsAppFeatureEnabled('swing_radar')) {
    return {
      sent: false,
      added: addedHits.length,
      reason: isWhatsAppConfigured()
        ? 'alerts.yaml whatsapp.swing_radar=false'
        : 'WhatsApp not configured',
    };
  }

  const symbols = addedHits.map(symbolFromHit).filter(Boolean).sort();
  if (symbols.length === 0) {
    return { sent: false, added: 0, reason: 'No High Conviction additions' };
  }

  const text = formatHotTierWhatsAppMessage({
    symbols,
    regime: options.regimeLabel,
    hits: addedHits.map((hit) => ({
      symbol: symbolFromHit(hit),
      price: hit.price ?? hit.ta_price,
      decision_action: hit.decision_action,
      decision_score: hit.decision_score,
      stop_loss: hit.stop_loss,
      profit_target: hit.profit_target,
      r_multiple: hit.r_multiple,
    })),
  });

  const result = await sendWhatsAppText(text, {
    dedupeKey: `radar-wa:${symbols.join(',')}`,
  });

  return {
    sent: result.sent,
    added: symbols.length,
    reason: result.reason,
  };
}

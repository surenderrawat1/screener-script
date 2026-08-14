/**
 * WhatsApp alert delivery for swing radar / evening GTT / exit alerts.
 *
 * Configure one of (first match wins):
 * 1) Twilio WhatsApp — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + WHATSAPP_TO
 *    Optional: TWILIO_WHATSAPP_FROM (default sandbox: whatsapp:+14155238886)
 * 2) CallMeBot (personal) — WHATSAPP_CALLMEBOT_APIKEY + WHATSAPP_TO
 * 3) Meta Cloud API — WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TO
 *
 * Disable with WHATSAPP_ALERTS=0.
 * Per-feature toggles: config/alerts.yaml → whatsapp.* (Admin Features UI).
 * Setup guide: docs/WHATSAPP-ALERTS.md
 */
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import {
  CACHE_PREFIX,
  dateKeyInTimezone,
  getAlertsConfig,
  getConfigTimezone,
} from '@sv/shared';

export type WhatsAppProvider = 'twilio' | 'callmebot' | 'meta' | null;
export type WhatsAppFeature = 'swing_radar' | 'evening_gtt' | 'exit_alerts' | 'pattern_alerts';

export function resolveWhatsAppProvider(): WhatsAppProvider {
  if (process.env.WHATSAPP_ALERTS === '0' || process.env.WHATSAPP_ALERTS === 'false') {
    return null;
  }
  const to = process.env.WHATSAPP_TO?.trim();
  if (!to) return null;

  if (process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim()) {
    return 'twilio';
  }
  if (process.env.WHATSAPP_CALLMEBOT_APIKEY?.trim()) return 'callmebot';
  if (process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()) {
    return 'meta';
  }
  return null;
}

export function isWhatsAppConfigured(): boolean {
  return resolveWhatsAppProvider() !== null;
}

/** Product flag from alerts.yaml / Admin (env hard-off still wins via resolveWhatsAppProvider). */
export function isWhatsAppFeatureEnabled(feature: WhatsAppFeature): boolean {
  if (!isWhatsAppConfigured()) return false;
  const flags = getAlertsConfig().whatsapp;
  if (!flags) return true;
  return flags[feature] !== false;
}

export function getWhatsAppStatus(): {
  configured: boolean;
  provider: WhatsAppProvider;
  to_masked: string | null;
  features: Record<WhatsAppFeature, boolean>;
  env_hard_off: boolean;
} {
  const envHardOff =
    process.env.WHATSAPP_ALERTS === '0' || process.env.WHATSAPP_ALERTS === 'false';
  const provider = resolveWhatsAppProvider();
  const toRaw = process.env.WHATSAPP_TO?.trim() ?? '';
  const digits = normalizeWhatsAppTo(toRaw);
  const toMasked =
    digits.length >= 4 ? `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : null;
  const flags = getAlertsConfig().whatsapp ?? {};
  return {
    configured: provider !== null,
    provider,
    to_masked: toMasked,
    features: {
      swing_radar: flags.swing_radar !== false,
      evening_gtt: flags.evening_gtt !== false,
      exit_alerts: flags.exit_alerts !== false,
      pattern_alerts: flags.pattern_alerts !== false,
    },
    env_hard_off: envHardOff,
  };
}

/** Normalize to digits only (E.164 without +). */
export function normalizeWhatsAppTo(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

export function formatHotTierWhatsAppMessage(input: {
  symbols: string[];
  regime?: string | null;
  hits?: Array<{
    symbol: string;
    price?: unknown;
    decision_action?: unknown;
    decision_score?: unknown;
    stop_loss?: unknown;
    profit_target?: unknown;
    r_multiple?: unknown;
  }>;
}): string {
  const lines = [
    '🟢 Script Screener · HOT tier',
    `New High Conviction: ${input.symbols.join(', ')}`,
  ];
  if (input.regime) lines.push(`Regime: ${input.regime}`);

  for (const hit of input.hits ?? []) {
    const bits = [
      hit.symbol,
      hit.decision_action != null ? String(hit.decision_action) : null,
      hit.decision_score != null ? `score ${hit.decision_score}` : null,
      hit.price != null ? `~₹${hit.price}` : null,
      hit.stop_loss != null ? `SL ${hit.stop_loss}` : null,
      hit.profit_target != null ? `TGT ${hit.profit_target}` : null,
      hit.r_multiple != null ? `R ${hit.r_multiple}` : null,
    ].filter(Boolean);
    if (bits.length) lines.push(`• ${bits.join(' · ')}`);
  }

  lines.push('Open: /swing/auto?tier=high_conviction');
  return lines.join('\n');
}

export function formatEveningGttWhatsAppMessage(input: {
  date_key: string;
  order_count: number;
  regime_key?: string | null;
  orders: Array<{
    symbol: string;
    tier: string;
    qty: number;
    trigger_price: number;
    limit_price: number;
    stop_loss?: number | null;
    profit_target?: number | null;
  }>;
}): string {
  const lines = [
    '📋 Script Screener · Evening GTT',
    `${input.date_key} · ${input.order_count} order(s)`,
  ];
  if (input.regime_key) lines.push(`Regime: ${input.regime_key}`);

  for (const o of input.orders.slice(0, 12)) {
    const bits = [
      o.symbol,
      o.tier.replace(/_/g, ' '),
      `qty ${o.qty}`,
      `trg ${o.trigger_price}`,
      `lim ${o.limit_price}`,
      o.stop_loss != null ? `SL ${o.stop_loss}` : null,
      o.profit_target != null ? `TGT ${o.profit_target}` : null,
    ].filter(Boolean);
    lines.push(`• ${bits.join(' · ')}`);
  }
  if (input.orders.length > 12) {
    lines.push(`… +${input.orders.length - 12} more`);
  }
  lines.push('Open: /signals · Research only — place GTT manually');
  return lines.join('\n');
}

export function formatExitAlertsWhatsAppMessage(input: {
  date_key: string;
  swing_exits: number;
  intraday_exits: number;
  alerts: Array<{
    symbol?: string;
    action?: string;
    book?: string;
    title?: string;
    detail?: string;
  }>;
}): string {
  const total = input.swing_exits + input.intraday_exits;
  const lines = [
    '🚪 Script Screener · EXIT alerts',
    `${input.date_key} · ${total} signal(s)`,
    `Swing ${input.swing_exits} · Intraday ${input.intraday_exits}`,
  ];
  for (const a of input.alerts.slice(0, 12)) {
    const bits = [a.symbol, a.action, a.book, a.title || a.detail].filter(Boolean);
    if (bits.length) lines.push(`• ${bits.join(' · ')}`);
  }
  if (input.alerts.length > 12) {
    lines.push(`… +${input.alerts.length - 12} more`);
  }
  lines.push('Open: /signals or Morning');
  return lines.join('\n');
}

export function formatPatternAlertsWhatsAppMessage(input: {
  date_key: string;
  count: number;
  alerts: Array<{
    symbol?: string;
    action?: string;
    pattern?: string;
    detail?: string;
  }>;
}): string {
  const lines = [
    '📐 Script Screener · Chart patterns',
    `${input.date_key} · ${input.count} breakout/confirmed`,
  ];
  for (const a of input.alerts.slice(0, 12)) {
    const bits = [a.symbol, a.action, a.pattern || a.detail].filter(Boolean);
    if (bits.length) lines.push(`• ${bits.join(' · ')}`);
  }
  if (input.alerts.length > 12) {
    lines.push(`… +${input.alerts.length - 12} more`);
  }
  lines.push('Open: /patterns or /signals');
  return lines.join('\n');
}

async function sendViaTwilio(to: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from =
    process.env.TWILIO_WHATSAPP_FROM?.trim() || 'whatsapp:+14155238886';
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const body = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    To: `whatsapp:+${to}`,
    Body: text.slice(0, 1500),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, reason: `Twilio HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 220)}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Twilio failed' };
  }
}

async function sendViaCallMeBot(to: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const apikey = process.env.WHATSAPP_CALLMEBOT_APIKEY!.trim();
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', `+${to}`);
  url.searchParams.set('text', text);
  url.searchParams.set('apikey', apikey);

  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return { ok: false, reason: `CallMeBot HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'CallMeBot failed' };
  }
}

async function sendViaMetaCloud(to: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN!.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!.trim();
  const version = (process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0').replace(/^\/+|\/+$/g, '');
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: text.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `Meta HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Meta WhatsApp failed' };
  }
}

/** Send a plain-text WhatsApp message. Deduped by optional dedupeKey (24h). */
export async function sendWhatsAppText(
  text: string,
  options: { dedupeKey?: string } = {},
): Promise<{ sent: boolean; provider: WhatsAppProvider; reason?: string }> {
  const provider = resolveWhatsAppProvider();
  if (!provider) {
    return { sent: false, provider: null, reason: 'WhatsApp not configured' };
  }
  if (!text.trim()) {
    return { sent: false, provider, reason: 'Empty message' };
  }

  if (options.dedupeKey) {
    const dayKey = dateKeyInTimezone(getConfigTimezone());
    const key = cacheKey(CACHE_PREFIX.SWING_AUTO, `wa:${dayKey}:${options.dedupeKey}`);
    const already = await cacheGetJson(key);
    if (already) return { sent: false, provider, reason: 'Already sent today' };
  }

  const to = normalizeWhatsAppTo(process.env.WHATSAPP_TO!);
  if (!to) {
    return { sent: false, provider, reason: 'WHATSAPP_TO invalid' };
  }

  let result: { ok: boolean; reason?: string };
  if (provider === 'twilio') result = await sendViaTwilio(to, text);
  else if (provider === 'callmebot') result = await sendViaCallMeBot(to, text);
  else result = await sendViaMetaCloud(to, text);

  if (result.ok && options.dedupeKey) {
    const dayKey = dateKeyInTimezone(getConfigTimezone());
    const key = cacheKey(CACHE_PREFIX.SWING_AUTO, `wa:${dayKey}:${options.dedupeKey}`);
    await cacheSetJson(key, { sent_at: new Date().toISOString() }, 86400);
  }

  return result.ok
    ? { sent: true, provider }
    : { sent: false, provider, reason: result.reason };
}

export async function sendWhatsAppTestMessage(): Promise<{
  sent: boolean;
  provider: WhatsAppProvider;
  reason?: string;
}> {
  const status = getWhatsAppStatus();
  if (!status.configured) {
    return {
      sent: false,
      provider: null,
      reason: status.env_hard_off
        ? 'WHATSAPP_ALERTS=0'
        : 'WhatsApp not configured (set WHATSAPP_TO + provider credentials)',
    };
  }
  const text = [
    '✅ Script Screener · WhatsApp test',
    `Provider: ${status.provider}`,
    `Time: ${new Date().toISOString()}`,
    'If you see this, Admin WhatsApp delivery works.',
  ].join('\n');
  return sendWhatsAppText(text);
}

/**
 * Evening GTT swing signals — post-close digest for manual Zerodha/broker GTT placement.
 * Research only — does not place broker orders.
 */
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import {
  CACHE_PREFIX,
  dateKeyInTimezone,
  getAlertsConfig,
  getConfigTimezone,
  getSchedules,
  isDailyCronDue,
  nseSession,
} from '@sv/shared';
import type { SwingAutoSnapshot } from '@sv/swing';
import { getSwingAutoSnapshotDurable } from './auto-swing-scan.js';
import { isSignalEmailConfigured, resolveSignalAlertEmail } from './signal-alerts.js';
import {
  formatEveningGttWhatsAppMessage,
  isWhatsAppFeatureEnabled,
  sendWhatsAppText,
} from './whatsapp-alerts.js';

const DIGEST_CACHE_SUFFIX = 'evening-gtt:last';
const APP_SETTING_PREFIX = 'evening_gtt:';

export type EveningGttTier = 'high_conviction' | 'strict_enter';

export interface EveningGttOrder {
  symbol: string;
  name: string;
  tier: EveningGttTier;
  qty: number;
  trigger_price: number;
  limit_price: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  decision_score: number | null;
  backtest_grade: string | null;
  copy_line: string;
  oco_note: string;
}

export interface EveningGttDigest {
  date_key: string;
  built_at: string;
  session_phase: string;
  regime_key: string | null;
  snapshot_saved_at: string | null;
  order_count: number;
  orders: EveningGttOrder[];
  copy_all: string;
  disclaimer: string;
  email_sent?: boolean;
  whatsapp_sent?: boolean;
}

const DISCLAIMER =
  'Research GTT levels only — not broker orders. Confirm prices on NSE and place GTT manually. Past edge ≠ future returns.';

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function symbolFromHit(hit: Record<string, unknown>): string {
  return String(hit.symbol ?? '')
    .trim()
    .toUpperCase();
}

function hitsForTier(snapshot: SwingAutoSnapshot | null | undefined, tier: EveningGttTier): Record<string, unknown>[] {
  if (!snapshot?.tiers) return [];
  const raw = snapshot.tiers[tier];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

/** Zerodha-style buy GTT line + SL/target notes for after fill. */
export function buildEveningGttOrder(
  hit: Record<string, unknown>,
  tier: EveningGttTier,
  options: { limitPremiumPct?: number } = {},
): EveningGttOrder | null {
  const symbol = symbolFromHit(hit);
  if (!symbol) return null;

  const trigger =
    num(hit.price) ?? num(hit.ta_price) ?? num(hit.entry_price) ?? num(hit.decision_price);
  if (trigger == null) return null;

  const stop = num(hit.stop_loss);
  const target = num(hit.profit_target);
  const suggested = num(hit.suggested_shares);
  const qty = suggested != null && suggested >= 1 ? Math.floor(suggested) : 1;
  const premiumPct = options.limitPremiumPct ?? 0.2;
  const limit = round2(trigger * (1 + premiumPct / 100));
  const rMult = num(hit.r_multiple);
  const score = num(hit.decision_score);
  const name = String(hit.company_name ?? hit.name ?? symbol).trim() || symbol;
  const grade = String(hit.backtest_grade ?? '').trim() || null;

  const copy_line = `BUY ${symbol} qty ${qty} trigger ${round2(trigger)} limit ${limit}${
    stop != null ? ` | SL ${round2(stop)}` : ''
  }${target != null ? ` | TGT ${round2(target)}` : ''}`;

  const oco_note =
    stop != null && target != null
      ? `After fill: place OCO — SL trigger ${round2(stop)} / target ${round2(target)}`
      : stop != null
        ? `After fill: protective SL near ${round2(stop)}`
        : 'After fill: set protective stop from your risk plan';

  return {
    symbol,
    name,
    tier,
    qty,
    trigger_price: round2(trigger),
    limit_price: limit,
    stop_loss: stop != null ? round2(stop) : null,
    profit_target: target != null ? round2(target) : null,
    r_multiple: rMult != null ? round2(rMult) : null,
    decision_score: score,
    backtest_grade: grade,
    copy_line,
    oco_note,
  };
}

export function buildEveningGttOrdersFromSnapshot(
  snapshot: SwingAutoSnapshot | null | undefined,
  options: { tiers?: EveningGttTier[]; maxOrders?: number; limitPremiumPct?: number } = {},
): EveningGttOrder[] {
  const tiers = options.tiers?.length ? options.tiers : (['high_conviction'] as EveningGttTier[]);
  const maxOrders = options.maxOrders && options.maxOrders > 0 ? options.maxOrders : 20;
  const seen = new Set<string>();
  const orders: EveningGttOrder[] = [];

  for (const tier of tiers) {
    const hits = hitsForTier(snapshot, tier);
    const ranked = [...hits].sort((a, b) => {
      const sa = num(a.decision_score) ?? 0;
      const sb = num(b.decision_score) ?? 0;
      return sb - sa;
    });
    for (const hit of ranked) {
      const order = buildEveningGttOrder(hit, tier, { limitPremiumPct: options.limitPremiumPct });
      if (!order || seen.has(order.symbol)) continue;
      seen.add(order.symbol);
      orders.push(order);
      if (orders.length >= maxOrders) return orders;
    }
  }
  return orders;
}

function digestHash(orders: EveningGttOrder[]): string {
  const payload = orders.map((o) => `${o.symbol}:${o.trigger_price}:${o.qty}`).join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export async function getEveningGttDigest(dateKey?: string): Promise<EveningGttDigest | null> {
  const tz = getConfigTimezone();
  const key = dateKey ?? dateKeyInTimezone(tz);
  const fromSettings = await prisma.appSetting.findUnique({ where: { key: `${APP_SETTING_PREFIX}${key}` } });
  if (fromSettings?.value && typeof fromSettings.value === 'object') {
    return fromSettings.value as unknown as EveningGttDigest;
  }
  const cached = await cacheGetJson<EveningGttDigest>(cacheKey(CACHE_PREFIX.MORNING, `${DIGEST_CACHE_SUFFIX}:${key}`));
  return cached ?? null;
}

async function persistDigest(digest: EveningGttDigest): Promise<void> {
  const tz = getConfigTimezone();
  const key = digest.date_key || dateKeyInTimezone(tz);
  await Promise.all([
    cacheSetJson(cacheKey(CACHE_PREFIX.MORNING, `${DIGEST_CACHE_SUFFIX}:${key}`), digest, 7 * 86400),
    cacheSetJson(cacheKey(CACHE_PREFIX.MORNING, DIGEST_CACHE_SUFFIX), digest, 7 * 86400),
    prisma.appSetting.upsert({
      where: { key: `${APP_SETTING_PREFIX}${key}` },
      create: { key: `${APP_SETTING_PREFIX}${key}`, value: digest as object },
      update: { value: digest as object },
    }),
  ]);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtInrEmail(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n * 100) / 100}`;
}

function tierBadge(tier: EveningGttTier): { label: string; bg: string; fg: string } {
  if (tier === 'high_conviction') {
    return { label: 'HOT · High Conviction', bg: '#fef3c7', fg: '#92400e' };
  }
  return { label: 'Strict ENTER', bg: '#dbeafe', fg: '#1e40af' };
}

function gttMetricCell(label: string, value: string): string {
  return `<td style="width:33.33%;padding:8px 6px;vertical-align:top">
  <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px">${escapeHtml(label)}</div>
  <div style="font-size:15px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums">${escapeHtml(value)}</div>
</td>`;
}

function formatGttOrderCardHtml(order: EveningGttOrder, index: number): string {
  const badge = tierBadge(order.tier);
  const rLabel = order.r_multiple != null ? `${order.r_multiple}R` : '—';
  const grade = order.backtest_grade ? order.backtest_grade.toUpperCase() : null;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)">
  <tr>
    <td style="height:4px;background:linear-gradient(90deg,#f59e0b 0%,#ea580c 50%,#0f172a 100%);font-size:0;line-height:0">&nbsp;</td>
  </tr>
  <tr>
    <td style="padding:18px 18px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${badge.fg};background:${badge.bg};padding:4px 10px;border-radius:999px">${escapeHtml(badge.label)}</span>
            <span style="margin-left:8px;font-size:11px;font-weight:600;color:#94a3b8">#${index + 1}</span>
          </td>
          <td align="right" style="font-size:12px;font-weight:700;color:#64748b">${escapeHtml(rLabel)}${grade ? ` · ${escapeHtml(grade)}` : ''}</td>
        </tr>
      </table>
      <div style="margin-top:12px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">${escapeHtml(order.symbol)}</div>
      <div style="margin-top:2px;font-size:13px;color:#64748b">${escapeHtml(order.name)}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:4px 12px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${gttMetricCell('Qty', String(order.qty))}
          ${gttMetricCell('Trigger', fmtInrEmail(order.trigger_price))}
          ${gttMetricCell('Limit', fmtInrEmail(order.limit_price))}
        </tr>
        <tr>
          ${gttMetricCell('Stop loss', fmtInrEmail(order.stop_loss))}
          ${gttMetricCell('Target', fmtInrEmail(order.profit_target))}
          ${gttMetricCell('R multiple', rLabel)}
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:0 18px 16px">
      <div style="background:#0f172a;border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#fbbf24;margin-bottom:6px">Zerodha GTT line</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#f8fafc;word-break:break-word">${escapeHtml(order.copy_line)}</div>
      </div>
      <div style="margin-top:10px;font-size:12px;line-height:1.45;color:#64748b">${escapeHtml(order.oco_note)}</div>
    </td>
  </tr>
</table>`;
}

/** Attractive HTML + plain-text evening GTT digest (exported for tests). */
export function formatGttEmail(digest: EveningGttDigest): { text: string; html: string } {
  const lines = digest.orders.map(
    (o, i) =>
      `${i + 1}. ${o.copy_line}\n   ${o.name} · tier ${o.tier}${o.r_multiple != null ? ` · R ${o.r_multiple}` : ''}\n   ${o.oco_note}`,
  );
  const text = [
    `Evening GTT Swing Orders — ${digest.date_key}`,
    `Orders: ${digest.order_count} · regime ${digest.regime_key ?? '—'}`,
    '',
    ...lines,
    '',
    'Copy-all:',
    digest.copy_all,
    '',
    DISCLAIMER,
  ].join('\n');

  const sentAt = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const countLabel =
    digest.order_count === 1 ? '1 swing GTT order' : `${digest.order_count} swing GTT orders`;
  const regime = digest.regime_key ? escapeHtml(digest.regime_key) : 'regime n/a';
  const cards =
    digest.orders.length > 0
      ? digest.orders.map((o, i) => formatGttOrderCardHtml(o, i)).join('')
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px dashed #cbd5e1;border-radius:14px">
  <tr><td style="padding:28px 20px;text-align:center;color:#64748b;font-size:14px">
    No High Conviction / Strict ENTER GTT candidates tonight.<br/>
    <span style="font-size:12px">Stand aside or re-check Swing Auto after the next full scan.</span>
  </td></tr>
</table>`;

  const copyBlock =
    digest.copy_all.trim().length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px">
  <tr>
    <td style="padding:14px 16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#b45309;margin-bottom:8px">Copy-all paste block</div>
      <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:#78350f">${escapeHtml(digest.copy_all)}</pre>
    </td>
  </tr>
</table>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Evening GTT · Swing</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
          <tr>
            <td style="padding:0 0 16px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(145deg,#0f172a 0%,#1e293b 45%,#78350f 100%);border-radius:16px;overflow:hidden">
                <tr>
                  <td style="padding:24px 24px 20px">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#fbbf24;margin-bottom:8px">Script Screener · Post-close</div>
                    <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;line-height:1.2">Evening GTT · Swing</div>
                    <div style="margin-top:10px;font-size:13px;color:#e2e8f0;line-height:1.45">
                      ${escapeHtml(countLabel)} · ${escapeHtml(digest.date_key)} · ${regime}<br/>
                      <span style="color:#94a3b8">${escapeHtml(sentAt)} IST</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 24px 20px">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.08);border-radius:10px">
                      <tr>
                        <td style="padding:12px 14px;font-size:12px;color:#fde68a;line-height:1.45">
                          Place buy GTTs manually in Zerodha tonight · after fill, set OCO SL / target from each card
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>${cards}</td>
          </tr>
          <tr>
            <td>${copyBlock}</td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0">
              <p style="margin:0;font-size:11px;line-height:1.55;color:#94a3b8;text-align:center">
                ${escapeHtml(DISCLAIMER)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}

async function sendEveningGttEmail(digest: EveningGttDigest): Promise<boolean> {
  if (!isSignalEmailConfigured()) return false;
  if (process.env.EVENING_GTT_EMAIL === '0') return false;
  if (getAlertsConfig().email?.evening_gtt === false) return false;

  const to = await resolveSignalAlertEmail();
  if (!to) return false;

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = String(process.env.SMTP_SECURE ?? 'false') === 'true';
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || user!;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const { text, html } = formatGttEmail(digest);
  await transporter.sendMail({
    from,
    to,
    subject: `Evening GTT · ${digest.order_count} swing · ${digest.date_key}`,
    text,
    html,
  });
  return true;
}

export async function buildAndPersistEveningGttDigest(
  options: { force?: boolean; sendEmail?: boolean } = {},
): Promise<EveningGttDigest> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.evening_gtt;
  const tz = cfg?.timezone ?? getConfigTimezone();
  const dateKey = dateKeyInTimezone(tz);
  const session = nseSession();

  if (!options.force) {
    const existing = await getEveningGttDigest(dateKey);
    if (existing) return existing;
  }

  const tiers = (cfg?.tiers?.length ? cfg.tiers : ['high_conviction', 'strict_enter']) as EveningGttTier[];
  const maxOrders = cfg?.max_orders ?? 15;
  const limitPremiumPct = cfg?.limit_premium_pct ?? getAlertsConfig().evening_gtt?.limit_premium_pct ?? 0.2;
  const snapshot = await getSwingAutoSnapshotDurable();
  const orders = buildEveningGttOrdersFromSnapshot(snapshot, { tiers, maxOrders, limitPremiumPct });
  const regime =
    (snapshot?.scan?.regime as Record<string, unknown> | undefined) ??
    (snapshot?.summary as Record<string, unknown> | undefined) ??
    null;

  const digest: EveningGttDigest = {
    date_key: dateKey,
    built_at: new Date().toISOString(),
    session_phase: session.phase,
    regime_key: String(regime?.key ?? regime?.regime_key ?? '') || null,
    snapshot_saved_at: snapshot?.saved_at ?? null,
    order_count: orders.length,
    orders,
    copy_all: orders.map((o) => o.copy_line).join('\n'),
    disclaimer: DISCLAIMER,
  };

  void digestHash(orders);

  const alertsCfg = getAlertsConfig();
  const allowEmail =
    options.sendEmail !== false &&
    cfg?.send_email !== false &&
    alertsCfg.evening_gtt?.send_email !== false &&
    alertsCfg.email?.evening_gtt !== false;
  if (allowEmail) {
    try {
      digest.email_sent = await sendEveningGttEmail(digest);
    } catch (err) {
      digest.email_sent = false;
      (digest as EveningGttDigest & { email_error?: string }).email_error =
        err instanceof Error ? err.message : 'SMTP send failed';
    }
  }

  if (isWhatsAppFeatureEnabled('evening_gtt') && digest.order_count > 0) {
    try {
      const text = formatEveningGttWhatsAppMessage({
        date_key: digest.date_key,
        order_count: digest.order_count,
        regime_key: digest.regime_key,
        orders: digest.orders,
      });
      const wa = await sendWhatsAppText(text, { dedupeKey: `evening-gtt:${digest.date_key}` });
      digest.whatsapp_sent = wa.sent;
    } catch {
      digest.whatsapp_sent = false;
    }
  }

  await persistDigest(digest);
  return digest;
}

export async function hasEveningGttToday(timezone = getConfigTimezone()): Promise<boolean> {
  const digest = await getEveningGttDigest(dateKeyInTimezone(timezone));
  return Boolean(digest);
}

/** Worker tick — once per weekday after configured cron (default 16:00 IST). */
export async function tickEveningGttSignals(now = new Date()): Promise<EveningGttDigest | null> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.evening_gtt;
  if (!cfg?.enabled) return null;

  const tz = cfg.timezone || getConfigTimezone();
  const session = nseSession(now);
  if (session.phase === 'weekend') return null;

  if (await hasEveningGttToday(tz)) return null;
  if (!isDailyCronDue(cfg.cron, tz, now)) return null;

  // Prefer post-close; still allow if cron fires slightly early on half-days.
  return buildAndPersistEveningGttDigest({ sendEmail: true });
}

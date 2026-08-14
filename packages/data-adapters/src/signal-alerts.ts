import { createHash } from 'node:crypto';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma } from '@sv/db';
import { CACHE_PREFIX, dateKeyInTimezone, getConfigTimezone } from '@sv/shared';
import nodemailer from 'nodemailer';

export type SignalBook = 'swing' | 'intraday' | 'pattern';
export type SignalSide = 'entry' | 'exit' | 'partial';

export interface TradeSignalAlert {
  /** Stable dedupe id (e.g. swing-entry:TCS:positionId). */
  id: string;
  book: SignalBook;
  side: SignalSide;
  /** Ticker / cache key for subject lines (e.g. TCS, NIFTY50). */
  symbol: string;
  /** Human-readable name (e.g. TCS, Nifty 50). Prefer this in email body. */
  name: string;
  action: string;
  action_label?: string;
  price?: number | null;
  side_bias?: string | null;
  quantity?: number | null;
  timeframe?: string | null;
  entry_price?: number | null;
  stop_loss?: number | null;
  target_t1?: number | null;
  target_t2?: number | null;
  target_t3?: number | null;
  remaining_pct?: number | null;
  realized_pnl?: number | null;
  notional_inr?: number | null;
  detail?: string;
}

const SIGNAL_EMAIL_DEDUPE_SEC = 7 * 86400;

export function isSignalEmailConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  return Boolean(host && from);
}

export function getSmtpStatus(): {
  configured: boolean;
  host: string | null;
  from_masked: string | null;
  has_auth: boolean;
  has_to_override: boolean;
} {
  const host = process.env.SMTP_HOST?.trim() || null;
  const from = (process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || null) as string | null;
  const fromMasked =
    from && from.includes('@')
      ? `${from.slice(0, 2)}***@${from.split('@')[1]}`
      : from
        ? `${from.slice(0, 2)}***`
        : null;
  return {
    configured: isSignalEmailConfigured(),
    host,
    from_masked: fromMasked,
    has_auth: Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()),
    has_to_override: Boolean(process.env.SIGNAL_ALERT_EMAIL_TO?.trim()),
  };
}

export async function resolveSignalAlertEmail(userId?: string): Promise<string | null> {
  const override = process.env.SIGNAL_ALERT_EMAIL_TO?.trim();
  if (override) return override;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email?.trim() || null;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function looksLikeDbId(value: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(value) || /^[0-9a-f-]{24,}$/i.test(value);
}

function fmtInr(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `₹${Math.round(value * 100) / 100}`;
}

/** Prefer readable label; never fall back to a DB cuid. */
export function displayName(row: Record<string, unknown>, fallback = 'Unknown'): string {
  const label = String(row.instrument_label ?? row.name ?? '').trim();
  if (label && !looksLikeDbId(label)) return label;
  const symbol = String(row.symbol ?? '').trim();
  if (symbol && !looksLikeDbId(symbol)) return symbol;
  const instrument = String(row.instrument ?? row.instrument_id ?? '').trim();
  if (instrument && !looksLikeDbId(instrument)) return instrument;
  return fallback;
}

function tickerFrom(row: Record<string, unknown>, name: string): string {
  const symbol = String(row.symbol ?? '').trim().toUpperCase();
  if (symbol && !looksLikeDbId(symbol)) return symbol;
  const instrument = String(row.instrument_id ?? row.instrument ?? '').trim().toUpperCase();
  if (instrument && !looksLikeDbId(instrument)) return instrument;
  return name.toUpperCase().replace(/\s+/g, '');
}

function moneyFields(row: Record<string, unknown>, position?: Record<string, unknown>) {
  const src = { ...row, ...(position ?? {}) };
  return {
    side_bias: src.side != null ? String(src.side) : null,
    quantity: Number(src.quantity ?? 0) || null,
    timeframe: src.timeframe != null ? String(src.timeframe) : null,
    entry_price: Number(src.entry_price ?? 0) || null,
    stop_loss: Number(src.effective_stop ?? src.stop_loss ?? 0) || null,
    target_t1: Number(src.target_t1 ?? 0) || null,
    target_t2: Number(src.target_t2 ?? 0) || null,
    target_t3: Number(src.target_t3 ?? 0) || null,
    remaining_pct: Number(src.remaining_pct ?? 0) || null,
    realized_pnl:
      src.realized_pnl != null && Number.isFinite(Number(src.realized_pnl))
        ? Number(src.realized_pnl)
        : null,
    notional_inr: Number(src.notional_inr ?? 0) || null,
    action_label: src.action_label != null ? String(src.action_label) : undefined,
  };
}

function buildDetail(fields: ReturnType<typeof moneyFields>, extras: string[] = []): string {
  const parts: string[] = [...extras];
  if (fields.side_bias) parts.push(fields.side_bias.toUpperCase());
  if (fields.timeframe) parts.push(fields.timeframe);
  if (fields.quantity != null) parts.push(`qty ${fields.quantity}`);
  if (fields.entry_price != null) parts.push(`entry ${fmtInr(fields.entry_price)}`);
  if (fields.stop_loss != null) parts.push(`stop ${fmtInr(fields.stop_loss)}`);
  if (fields.target_t1 != null) parts.push(`T1 ${fmtInr(fields.target_t1)}`);
  if (fields.target_t2 != null) parts.push(`T2 ${fmtInr(fields.target_t2)}`);
  if (fields.target_t3 != null) parts.push(`T3 ${fmtInr(fields.target_t3)}`);
  if (fields.remaining_pct != null && fields.remaining_pct < 100) {
    parts.push(`remaining ${fields.remaining_pct}%`);
  }
  if (fields.realized_pnl != null) parts.push(`PnL ${fmtInr(fields.realized_pnl)}`);
  if (fields.notional_inr != null) parts.push(`notional ${fmtInr(fields.notional_inr)}`);
  if (fields.action_label) parts.push(fields.action_label);
  return parts.join(' · ');
}

export function alertsFromMorningStrings(alerts: string[]): TradeSignalAlert[] {
  const dayKey = dateKeyInTimezone(getConfigTimezone());
  return alerts.map((text) => {
    const book: SignalBook = text.toLowerCase().includes('intraday') ? 'intraday' : 'swing';
    const symbolMatch =
      text.match(/Swing EXIT:\s*([A-Z0-9.&-]+)/i) ??
      text.match(/Intraday:\s*([^→]+?)(?:\s*→|$)/i);
    const name = symbolMatch?.[1]?.trim().replace(/\s+/g, ' ') || 'Portfolio';
    const symbol = name.toUpperCase();
    return {
      id: `morning:${dayKey}:${hashText(text)}`,
      book,
      side: 'exit',
      symbol,
      name,
      action: 'EXIT',
      detail: text,
    };
  });
}

export function alertsFromSwingPaperTick(result: {
  entries?: Array<Record<string, unknown>>;
  exits?: Array<Record<string, unknown>>;
}): TradeSignalAlert[] {
  const out: TradeSignalAlert[] = [];
  for (const row of result.entries ?? []) {
    if (row.skipped) continue;
    const position = row.position as Record<string, unknown> | undefined;
    const name = displayName({ ...row, ...(position ?? {}) });
    const symbol = tickerFrom({ ...row, ...(position ?? {}) }, name);
    if (!symbol || symbol === 'UNKNOWN') continue;
    const positionId = String(position?.id ?? symbol);
    const fields = moneyFields(row, position);
    out.push({
      id: `swing-entry:${positionId}`,
      book: 'swing',
      side: 'entry',
      symbol,
      name,
      action: 'ENTRY',
      price: Number(position?.entry_price ?? row.entry_price ?? 0) || null,
      ...fields,
      detail: buildDetail(fields, ['Swing paper · High Conviction entry']),
    });
  }
  for (const row of result.exits ?? []) {
    const name = displayName(row);
    const symbol = tickerFrom(row, name);
    if (!symbol || symbol === 'UNKNOWN') continue;
    const action = String(row.action ?? '');
    const price = Number(row.price ?? 0) || null;
    const fields = moneyFields(row);
    if (action === 'PARTIAL_T1' || action === 'PARTIAL_T2') {
      if (row.booked !== true) continue;
      out.push({
        id: `swing-${action.toLowerCase()}:${symbol}:${Math.round((price ?? 0) * 100)}`,
        book: 'swing',
        side: 'partial',
        symbol,
        name,
        action,
        price,
        ...fields,
        detail: buildDetail(fields, ['Swing paper scale-out']),
      });
      continue;
    }
    if (row.closed !== true && !['EXIT_NOW', 'CUT_LOSS'].includes(action)) continue;
    out.push({
      id: `swing-exit:${symbol}:${action}:${Math.round((price ?? 0) * 100)}`,
      book: 'swing',
      side: 'exit',
      symbol,
      name,
      action: action || 'EXIT',
      price,
      ...fields,
      detail: buildDetail(fields, ['Swing paper exit', String(row.closed_reason ?? '')].filter(Boolean)),
    });
  }
  return out;
}

export function alertsFromIntradayPaperTick(result: {
  entries?: Array<Record<string, unknown>>;
  exits?: Array<Record<string, unknown>>;
}): TradeSignalAlert[] {
  const out: TradeSignalAlert[] = [];
  for (const row of result.entries ?? []) {
    if (row.skipped) continue;
    const position = row.position as Record<string, unknown> | undefined;
    const name = displayName({ ...row, ...(position ?? {}) });
    const symbol = tickerFrom({ ...row, ...(position ?? {}) }, name);
    if (!symbol || symbol === 'UNKNOWN') continue;
    const positionId = String(position?.id ?? symbol);
    const fields = moneyFields(row, position);
    out.push({
      id: `intraday-entry:${positionId}`,
      book: 'intraday',
      side: 'entry',
      symbol,
      name,
      action: 'ENTRY',
      price: Number(position?.entry_price ?? 0) || null,
      ...fields,
      detail: buildDetail(fields, ['Intraday Stratzy paper entry']),
    });
  }
  for (const row of result.exits ?? []) {
    const action = String(row.action ?? '');
    const price = Number(row.price ?? 0) || null;
    const positionId = String(row.id ?? '');
    const name = displayName(row);
    const symbol = tickerFrom(row, name);
    if (!symbol || symbol === 'UNKNOWN') continue;
    const fields = moneyFields(row);
    if (action === 'PARTIAL_T1' || action === 'PARTIAL_T2') {
      if (row.booked !== true) continue;
      out.push({
        id: `intraday-${action.toLowerCase()}:${positionId || symbol}`,
        book: 'intraday',
        side: 'partial',
        symbol,
        name,
        action,
        price,
        ...fields,
        detail: buildDetail(fields, ['Intraday paper scale-out']),
      });
      continue;
    }
    if (
      row.closed !== true &&
      !['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS', 'EXIT_SESSION'].includes(action)
    ) {
      continue;
    }
    out.push({
      id: `intraday-exit:${positionId || symbol}:${action}`,
      book: 'intraday',
      side: 'exit',
      symbol,
      name,
      action: action || 'EXIT',
      price,
      ...fields,
      detail: buildDetail(
        fields,
        ['Intraday paper exit', String(row.closed_reason ?? row.action_label ?? '')].filter(Boolean),
      ),
    });
  }
  return out;
}

function sideLabel(side: SignalSide): string {
  if (side === 'entry') return 'ENTRY';
  if (side === 'partial') return 'PARTIAL';
  return 'EXIT';
}

function alertTitle(a: TradeSignalAlert): string {
  return a.name || a.symbol;
}

export function formatSignalEmailSubject(alerts: TradeSignalAlert[]): string {
  if (alerts.length === 1) {
    const a = alerts[0];
    const px = a.price != null && a.price > 0 ? ` @ ${a.price}` : '';
    if (a.action === 'HIGH_CONVICTION' || a.action === 'SWING_SIGNAL') {
      return `[Stock Verifier] SWING SIGNAL: ${alertTitle(a)}${px}`;
    }
    if (a.book === 'pattern') {
      return `[Stock Verifier] PATTERN ${a.action}: ${alertTitle(a)}${px}`;
    }
    return `[Stock Verifier] ${a.book.toUpperCase()} ${sideLabel(a.side)}: ${alertTitle(a)}${px}`;
  }
  const entries = alerts.filter((a) => a.side === 'entry').length;
  const exits = alerts.filter((a) => a.side === 'exit').length;
  const partials = alerts.filter((a) => a.side === 'partial').length;
  const radar = alerts.filter((a) => a.action === 'HIGH_CONVICTION' || a.action === 'SWING_SIGNAL');
  if (radar.length === alerts.length) {
    const names = radar
      .slice(0, 3)
      .map(alertTitle)
      .join(', ');
    const more = radar.length > 3 ? ` +${radar.length - 3}` : '';
    return `[Stock Verifier] ${radar.length} swing signals — ${names}${more}`;
  }
  const patterns = alerts.filter((a) => a.book === 'pattern');
  if (patterns.length === alerts.length) {
    const names = patterns
      .slice(0, 3)
      .map(alertTitle)
      .join(', ');
    const more = patterns.length > 3 ? ` +${patterns.length - 3}` : '';
    return `[Stock Verifier] ${patterns.length} chart patterns — ${names}${more}`;
  }
  const names = alerts
    .slice(0, 3)
    .map(alertTitle)
    .join(', ');
  const more = alerts.length > 3 ? ` +${alerts.length - 3}` : '';
  return `[Stock Verifier] ${alerts.length} signals (E${entries}/X${exits}/P${partials}) — ${names}${more}`;
}

function formatSignalBlock(a: TradeSignalAlert): string[] {
  const px = a.price != null && a.price > 0 ? fmtInr(a.price) : null;
  const kind = signalKind(a);
  const lines = [
    `${kind} — ${alertTitle(a)}${a.symbol && a.symbol !== alertTitle(a).toUpperCase() ? ` (${a.symbol})` : ''}`,
    `Action: ${a.action}${px ? ` @ ${px}` : ''}`,
  ];
  if (a.side_bias) lines.push(`Bias: ${a.side_bias.toUpperCase()}`);
  if (a.timeframe) lines.push(`Timeframe: ${a.timeframe}`);
  if (a.quantity != null) lines.push(`Quantity: ${a.quantity}`);
  if (a.entry_price != null) lines.push(`Entry: ${fmtInr(a.entry_price)}`);
  if (a.stop_loss != null) lines.push(`Stop: ${fmtInr(a.stop_loss)}`);
  const targets = [
    a.target_t1 != null ? `T1 ${fmtInr(a.target_t1)}` : null,
    a.target_t2 != null ? `T2 ${fmtInr(a.target_t2)}` : null,
    a.target_t3 != null ? `T3 ${fmtInr(a.target_t3)}` : null,
  ].filter(Boolean);
  if (targets.length) lines.push(`Targets: ${targets.join(' · ')}`);
  if (a.remaining_pct != null && a.remaining_pct < 100) {
    lines.push(`Remaining: ${a.remaining_pct}%`);
  }
  if (a.realized_pnl != null) lines.push(`Realized PnL: ${fmtInr(a.realized_pnl)}`);
  if (a.notional_inr != null) lines.push(`Notional: ${fmtInr(a.notional_inr)}`);
  if (a.action_label) lines.push(`Note: ${a.action_label}`);
  if (a.detail) lines.push(a.detail);
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function signalKind(a: TradeSignalAlert): string {
  if (a.action === 'HIGH_CONVICTION' || a.action === 'SWING_SIGNAL') return 'SWING SIGNAL';
  if (a.book === 'pattern') return `PATTERN ${a.action}`;
  return `${a.book.toUpperCase()} ${sideLabel(a.side)}`;
}

function signalAccent(a: TradeSignalAlert): { bar: string; badge: string; badgeText: string } {
  if (a.side === 'exit') {
    return { bar: '#dc2626', badge: '#fef2f2', badgeText: '#991b1b' };
  }
  if (a.side === 'partial') {
    return { bar: '#d97706', badge: '#fffbeb', badgeText: '#92400e' };
  }
  if (a.action === 'HIGH_CONVICTION' || a.action === 'SWING_SIGNAL') {
    return { bar: '#059669', badge: '#ecfdf5', badgeText: '#065f46' };
  }
  return { bar: '#2563eb', badge: '#eff6ff', badgeText: '#1e40af' };
}

function metricCell(label: string, value: string | null | undefined): string {
  if (!value) return '';
  return `<td style="padding:8px 12px 8px 0;vertical-align:top;width:33%">
  <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;margin-bottom:2px">${escapeHtml(label)}</div>
  <div style="font-size:15px;font-weight:600;color:#0f172a">${escapeHtml(value)}</div>
</td>`;
}

function formatSignalCardHtml(a: TradeSignalAlert): string {
  const accent = signalAccent(a);
  const title = escapeHtml(alertTitle(a));
  const symbol =
    a.symbol && a.symbol !== alertTitle(a).toUpperCase()
      ? `<span style="margin-left:8px;font-size:12px;font-weight:600;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:999px">${escapeHtml(a.symbol)}</span>`
      : '';
  const px = a.price != null && a.price > 0 ? fmtInr(a.price) : null;
  const targets = [
    a.target_t1 != null ? `T1 ${fmtInr(a.target_t1)}` : null,
    a.target_t2 != null ? `T2 ${fmtInr(a.target_t2)}` : null,
    a.target_t3 != null ? `T3 ${fmtInr(a.target_t3)}` : null,
  ].filter(Boolean) as string[];

  const row1 = [
    metricCell('Action', a.action),
    metricCell('Price', px),
    metricCell('Bias', a.side_bias ? a.side_bias.toUpperCase() : null),
  ]
    .filter(Boolean)
    .join('');

  const row2 = [
    metricCell('Entry', a.entry_price != null ? fmtInr(a.entry_price) : null),
    metricCell('Stop', a.stop_loss != null ? fmtInr(a.stop_loss) : null),
    metricCell('Targets', targets.length ? targets.join(' · ') : null),
  ]
    .filter(Boolean)
    .join('');

  const row3 = [
    metricCell('Qty', a.quantity != null ? String(a.quantity) : null),
    metricCell('Timeframe', a.timeframe),
    metricCell(
      'Remaining',
      a.remaining_pct != null && a.remaining_pct < 100 ? `${a.remaining_pct}%` : null,
    ),
  ]
    .filter(Boolean)
    .join('');

  const row4 = [
    metricCell('PnL', a.realized_pnl != null ? fmtInr(a.realized_pnl) : null),
    metricCell('Notional', a.notional_inr != null ? fmtInr(a.notional_inr) : null),
    metricCell('Note', a.action_label),
  ]
    .filter(Boolean)
    .join('');

  const metricRows = [row1, row2, row3, row4]
    .filter((r) => r.length > 0)
    .map(
      (r) =>
        `<tr>${r}</tr>`,
    )
    .join('');

  const detail = a.detail
    ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#475569">${escapeHtml(a.detail)}</p>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff">
  <tr>
    <td style="width:5px;background:${accent.bar}"></td>
    <td style="padding:16px 18px">
      <div style="margin-bottom:12px">
        <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${accent.badgeText};background:${accent.badge};padding:4px 10px;border-radius:999px">${escapeHtml(signalKind(a))}</span>
      </div>
      <div style="font-size:20px;font-weight:700;color:#0f172a;line-height:1.3">${title}${symbol}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${metricRows}</table>
      ${detail}
    </td>
  </tr>
</table>`;
}

export function formatSignalEmailBody(alerts: TradeSignalAlert[]): { text: string; html: string } {
  const blocks = alerts.map((a) => formatSignalBlock(a).join('\n'));
  const text = [
    'Stock Verifier — trade signal alert',
    '',
    ...blocks.flatMap((b, i) => (i === 0 ? [b] : ['', b])),
    '',
    'Research only. Confirm on NSE before live orders.',
    `Sent ${new Date().toISOString()}`,
  ].join('\n');

  const countLabel =
    alerts.length === 1 ? '1 signal' : `${alerts.length} signals`;
  const cards = alerts.map(formatSignalCardHtml).join('');
  const sentAt = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Script Screener signal</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
          <tr>
            <td style="padding:0 0 16px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0f766e 0%,#115e59 55%,#134e4a 100%);border-radius:14px;overflow:hidden">
                <tr>
                  <td style="padding:22px 24px">
                    <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#99f6e4;margin-bottom:6px">Script Screener</div>
                    <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.25">Trade signal alert</div>
                    <div style="margin-top:8px;font-size:13px;color:#ccfbf1">${escapeHtml(countLabel)} · ${escapeHtml(sentAt)} IST</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>${cards}</td>
          </tr>
          <tr>
            <td style="padding:4px 4px 0">
              <p style="margin:0;font-size:12px;line-height:1.55;color:#64748b;text-align:center">
                Research only · Confirm on NSE before live orders<br />
                Not investment advice · Manage risk on every trade
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

async function sendSignalEmail(to: string, alerts: TradeSignalAlert[]): Promise<boolean> {
  if (!isSignalEmailConfigured() || alerts.length === 0) return false;
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || user;
  if (!from) return false;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  const { text, html } = formatSignalEmailBody(alerts);
  const subject = formatSignalEmailSubject(alerts);
  try {
    await transporter.sendMail({ from, to, subject, text, html });
    return true;
  } catch (err) {
    console.warn(
      '[signal-email] send failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** One-shot SMTP smoke test (bypasses Redis dedupe). */
export async function sendTestSignalEmail(toOverride?: string): Promise<{
  ok: boolean;
  to: string | null;
  reason?: string;
}> {
  if (!isSignalEmailConfigured()) {
    return { ok: false, to: null, reason: 'SMTP not configured (need SMTP_HOST + SMTP_FROM/SMTP_USER)' };
  }
  const to = toOverride?.trim() || (await resolveSignalAlertEmail()) || null;
  if (!to) {
    return { ok: false, to: null, reason: 'No recipient — set SIGNAL_ALERT_EMAIL_TO' };
  }

  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const alerts: TradeSignalAlert[] = [
    {
      id: `smtp-test:${dayKey}:${Date.now()}`,
      book: 'swing',
      side: 'entry',
      symbol: 'TEST',
      name: 'SMTP connectivity test',
      action: 'HIGH_CONVICTION',
      action_label: 'Test only',
      price: 100,
      stop_loss: 95,
      target_t3: 110,
      detail: 'Script Screener SMTP smoke test — safe to ignore.',
    },
  ];

  const ok = await sendSignalEmail(to, alerts);
  return ok
    ? { ok: true, to }
    : { ok: false, to, reason: 'SMTP send failed — check SMTP_USER / app password / host' };
}

/** Send deduped entry/exit emails for a user (or SIGNAL_ALERT_EMAIL_TO override). */
export async function notifyTradeSignalEmails(
  userId: string | undefined,
  alerts: TradeSignalAlert[],
): Promise<boolean> {
  if (!isSignalEmailConfigured() || alerts.length === 0) return false;
  const to = await resolveSignalAlertEmail(userId);
  if (!to) return false;

  const pending: TradeSignalAlert[] = [];
  for (const alert of alerts) {
    const dedupeKey = cacheKey(CACHE_PREFIX.MORNING, `signal-email:${alert.id}`);
    const sent = await cacheGetJson(dedupeKey);
    if (sent) continue;
    pending.push(alert);
  }
  if (pending.length === 0) return false;

  const ok = await sendSignalEmail(to, pending);
  if (!ok) return false;

  await Promise.all(
    pending.map((alert) =>
      cacheSetJson(
        cacheKey(CACHE_PREFIX.MORNING, `signal-email:${alert.id}`),
        { sent_at: new Date().toISOString(), to },
        SIGNAL_EMAIL_DEDUPE_SEC,
      ),
    ),
  );
  return true;
}

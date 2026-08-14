/**
 * Exit-alert emails for open journal swing / intraday positions.
 * Worker cron + manual CLI/API — does not require opening Morning.
 */
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { prisma, SwingPositionStatus } from '@sv/db';
import {
  CACHE_PREFIX,
  dateKeyInTimezone,
  getAlertsConfig,
  getConfigTimezone,
  getSchedules,
  isDailyCronDue,
  nseSession,
} from '@sv/shared';
import { refreshPosition } from '@sv/swing';
import { evaluateIntradayPosition, normalizeInterval, resolveInstrument } from '@sv/intraday';
import { buildSymbolContext } from './swing-scan.js';
import { currentMarketRegime } from './market-regime.js';
import { liveQuoteForSymbol } from './live-quote.js';
import { fetchInstrumentIntradayChart } from './intraday-chart.js';
import {
  isSignalEmailConfigured,
  notifyTradeSignalEmails,
  type TradeSignalAlert,
} from './signal-alerts.js';
import {
  formatExitAlertsWhatsAppMessage,
  isWhatsAppFeatureEnabled,
  sendWhatsAppText,
} from './whatsapp-alerts.js';

const LAST_KEY = 'exit-alerts:last';
const URGENT_SWING = new Set(['EXIT_NOW', 'CUT_LOSS', 'EXIT']);
const URGENT_INTRA = new Set(['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS', 'EXIT_SESSION']);

export interface OpenExitAlertBatchResult {
  ok: boolean;
  date_key: string;
  users: number;
  swing_exits: number;
  intraday_exits: number;
  emails_sent: number;
  whatsapp_sent?: boolean;
  skipped_weekend?: boolean;
  error?: string;
}

function entryDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build rich exit alerts from evaluated open swing rows. */
export function alertsFromOpenSwingExits(
  rows: Array<Record<string, unknown>>,
  dayKey = dateKeyInTimezone(getConfigTimezone()),
): TradeSignalAlert[] {
  const out: TradeSignalAlert[] = [];
  for (const row of rows) {
    const verdict = String(row.exit_verdict ?? '');
    const action = String(row.position_action ?? row.action ?? '');
    const isExit = verdict === 'EXIT' || URGENT_SWING.has(action);
    if (!isExit) continue;

    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const id = String(row.id ?? symbol);
    const price = Number(row.current_price ?? row.price ?? 0) || null;
    const entry = Number(row.entry_price ?? 0) || null;
    const stop = Number(row.trailed_stop_loss ?? row.stop_loss ?? 0) || null;
    const target = Number(row.profit_target ?? 0) || null;
    const triggers = Array.isArray(row.exit_triggers)
      ? (row.exit_triggers as unknown[]).map(String).filter(Boolean)
      : [];
    const actionLabel = String(row.action_label ?? (action || 'EXIT'));

    out.push({
      id: `open-exit:swing:${id}:${dayKey}:${action || verdict}`,
      book: 'swing',
      side: 'exit',
      symbol,
      name: symbol,
      action: action || 'EXIT',
      action_label: actionLabel,
      price,
      entry_price: entry,
      stop_loss: stop,
      target_t3: target,
      quantity: Number(row.shares ?? 0) || null,
      timeframe: '1D',
      side_bias: 'long',
      detail: [
        'Open swing book · EXIT alert',
        actionLabel,
        triggers.length ? `triggers ${triggers.join(', ')}` : null,
        entry != null ? `entry ₹${entry}` : null,
        price != null ? `mark ₹${price}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return out;
}

/** Build rich exit alerts from evaluated open intraday rows. */
export function alertsFromOpenIntradayExits(
  rows: Array<Record<string, unknown>>,
  dayKey = dateKeyInTimezone(getConfigTimezone()),
): TradeSignalAlert[] {
  const out: TradeSignalAlert[] = [];
  for (const row of rows) {
    const verdict = String(row.exit_verdict ?? '');
    const action = String(row.position_action ?? row.action ?? '');
    if (verdict !== 'EXIT' && !URGENT_INTRA.has(action)) continue;

    const pos = (row.position as Record<string, unknown> | undefined) ?? row;
    const symbol = String(pos.symbol ?? row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const id = String(pos.id ?? row.id ?? symbol);
    const name = String(row.instrument_label ?? pos.instrument_label ?? symbol);
    const price = Number(row.current_price ?? row.price ?? 0) || null;

    out.push({
      id: `open-exit:intraday:${id}:${dayKey}:${action || verdict}`,
      book: 'intraday',
      side: 'exit',
      symbol,
      name,
      action: action || 'EXIT',
      action_label: String(row.action_label ?? (action || 'EXIT')),
      price,
      entry_price: Number(pos.entry_price ?? 0) || null,
      stop_loss: Number(pos.effective_stop ?? pos.stop_loss ?? 0) || null,
      target_t1: Number(pos.target_t1 ?? 0) || null,
      target_t2: Number(pos.target_t2 ?? 0) || null,
      target_t3: Number(pos.target_t3 ?? 0) || null,
      quantity: Number(pos.quantity ?? 0) || null,
      timeframe: String(pos.timeframe ?? '15m'),
      side_bias: String(pos.side ?? 'long'),
      detail: [
        'Open intraday book · EXIT alert',
        String(row.action_label ?? (action || 'EXIT')),
        price != null ? `mark ₹${price}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return out;
}

async function evaluateOpenSwingForUser(userId: string | null): Promise<TradeSignalAlert[]> {
  const positions = await prisma.swingPosition.findMany({
    where: {
      status: SwingPositionStatus.open,
      ...(userId ? { userId } : { userId: null }),
    },
    take: 50,
  });
  if (positions.length === 0) return [];

  const regime = await currentMarketRegime(false);
  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const evaluated: Array<Record<string, unknown>> = [];

  for (const pos of positions) {
    const ctx = await buildSymbolContext(pos.symbol, false, { include_hourly: true });
    if (!ctx) continue;
    const barPrice = Number(ctx.ta.ta_price ?? ctx.bars[ctx.bars.length - 1]?.close ?? pos.entryPrice);
    const live = await liveQuoteForSymbol(pos.symbol, false).catch(() => null);
    const price = live && live > 0 ? live : barPrice;
    const refreshed = refreshPosition(
      {
        id: pos.id,
        symbol: pos.symbol,
        status: 'open',
        entry_price: pos.entryPrice,
        entry_date: entryDateKey(pos.entryDate),
        shares: pos.shares,
        stop_loss: pos.stopLoss,
        profit_target: pos.profitTarget,
        highest_since_entry: pos.highestSinceEntry,
        trailed_stop_loss: pos.trailedStopLoss,
      },
      {
        ta: ctx.ta,
        price,
        bars: ctx.bars,
        hourlyBars: ctx.hourlyBars,
        regime,
      },
    );
    evaluated.push({ ...refreshed, id: pos.id, shares: pos.shares });
  }

  return alertsFromOpenSwingExits(evaluated, dayKey);
}

async function evaluateOpenIntradayForUser(userId: string | null): Promise<TradeSignalAlert[]> {
  const positions = await prisma.niftyIntradayPosition.findMany({
    where: {
      status: SwingPositionStatus.open,
      ...(userId ? { userId } : { userId: null }),
    },
    take: 50,
  });
  if (positions.length === 0) return [];

  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const evaluated: Array<Record<string, unknown>> = [];

  for (const pos of positions) {
    const interval = normalizeInterval(pos.timeframe) as '5m' | '15m';
    const instrument = resolveInstrument(pos.instrumentId);
    const chart = instrument
      ? await fetchInstrumentIntradayChart(
          instrument.cache_key,
          instrument.yahoo_symbols,
          instrument.cache_key,
          interval,
          false,
        ).catch(() => null)
      : null;
    const mapped = {
      id: pos.id,
      instrument_id: pos.instrumentId,
      symbol: pos.symbol,
      instrument_label: pos.instrumentLabel,
      status: 'open',
      side: pos.side,
      timeframe: pos.timeframe,
      entry_price: pos.entryPrice,
      entry_time: pos.entryTime.toISOString(),
      session_date: pos.sessionDate.toISOString().slice(0, 10),
      quantity: pos.quantity,
      stop_loss: pos.stopLoss,
      effective_stop: pos.effectiveStop,
      target_t1: pos.targetT1,
      target_t2: pos.targetT2,
      target_t3: pos.targetT3,
      remaining_pct: pos.remainingPct,
      t1_booked: pos.t1Booked,
      t2_booked: pos.t2Booked,
      breakeven_armed: pos.breakevenArmed,
    };
    evaluated.push(evaluateIntradayPosition(mapped, chart?.bars ?? []));
  }

  return alertsFromOpenIntradayExits(evaluated, dayKey);
}

async function userIdsWithOpenBooks(): Promise<Array<string | null>> {
  const [swing, intra] = await Promise.all([
    prisma.swingPosition.findMany({
      where: { status: SwingPositionStatus.open },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.niftyIntradayPosition.findMany({
      where: { status: SwingPositionStatus.open },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);
  const set = new Set<string | null>();
  for (const row of [...swing, ...intra]) set.add(row.userId ?? null);
  return [...set];
}

export async function hasOpenExitAlertsRunToday(timezone = getConfigTimezone()): Promise<boolean> {
  const last = await cacheGetJson<{ date_key?: string; status?: string }>(
    cacheKey(CACHE_PREFIX.MORNING, LAST_KEY),
  );
  return last?.date_key === dateKeyInTimezone(timezone) && last.status === 'done';
}

/**
 * Scan open journal books, email EXIT alerts (deduped per position/action/day).
 */
export async function runOpenPositionExitAlerts(
  options: { force?: boolean; skipWeekendGate?: boolean } = {},
): Promise<OpenExitAlertBatchResult> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.exit_alerts;
  const tz = cfg?.timezone ?? getConfigTimezone();
  const dateKey = dateKeyInTimezone(tz);
  const session = nseSession();

  if (!options.force && cfg?.skip_weekends !== false && session.phase === 'weekend') {
    return {
      ok: true,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
      skipped_weekend: true,
    };
  }

  if (!isSignalEmailConfigured()) {
    return {
      ok: false,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
      error: 'SMTP not configured',
    };
  }

  if (process.env.EXIT_ALERT_EMAIL === '0') {
    return {
      ok: true,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
      error: 'EXIT_ALERT_EMAIL=0',
    };
  }

  if (getAlertsConfig().email?.exit_alerts === false) {
    return {
      ok: true,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
      error: 'alerts.yaml email.exit_alerts=false',
    };
  }

  if (!options.force && (await hasOpenExitAlertsRunToday(tz))) {
    return {
      ok: true,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
    };
  }

  await cacheSetJson(
    cacheKey(CACHE_PREFIX.MORNING, LAST_KEY),
    { date_key: dateKey, status: 'running', updated_at: new Date().toISOString() },
    2 * 86400,
  );

  try {
    const userIds = await userIdsWithOpenBooks();
    let swingExits = 0;
    let intraExits = 0;
    let emailsSent = 0;
    const collected: TradeSignalAlert[] = [];

    for (const userId of userIds) {
      const includeSwing = cfg?.include_swing !== false && getAlertsConfig().exit_alerts?.include_swing !== false;
      const includeIntra =
        cfg?.include_intraday !== false && getAlertsConfig().exit_alerts?.include_intraday !== false;
      const [swingAlerts, intraAlerts] = await Promise.all([
        includeSwing ? evaluateOpenSwingForUser(userId) : Promise.resolve([]),
        includeIntra ? evaluateOpenIntradayForUser(userId) : Promise.resolve([]),
      ]);
      swingExits += swingAlerts.length;
      intraExits += intraAlerts.length;
      const all = [...swingAlerts, ...intraAlerts].map((a) =>
        options.force ? { ...a, id: `${a.id}:force:${Date.now()}` } : a,
      );
      if (all.length === 0) continue;
      collected.push(...all);
      const sent = await notifyTradeSignalEmails(userId ?? undefined, all);
      if (sent) emailsSent += 1;
    }

    let whatsappSent = false;
    if (isWhatsAppFeatureEnabled('exit_alerts') && collected.length > 0) {
      const text = formatExitAlertsWhatsAppMessage({
        date_key: dateKey,
        swing_exits: swingExits,
        intraday_exits: intraExits,
        alerts: collected.map((a) => ({
          symbol: a.symbol,
          action: a.action_label || a.action,
          book: a.book,
          detail: a.detail,
        })),
      });
      const wa = await sendWhatsAppText(text, {
        dedupeKey: options.force ? `exit-alerts-force:${dateKey}:${Date.now()}` : `exit-alerts:${dateKey}`,
      });
      whatsappSent = wa.sent;
    }

    await cacheSetJson(
      cacheKey(CACHE_PREFIX.MORNING, LAST_KEY),
      {
        date_key: dateKey,
        status: 'done',
        swing_exits: swingExits,
        intraday_exits: intraExits,
        emails_sent: emailsSent,
        whatsapp_sent: whatsappSent,
        updated_at: new Date().toISOString(),
      },
      2 * 86400,
    );

    return {
      ok: true,
      date_key: dateKey,
      users: userIds.length,
      swing_exits: swingExits,
      intraday_exits: intraExits,
      emails_sent: emailsSent,
      whatsapp_sent: whatsappSent,
    };
  } catch (err) {
    return {
      ok: false,
      date_key: dateKey,
      users: 0,
      swing_exits: 0,
      intraday_exits: 0,
      emails_sent: 0,
      error: err instanceof Error ? err.message : 'Open exit alerts failed',
    };
  }
}

/** Worker tick — default 15:45 IST weekdays. */
export async function tickOpenPositionExitAlerts(now = new Date()): Promise<OpenExitAlertBatchResult | null> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.exit_alerts;
  if (!cfg?.enabled) return null;

  const tz = cfg.timezone || getConfigTimezone();
  if (await hasOpenExitAlertsRunToday(tz)) return null;
  if (!isDailyCronDue(cfg.cron, tz, now)) return null;

  return runOpenPositionExitAlerts();
}

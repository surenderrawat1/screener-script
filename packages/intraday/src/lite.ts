import { TIME_STOP_IST, TIME_STOP_MIN } from './session-clock.js';
import { closedTradeMetrics, summarizeClosedIntradayPositions } from './position-tracker.js';

export const INTRADAY_APP_SOURCE = 'nifty_intraday_app';

const SOURCE_LABELS: Record<string, string> = {
  nifty_intraday_app: 'App',
  nifty_scalp_5m: 'Scalp 5m',
  nifty_radar_5m: 'Radar 5m',
  nifty_radar_15m: 'Radar 15m',
  auto_radar: 'Radar',
  radar: 'Radar',
  manual: 'Manual',
  paper: 'Paper',
};

export function liteSourceLabel(source: string | null | undefined): string {
  const key = String(source ?? '').trim();
  if (!key) return '';
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  if (key.startsWith('fno_')) return key.replace('fno_', '').toUpperCase();
  return key.replace(/_/g, ' ');
}

export function liteDirection(analysis5: Record<string, unknown> | null | undefined) {
  const row = analysis5 ?? {};
  const label = String(row.direction_label ?? row.direction ?? '—');
  const confidence = Number(row.confidence ?? 0);
  const rawTone = String(row.tone ?? '');
  const tone =
    rawTone === 'bullish' || rawTone === 'bearish' || rawTone === 'success' || rawTone === 'warning'
      ? rawTone
      : label.toLowerCase().includes('bull')
        ? 'bullish'
        : label.toLowerCase().includes('bear')
          ? 'bearish'
          : 'neutral';
  return {
    label,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    tone,
  };
}

function liteExits(exits: unknown): Array<{ tier: string; price: number; rr: number | null }> {
  if (!Array.isArray(exits)) return [];
  return exits.slice(0, 3).map((ex) => {
    const row = ex && typeof ex === 'object' ? (ex as Record<string, unknown>) : {};
    const rr = row.rr;
    return {
      tier: String(row.tier ?? ''),
      price: Number(row.price ?? 0),
      rr: typeof rr === 'number' && Number.isFinite(rr) ? rr : null,
    };
  });
}

/** Trim scalp setup for mobile / PWA payloads (PHP IntradayPwa::liteScalpSetup). */
export function liteScalpSetup(setup: Record<string, unknown> | null | undefined) {
  const row = setup ?? {};
  const plan = row.plan && typeof row.plan === 'object' ? (row.plan as Record<string, unknown>) : null;
  let litePlan: Record<string, unknown> | null = null;
  if (plan && plan.ok) {
    const entry = plan.entry && typeof plan.entry === 'object' ? (plan.entry as Record<string, unknown>) : null;
    const stop =
      plan.stop_loss && typeof plan.stop_loss === 'object' ? (plan.stop_loss as Record<string, unknown>) : null;
    litePlan = {
      bias_label: String(plan.bias_label ?? ''),
      entry: entry
        ? { type: String(entry.type ?? ''), price: Number(entry.price ?? 0) }
        : null,
      stop_loss: stop ? { price: Number(stop.price ?? 0) } : null,
      exits: liteExits(plan.exits),
    };
  }
  const reasons = Array.isArray(row.gate_reasons) ? row.gate_reasons.map(String).slice(0, 4) : [];
  return {
    entry_allowed: Boolean(row.entry_allowed),
    summary: String(row.summary ?? ''),
    tone: String(row.tone ?? 'neutral'),
    preset_label: String(row.preset_label ?? '5m Trend scalp'),
    exit_label: String(row.exit_label ?? ''),
    gate_reasons: reasons,
    plan: litePlan,
  };
}

/** Trade plan for logging a scalp from the mobile app. */
export function liteLogPlan(scalpSetup: Record<string, unknown> | null | undefined) {
  if (!scalpSetup || !scalpSetup.entry_allowed) return null;
  const plan =
    scalpSetup.plan && typeof scalpSetup.plan === 'object'
      ? (scalpSetup.plan as Record<string, unknown>)
      : null;
  if (!plan || !plan.ok) return null;
  const entry = plan.entry && typeof plan.entry === 'object' ? (plan.entry as Record<string, unknown>) : null;
  const stop =
    plan.stop_loss && typeof plan.stop_loss === 'object' ? (plan.stop_loss as Record<string, unknown>) : null;
  if (!entry || !stop || Number(entry.price ?? 0) <= 0) return null;
  return {
    ok: true,
    bias: String(plan.bias ?? 'long'),
    action_label: String(plan.action_label ?? '5m trend scalp'),
    entry,
    stop_loss: stop,
    exits: Array.isArray(plan.exits) ? plan.exits.slice(0, 3) : [],
    preset_id: String(plan.preset_id ?? scalpSetup.preset_id ?? 'trend_scalp_5m'),
  };
}

export function liteJournal(closed: Record<string, unknown>[], recentLimit = 8) {
  const stats = summarizeClosedIntradayPositions(closed);
  const recent = closed.slice(0, Math.max(1, recentLimit)).map((pos) => {
    const trade = closedTradeMetrics(pos);
    const source = String(pos.source ?? '');
    return {
      instrument_label: String(pos.instrument_label ?? pos.instrument_id ?? ''),
      side: String(pos.side ?? ''),
      timeframe: String(pos.timeframe ?? ''),
      entry_price: Math.round(Number(pos.entry_price ?? 0) * 100) / 100,
      closed_price: Math.round(Number(pos.closed_price ?? 0) * 100) / 100,
      closed_reason: String(pos.closed_reason ?? ''),
      closed_at: String(pos.closed_at ?? ''),
      source,
      source_label: liteSourceLabel(source),
      net_pnl: trade ? Math.round(trade.net_pnl) : null,
      r_multiple: trade?.r_multiple ?? null,
    };
  });
  return {
    summary: {
      closed: stats.with_pnl,
      win_rate_pct: stats.win_rate_pct,
      wins: stats.wins,
      losses: stats.losses,
      avg_r: stats.avg_r,
      r_count: stats.r_count,
      total_net_pnl: stats.total_net_pnl,
      best_instrument: stats.best?.instrument ?? null,
      best_net_pnl: stats.best ? Math.round(stats.best.net_pnl) : null,
      worst_instrument: stats.worst?.instrument ?? null,
      worst_net_pnl: stats.worst ? Math.round(stats.worst.net_pnl) : null,
    },
    recent,
  };
}

export function liteOpenPosition(row: Record<string, unknown>) {
  const source = String(row.source ?? '');
  return {
    id: String(row.id ?? ''),
    instrument_id: String(row.instrument_id ?? ''),
    instrument_label: String(row.instrument_label ?? ''),
    side: String(row.side ?? 'long'),
    side_label: String(row.side_label ?? (row.side === 'short' ? 'Short' : 'Long')),
    timeframe: String(row.timeframe ?? ''),
    entry_price: Number(row.entry_price ?? 0),
    quantity: row.quantity ?? null,
    current_price: typeof row.current_price === 'number' ? row.current_price : null,
    pnl_inr: typeof row.pnl_inr === 'number' ? row.pnl_inr : null,
    gain_pct: typeof row.gain_pct === 'number' ? row.gain_pct : null,
    position_action: String(row.position_action ?? 'HOLD'),
    action_label: String(row.action_label ?? 'Hold'),
    exit_verdict: String(row.exit_verdict ?? 'HOLD'),
    source,
    source_label: liteSourceLabel(source),
  };
}

export function litePlaybook(playbook: Record<string, unknown> | null | undefined) {
  const row = playbook ?? {};
  return {
    actionable: Boolean(row.actionable),
    headline: String(row.headline ?? ''),
    headline_tone: String(row.headline_tone ?? 'neutral'),
  };
}

function istClock(now: Date): { minutes: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  return {
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
    weekday: get('weekday'),
  };
}

export function liteTimeStop(now = new Date()) {
  const { minutes, weekday } = istClock(now);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const sessionOpen = !weekend && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
  const flatten = sessionOpen && minutes >= TIME_STOP_MIN;
  return {
    ist: TIME_STOP_IST,
    flatten,
    message: flatten
      ? `Time stop ${TIME_STOP_IST} IST — flatten open intraday`
      : `Flatten by ${TIME_STOP_IST} IST`,
  };
}

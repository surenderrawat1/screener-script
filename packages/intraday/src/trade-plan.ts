import type { IntradayBar } from './nifty-direction.js';
import { atrPct14 } from '@sv/swing';

const TARGET_RR = [1, 2, 3];
const PARTIAL_PCTS = [40, 40, 20];

export function buildTradePlan(bars: IntradayBar[], analysis: Record<string, unknown>) {
  if (!analysis.ok) {
    return noTrade(String(analysis.message ?? 'Analysis unavailable'), analysis);
  }

  const interval = String(analysis.interval ?? '15m');
  const direction = String(analysis.direction ?? 'unknown');
  const price = Number(analysis.price ?? 0);
  const confidence = Number(analysis.confidence ?? 0);

  if (price <= 0 || !bars.length) {
    return noTrade('Invalid price or bars for trade plan.', analysis);
  }
  if (confidence < 42) {
    return noTrade(`Confidence too low for a structured intraday plan — wait for clearer ${interval} structure.`, analysis);
  }

  const lookback = interval === '5m' ? 12 : 8;
  const swing = swingLevels(bars, lookback);
  const session = sessionLevels(bars);
  const atr = atrFromBars(bars, price);

  if (['bullish', 'lean_bull'].includes(direction)) {
    return buildDirectional('long', bars, analysis, swing, session, atr, interval);
  }
  if (['bearish', 'lean_bear'].includes(direction)) {
    return buildDirectional('short', bars, analysis, swing, session, atr, interval);
  }
  if (direction === 'sideways') {
    return noTrade('Sideways — range fades deferred in v2 MVP.', analysis);
  }
  return noTrade('No directional bias — stand aside.', analysis);
}

function buildDirectional(
  side: 'long' | 'short',
  _bars: IntradayBar[],
  analysis: Record<string, unknown>,
  swing: { high: number; low: number },
  _session: { high: number; low: number; open: number },
  atr: number,
  interval: string,
) {
  const price = Number(analysis.price ?? 0);
  const ema9 = num(analysis.ema9);
  const ema21 = num(analysis.ema21);
  const confidence = Number(analysis.confidence ?? 0);
  const isLong = side === 'long';
  const direction = String(analysis.direction ?? '');

  let entryType = 'market';
  let entry = price;
  let entryNote = 'Enter at market on trigger';
  if (isLong) {
    if (direction === 'lean_bull' && ema9 !== null && price > ema9) {
      entryType = 'limit';
      entry = Math.round(ema9 * 100) / 100;
      entryNote = 'Buy pullback to EMA-9';
    } else if (price < swing.high * 0.999) {
      entryType = 'stop';
      entry = Math.round(swing.high * 100) / 100;
      entryNote = 'Buy breakout above swing high';
    }
    const stop = Math.min(
      entry - atr,
      ema21 !== null ? ema21 - atr * 0.5 : entry - atr,
      swing.low,
    );
    return packPlan(isLong, entryType, entry, entryNote, Math.round(stop * 100) / 100, confidence, interval, analysis);
  }

  if (direction === 'lean_bear' && ema9 !== null && price < ema9) {
    entryType = 'limit';
    entry = Math.round(ema9 * 100) / 100;
    entryNote = 'Sell rally to EMA-9';
  }
  const stop = Math.max(entry + atr, swing.high + atr * 0.5, ema21 !== null ? ema21 + atr * 0.5 : entry + atr);
  return packPlan(false, entryType, entry, entryNote, Math.round(stop * 100) / 100, confidence, interval, analysis);
}

function packPlan(
  isLong: boolean,
  entryType: string,
  entry: number,
  entryNote: string,
  stop: number,
  confidence: number,
  interval: string,
  analysis: Record<string, unknown>,
) {
  const riskPts = Math.abs(entry - stop);
  if (riskPts <= 0) return noTrade('Could not derive a valid risk distance.', analysis);

  const riskPct = Math.round((riskPts / entry) * 1000) / 1000;
  const exits = scaledExits(entry, stop, isLong);
  const trigger = entryTrigger(entryType, entry, Number(analysis.price ?? entry), isLong);

  return {
    ok: true,
    bias: isLong ? 'long' : 'short',
    bias_label: isLong ? 'Long bias' : 'Short bias',
    tone: isLong ? 'success' : 'danger',
    action: isLong ? 'ENTER_LONG' : 'ENTER_SHORT',
    action_label: isLong ? 'Enter long' : 'Enter short',
    confidence,
    trigger,
    entry_rules: [`${interval} directional plan`, entryNote],
    entry: { type: entryType, price: Math.round(entry * 100) / 100, condition: entryNote },
    stop_loss: { price: Math.round(stop * 100) / 100, pts: Math.round(riskPts * 100) / 100, pct: riskPct, label: 'Structural stop' },
    exits,
    exit_rules: ['T1 book 40% + breakeven', 'T2 book 40%', 'T3 trail remainder', 'Time exit 15:15 IST'],
    trail: { trail_pts: Math.round(riskPts * 1.5 * 100) / 100, label: 'Trail after T2' },
    time_stop_ist: '15:15',
    invalidation: isLong ? 'Close below stop on active timeframe' : 'Close above stop on active timeframe',
    interval,
  };
}

function scaledExits(entry: number, stop: number, isLong: boolean) {
  const risk = Math.abs(entry - stop);
  return TARGET_RR.map((rr, i) => {
    const px = isLong ? entry + risk * rr : entry - risk * rr;
    return {
      tier: `T${i + 1}`,
      price: Math.round(px * 100) / 100,
      rr,
      action: `Book ${PARTIAL_PCTS[i]}%`,
    };
  });
}

function entryTrigger(entryType: string, entry: number, price: number, _isLong: boolean) {
  const dist = Math.abs(price - entry);
  const actionable = entryType === 'market' || dist <= Math.max(2, price * 0.0005);
  return {
    status: actionable ? 'READY' : 'WAIT',
    label: actionable ? 'Ready' : 'Awaiting entry level',
    distance_pts: Math.round(dist * 100) / 100,
    actionable,
  };
}

function swingLevels(bars: IntradayBar[], lookback: number) {
  const slice = bars.slice(-lookback);
  return {
    high: Math.max(...slice.map((b) => b.high)),
    low: Math.min(...slice.map((b) => b.low)),
  };
}

function sessionLevels(bars: IntradayBar[]) {
  const last = bars[bars.length - 1];
  const sessionDate = (last.time_label ?? '').slice(0, 10);
  const sessionBars = bars.filter((b) => (b.time_label ?? '').startsWith(sessionDate));
  const use = sessionBars.length ? sessionBars : bars.slice(-26);
  return {
    high: Math.max(...use.map((b) => b.high)),
    low: Math.min(...use.map((b) => b.low)),
    open: use[0].open || use[0].close,
  };
}

function atrFromBars(bars: IntradayBar[], price: number): number {
  const pct = atrPct14(bars as Parameters<typeof atrPct14>[0]);
  if (pct !== null && pct > 0) return Math.round(price * (pct / 100) * 100) / 100;
  return Math.round(price * 0.0015 * 100) / 100;
}

function noTrade(message: string, analysis: Record<string, unknown>) {
  return {
    ok: false,
    message,
    bias: 'wait',
    bias_label: 'No trade',
    interval: analysis.interval ?? '15m',
    confidence: Number(analysis.confidence ?? 0),
    trigger: { status: 'BLOCKED', label: message, actionable: false },
    exit_rules: [],
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

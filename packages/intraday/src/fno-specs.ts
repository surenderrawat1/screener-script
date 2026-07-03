/** NSE F&O contract specs (lot sizes per NSE circulars; verify before live orders). */

export type ExpirySchedule = 'weekly' | 'monthly';

export interface FnoExpiryInfo {
  date: string;
  label: string;
  is_today: boolean;
  schedule: ExpirySchedule;
}

export interface FnoUnderlyingSpec {
  id: string;
  label: string;
  lot_size: number;
  strike_step: number;
  tick_size: number;
  /** Approx SPAN+Exposure margin % of contract value for 1 lot (educational). */
  margin_pct_est: number;
  weekly_expiry_dow: number; // 4 = Thursday (Nifty)
  expiry_schedule: ExpirySchedule;
  nse_underlying: string;
  kind: 'index' | 'stock';
}

export const FNO_UNDERLYINGS: Record<string, FnoUnderlyingSpec> = {
  nifty50: {
    id: 'nifty50',
    label: 'Nifty 50',
    lot_size: 75,
    strike_step: 50,
    tick_size: 0.05,
    margin_pct_est: 12.5,
    weekly_expiry_dow: 4,
    expiry_schedule: 'weekly',
    nse_underlying: 'NIFTY',
    kind: 'index',
  },
  banknifty: {
    id: 'banknifty',
    label: 'Bank Nifty',
    lot_size: 30,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 14.0,
    weekly_expiry_dow: 3,
    expiry_schedule: 'weekly',
    nse_underlying: 'BANKNIFTY',
    kind: 'index',
  },
  tcs: {
    id: 'tcs',
    label: 'TCS',
    lot_size: 175,
    strike_step: 50,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'TCS',
    kind: 'stock',
  },
  reliance: {
    id: 'reliance',
    label: 'Reliance',
    lot_size: 250,
    strike_step: 20,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'RELIANCE',
    kind: 'stock',
  },
  hdfcbank: {
    id: 'hdfcbank',
    label: 'HDFC Bank',
    lot_size: 550,
    strike_step: 20,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'HDFCBANK',
    kind: 'stock',
  },
  infy: {
    id: 'infy',
    label: 'Infosys',
    lot_size: 300,
    strike_step: 20,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'INFY',
    kind: 'stock',
  },
  icicibank: {
    id: 'icicibank',
    label: 'ICICI Bank',
    lot_size: 700,
    strike_step: 10,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'ICICIBANK',
    kind: 'stock',
  },
  itc: {
    id: 'itc',
    label: 'ITC',
    lot_size: 1600,
    strike_step: 5,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'ITC',
    kind: 'stock',
  },
  maruti: {
    id: 'maruti',
    label: 'Maruti',
    lot_size: 100,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 18,
    weekly_expiry_dow: 4,
    expiry_schedule: 'monthly',
    nse_underlying: 'MARUTI',
    kind: 'stock',
  },
};

export function hasFnoSupport(instrumentId: string): boolean {
  return Boolean(FNO_UNDERLYINGS[instrumentId.toLowerCase().trim()]);
}

export function fnoSpecForInstrument(instrumentId: string): FnoUnderlyingSpec | null {
  const key = instrumentId.toLowerCase().trim();
  return FNO_UNDERLYINGS[key] ?? null;
}

/** Round spot to nearest valid option strike. */
export function atmStrike(spot: number, step: number): number {
  if (step <= 0) return Math.round(spot);
  return Math.round(spot / step) * step;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatExpiryDate(d: Date): FnoExpiryInfo {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const date = `${y}-${m}-${day}`;
  const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today =
    nowIst.getFullYear() === y && nowIst.getMonth() + 1 === Number(m) && nowIst.getDate() === Number(day);
  return {
    date,
    label: `${day} ${MONTHS[d.getMonth()]} ${y}`,
    is_today: today,
    schedule: 'weekly',
  };
}

/** Next weekly expiry (IST) on or after today. */
export function nextWeeklyExpiry(
  spec: FnoUnderlyingSpec,
  from: Date = new Date(),
): FnoExpiryInfo {
  const ist = new Date(from.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const targetDow = spec.weekly_expiry_dow;
  const cursor = new Date(ist);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 8; i++) {
    if (cursor.getDay() === targetDow) {
      const out = formatExpiryDate(cursor);
      return { ...out, schedule: 'weekly' };
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { date: '', label: '—', is_today: false, schedule: 'weekly' };
}

/** Last Thursday of month on or after today (NSE stock monthly F&O). */
export function nextMonthlyExpiry(from: Date = new Date()): FnoExpiryInfo {
  const ist = new Date(from.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let year = ist.getFullYear();
  let month = ist.getMonth();

  for (let attempt = 0; attempt < 14; attempt++) {
    const last = new Date(year, month + 1, 0);
    while (last.getDay() !== 4) {
      last.setDate(last.getDate() - 1);
    }
    last.setHours(0, 0, 0, 0);
    const today = new Date(ist);
    today.setHours(0, 0, 0, 0);
    if (last >= today) {
      const out = formatExpiryDate(last);
      return { ...out, schedule: 'monthly' };
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return { date: '', label: '—', is_today: false, schedule: 'monthly' };
}

export function nextExpiry(spec: FnoUnderlyingSpec, from: Date = new Date()): FnoExpiryInfo {
  if (spec.expiry_schedule === 'monthly') return nextMonthlyExpiry(from);
  return nextWeeklyExpiry(spec, from);
}

/** Rough monthly future symbol label for UI (not a live contract resolver). */
export function futuresSymbolLabel(spec: FnoUnderlyingSpec, expiry?: { label: string }): string {
  const exp = expiry?.label ?? 'current';
  return `${spec.nse_underlying} ${exp} FUT`;
}

export function optionSymbolLabel(
  spec: FnoUnderlyingSpec,
  strike: number,
  optionType: 'CE' | 'PE',
  expiry?: { label: string },
): string {
  const exp = expiry?.label ?? spec.expiry_schedule === 'monthly' ? 'monthly' : 'weekly';
  return `${spec.nse_underlying} ${exp} ${strike} ${optionType}`;
}

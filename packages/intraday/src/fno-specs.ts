/** NSE F&O contract specs (lot sizes per NSE circulars; verify before live orders). */

export type ExpirySchedule = 'weekly' | 'monthly';

/** NSE F&O weekday since 1 Sep 2025 — Tuesday. BSE Sensex remains Thursday. */
export const NSE_FNO_EXPIRY_DOW = 2;
export const BSE_FNO_EXPIRY_DOW = 4;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface FnoExpiryInfo {
  date: string;
  label: string;
  weekday: string;
  is_today: boolean;
  schedule: ExpirySchedule;
  holiday_shifted: boolean;
  scheduled_date: string;
}

export interface FnoUnderlyingSpec {
  id: string;
  label: string;
  lot_size: number;
  strike_step: number;
  tick_size: number;
  /** Approx SPAN+Exposure margin % of contract value for 1 lot (educational). */
  margin_pct_est: number;
  /** 0=Sun … 6=Sat. NSE F&O = Tuesday. */
  expiry_dow: number;
  expiry_schedule: ExpirySchedule;
  nse_underlying: string;
  kind: 'index' | 'stock';
}

export const FNO_UNDERLYINGS: Record<string, FnoUnderlyingSpec> = {
  nifty50: {
    id: 'nifty50',
    label: 'Nifty 50',
    lot_size: 65,
    strike_step: 50,
    tick_size: 0.05,
    margin_pct_est: 12.5,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'weekly',
    nse_underlying: 'NIFTY',
    kind: 'index',
  },
  sensex: {
    id: 'sensex',
    label: 'Sensex',
    lot_size: 20,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 12.5,
    expiry_dow: BSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'weekly',
    nse_underlying: 'SENSEX',
    kind: 'index',
  },
  finnifty: {
    id: 'finnifty',
    label: 'Fin Nifty',
    lot_size: 60,
    strike_step: 50,
    tick_size: 0.05,
    margin_pct_est: 13.5,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'monthly',
    nse_underlying: 'FINNIFTY',
    kind: 'index',
  },
  banknifty: {
    id: 'banknifty',
    label: 'Bank Nifty',
    lot_size: 30,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 14.0,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'monthly',
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
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'monthly',
    nse_underlying: 'TCS',
    kind: 'stock',
  },
  reliance: {
    id: 'reliance',
    label: 'Reliance',
    lot_size: 500,
    strike_step: 20,
    tick_size: 0.05,
    margin_pct_est: 18,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
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
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'monthly',
    nse_underlying: 'HDFCBANK',
    kind: 'stock',
  },
  infy: {
    id: 'infy',
    label: 'Infosys',
    lot_size: 400,
    strike_step: 20,
    tick_size: 0.05,
    margin_pct_est: 18,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
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
    expiry_dow: NSE_FNO_EXPIRY_DOW,
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
    expiry_dow: NSE_FNO_EXPIRY_DOW,
    expiry_schedule: 'monthly',
    nse_underlying: 'ITC',
    kind: 'stock',
  },
  maruti: {
    id: 'maruti',
    label: 'Maruti',
    lot_size: 50,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 18,
    expiry_dow: NSE_FNO_EXPIRY_DOW,
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

/**
 * NSE cash + F&O holidays (Zerodha/Groww 2026 circulars).
 * Expiry on a holiday or weekend shifts to the previous trading day.
 */
export const NSE_HOLIDAYS_YMD = new Set([
  '2026-01-15',
  '2026-01-26',
  '2026-03-03',
  '2026-03-26',
  '2026-03-31',
  '2026-04-03',
  '2026-04-14',
  '2026-05-01',
  '2026-05-28',
  '2026-06-26',
  '2026-09-14',
  '2026-10-02',
  '2026-10-20',
  '2026-11-10',
  '2026-11-24',
  '2026-12-25',
]);

export function istYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dowFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isNseTradingDay(ymd: string): boolean {
  const dow = dowFromYmd(ymd);
  if (dow === 0 || dow === 6) return false;
  return !NSE_HOLIDAYS_YMD.has(ymd);
}

/** Walk back from a scheduled weekday until a cash/F&O session exists. */
export function adjustExpiryToTradingDay(scheduledYmd: string): { date: string; holiday_shifted: boolean } {
  let cursor = scheduledYmd;
  for (let i = 0; i < 10; i++) {
    if (isNseTradingDay(cursor)) {
      return { date: cursor, holiday_shifted: cursor !== scheduledYmd };
    }
    cursor = addDaysYmd(cursor, -1);
  }
  return { date: scheduledYmd, holiday_shifted: false };
}

function formatExpiryYmd(ymd: string, schedule: ExpirySchedule, asOfYmd: string, scheduledYmd: string): FnoExpiryInfo {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = dowFromYmd(ymd);
  const day = String(d).padStart(2, '0');
  return {
    date: ymd,
    label: `${day} ${MONTHS[m - 1]} ${y}`,
    weekday: WEEKDAY_SHORT[dow] ?? '',
    is_today: ymd === asOfYmd,
    schedule,
    holiday_shifted: scheduledYmd !== ymd,
    scheduled_date: scheduledYmd,
  };
}

function emptyExpiry(schedule: ExpirySchedule): FnoExpiryInfo {
  return {
    date: '',
    label: '—',
    weekday: '',
    is_today: false,
    schedule,
    holiday_shifted: false,
    scheduled_date: '',
  };
}

function nextWeekdayOnOrAfter(fromYmd: string, targetDow: number): string {
  let cursor = fromYmd;
  for (let i = 0; i < 8; i++) {
    if (dowFromYmd(cursor) === targetDow) return cursor;
    cursor = addDaysYmd(cursor, 1);
  }
  return fromYmd;
}

function lastWeekdayOfMonth(year: number, monthIndex: number, targetDow: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  let cursor = last;
  for (let i = 0; i < 7; i++) {
    if (dowFromYmd(cursor) === targetDow) return cursor;
    cursor = addDaysYmd(cursor, -1);
  }
  return last;
}

/** Next weekly expiry (IST) on or after today — NSE Tuesday, holiday-adjusted. */
export function nextWeeklyExpiry(
  spec: FnoUnderlyingSpec,
  from: Date = new Date(),
): FnoExpiryInfo {
  const today = istYmd(from);
  const targetDow = spec.expiry_dow ?? NSE_FNO_EXPIRY_DOW;
  let cursor = today;
  for (let i = 0; i < 21; i++) {
    const scheduled = nextWeekdayOnOrAfter(cursor, targetDow);
    const { date: actual } = adjustExpiryToTradingDay(scheduled);
    if (actual >= today) {
      return formatExpiryYmd(actual, 'weekly', today, scheduled);
    }
    cursor = addDaysYmd(scheduled, 1);
  }
  return emptyExpiry('weekly');
}

/** Last Tuesday of month on or after today (NSE monthly F&O since Sep 2025). */
export function nextMonthlyExpiry(
  from: Date = new Date(),
  expiryDow = NSE_FNO_EXPIRY_DOW,
): FnoExpiryInfo {
  const today = istYmd(from);
  const [y0, m0] = today.split('-').map(Number);
  let year = y0;
  let monthIndex = m0 - 1;

  for (let attempt = 0; attempt < 14; attempt++) {
    const scheduled = lastWeekdayOfMonth(year, monthIndex, expiryDow);
    const { date: actual } = adjustExpiryToTradingDay(scheduled);
    if (actual >= today) {
      return formatExpiryYmd(actual, 'monthly', today, scheduled);
    }
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return emptyExpiry('monthly');
}

export function nextExpiry(spec: FnoUnderlyingSpec, from: Date = new Date()): FnoExpiryInfo {
  if (spec.expiry_schedule === 'monthly') return nextMonthlyExpiry(from, spec.expiry_dow);
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
  const exp = expiry?.label ?? (spec.expiry_schedule === 'monthly' ? 'monthly' : 'weekly');
  return `${spec.nse_underlying} ${exp} ${strike} ${optionType}`;
}

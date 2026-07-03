/** NSE cash session phases — parity with PHP PriceFreshness::nseSession(). */

export const NSE_PHASE = {
  PRE: 'pre',
  OPEN: 'open',
  POST: 'post',
  WEEKEND: 'weekend',
} as const;

export type NsePhase = (typeof NSE_PHASE)[keyof typeof NSE_PHASE];

export interface NseSession {
  phase: NsePhase;
  label: string;
  message: string;
  live_quotes: boolean;
  ist_time: string;
  ist_date: string;
}

export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;

export function nseSession(now: Date = new Date()): NseSession {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const weekday = get('weekday');
  const istTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const istDate = `${get('year')}-${get('month')}-${get('day')}`;
  const minutes = hour * 60 + minute;

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  if (isWeekend) {
    return {
      phase: NSE_PHASE.WEEKEND,
      label: 'Weekend',
      message: 'NSE closed — swing uses last EOD close; intraday shows last session bar.',
      live_quotes: false,
      ist_time: istTime,
      ist_date: istDate,
    };
  }

  if (minutes < MARKET_OPEN_MIN) {
    return {
      phase: NSE_PHASE.PRE,
      label: 'Pre-market',
      message: 'Cash session opens 09:15 IST — prices are last close until then.',
      live_quotes: false,
      ist_time: istTime,
      ist_date: istDate,
    };
  }

  if (minutes >= MARKET_CLOSE_MIN) {
    return {
      phase: NSE_PHASE.POST,
      label: 'Closed',
      message: 'NSE cash session ended 15:30 IST — live intraday resumes next session.',
      live_quotes: false,
      ist_time: istTime,
      ist_date: istDate,
    };
  }

  return {
    phase: NSE_PHASE.OPEN,
    label: 'Open',
    message: 'NSE cash session open — intraday quotes refresh during market hours.',
    live_quotes: true,
    ist_time: istTime,
    ist_date: istDate,
  };
}

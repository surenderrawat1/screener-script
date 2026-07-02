export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const DEFAULT_MIN_ENTRY_MIN = 10 * 60 + 15;
export const DEFAULT_LAST_ENTRY_MIN = 14 * 60 + 45;
export const TIME_STOP_MIN = 15 * 60 + 15;

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function entryWindow(barMinutes: number, options: Record<string, unknown> = {}) {
  const minEntry = Number(options.min_entry_min_ist ?? 0);
  const lastEntry = Number(options.last_entry_min_ist ?? DEFAULT_LAST_ENTRY_MIN);

  if (barMinutes <= 0) {
    return { open: false, label: 'Unknown', message: 'Bar time unavailable' };
  }
  if (minEntry > 0 && barMinutes < minEntry) {
    return {
      open: false,
      label: 'Pre-window',
      message: `Entries open at ${formatMinutes(minEntry)} IST (opening range forming)`,
    };
  }
  if (barMinutes >= lastEntry) {
    return {
      open: false,
      label: 'Closed',
      message: `Past last entry cut-off ${formatMinutes(lastEntry)} IST`,
    };
  }
  return {
    open: true,
    label: 'Open',
    message: `Entry window open until ${formatMinutes(lastEntry)} IST`,
  };
}

export function gateReasons(barMinutes: number, options: Record<string, unknown>): string[] {
  const window = entryWindow(barMinutes, options);
  return window.open ? [] : [window.message];
}

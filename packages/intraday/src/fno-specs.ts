/** NSE index F&O contract specs (lot sizes per NSE circulars; verify before live orders). */

export interface FnoUnderlyingSpec {
  id: string;
  label: string;
  lot_size: number;
  strike_step: number;
  tick_size: number;
  /** Approx SPAN+Exposure margin % of contract value for 1 lot (educational). */
  margin_pct_est: number;
  weekly_expiry_dow: number; // 4 = Thursday (Nifty)
  nse_underlying: string;
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
    nse_underlying: 'NIFTY',
  },
  banknifty: {
    id: 'banknifty',
    label: 'Bank Nifty',
    lot_size: 30,
    strike_step: 100,
    tick_size: 0.05,
    margin_pct_est: 14.0,
    weekly_expiry_dow: 3, // Wednesday for BANKNIFTY weekly
    nse_underlying: 'BANKNIFTY',
  },
};

export function fnoSpecForInstrument(instrumentId: string): FnoUnderlyingSpec {
  const key = instrumentId.toLowerCase().trim();
  return FNO_UNDERLYINGS[key] ?? FNO_UNDERLYINGS.nifty50;
}

/** Round spot to nearest valid option strike. */
export function atmStrike(spot: number, step: number): number {
  if (step <= 0) return Math.round(spot);
  return Math.round(spot / step) * step;
}

/** Next weekly expiry (IST) on or after today. */
export function nextWeeklyExpiry(
  spec: FnoUnderlyingSpec,
  from: Date = new Date(),
): { date: string; label: string; is_today: boolean } {
  const ist = new Date(from.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const targetDow = spec.weekly_expiry_dow;
  let cursor = new Date(ist);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 8; i++) {
    const dow = cursor.getDay();
    if (dow === targetDow) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const date = `${y}-${m}-${d}`;
      const today =
        ist.getFullYear() === y && ist.getMonth() + 1 === Number(m) && ist.getDate() === Number(d);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${d} ${months[cursor.getMonth()]} ${y}`;
      return { date, label, is_today: today };
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { date: '', label: '—', is_today: false };
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
  const exp = expiry?.label ?? 'weekly';
  return `${spec.nse_underlying} ${exp} ${strike} ${optionType}`;
}

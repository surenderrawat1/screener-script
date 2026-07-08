import type { OhlcBar } from './types.js';
import { sma, atrPct14 } from './ta-helper.js';

export const PROXY_SYMBOL = 'NIFTYBEES';

/** PHP parity: "Bear (NIFTYBEES)" in universe scan KPI. */
export function formatRegimeLabel(regime?: Record<string, unknown> | null): string {
  if (!regime?.label) return '—';
  const label = String(regime.label);
  const proxy = String(regime.proxy ?? PROXY_SYMBOL);
  return `${label} (${proxy})`;
}

export function entry52wBand(regime?: Record<string, unknown> | null) {
  const min = Number(regime?.pct_52w_min ?? 32);
  const max = Number(regime?.pct_52w_max ?? 68);
  return { min, max };
}

export function defaultRegime(reason = 'default'): Record<string, unknown> {
  return {
    key: 'sideways',
    label: 'Sideways (default)',
    bull: false,
    bear: false,
    strong_bear: false,
    sideways: true,
    high_vol: false,
    low_vol: false,
    pct_52w_min: 32,
    pct_52w_max: 68,
    blocks_strict_enter: false,
    proxy: PROXY_SYMBOL,
    reason,
  };
}

function returnOverSessions(bars: OhlcBar[], sessions: number): number {
  if (bars.length <= sessions) return 0;
  const end = bars[bars.length - 1]?.close ?? 0;
  const start = bars[bars.length - 1 - sessions]?.close ?? 0;
  if (end <= 0 || start <= 0) return 0;
  return ((end - start) / start) * 100;
}

export function regimeFromBars(bars: OhlcBar[], asOfDate = ''): Record<string, unknown> {
  if (bars.length === 0) return defaultRegime('empty_bars');

  const n = bars.length;
  const price = Number(bars[n - 1]?.close ?? 0);
  const date =
    asOfDate ||
    String(bars[n - 1]?.time ?? '')
      .slice(0, 10);

  const closes = bars.map((b) => b.close);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atrPct = atrPct14(bars);

  const ret20 = returnOverSessions(bars, 20);
  const ret60 = returnOverSessions(bars, 60);

  const bull =
    price > 0 &&
    sma200 !== null &&
    sma200 > 0 &&
    price >= sma200 &&
    sma50 !== null &&
    sma50 >= sma200 &&
    ret20 > 0;

  const bear =
    price > 0 && sma200 !== null && sma200 > 0 && (price < sma200 || (sma50 !== null && sma50 < sma200));

  const deepBelow200 = sma200 !== null && sma200 > 0 && price > 0 && price < sma200 * 0.95;
  const strongBear = bear && (ret60 < -2 || ret20 < -3 || deepBelow200);

  let sideways = !bull && !bear && Math.abs(ret60) < 5;
  if (!bull && !bear && !sideways) sideways = Math.abs(ret60) < 8;

  const highVol = atrPct !== null && atrPct >= 2.5;
  const lowVol = atrPct !== null && atrPct < 1.2;

  let key = 'neutral';
  let label = 'Neutral';
  if (bear) {
    key = 'bear';
    label = 'Bear';
  } else if (bull) {
    key = 'bull';
    label = 'Bull';
  } else if (sideways) {
    key = 'sideways';
    label = 'Sideways';
  }

  const bands =
    key === 'bull'
      ? { min: 25, max: 75 }
      : key === 'bear'
        ? { min: 20, max: 55 }
        : key === 'sideways'
          ? { min: 30, max: 65 }
          : { min: 32, max: 68 };

  return {
    key,
    label,
    bull,
    bear,
    strong_bear: strongBear,
    sideways,
    high_vol: highVol,
    low_vol: lowVol,
    pct_52w_min: bands.min,
    pct_52w_max: bands.max,
    blocks_strict_enter: strongBear,
    as_of_date: date,
    proxy: PROXY_SYMBOL,
    atr_pct: atrPct,
    return_20d_pct: Math.round(ret20 * 100) / 100,
    return_60d_pct: Math.round(ret60 * 100) / 100,
  };
}

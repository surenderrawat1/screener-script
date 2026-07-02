import type { OhlcBar } from './types.js';

export function priceActionMetrics(bars: OhlcBar[]) {
  if (bars.length < 10) return emptyMetrics();

  const slice = bars.slice(-55);
  const lows = slice.map((b) => b.low).filter((v) => v > 0);
  const highs = slice.map((b) => b.high).filter((v) => v > 0);
  const lastLow = lows.length >= 2 ? Math.min(...lows.slice(-20)) : null;
  const prevLow = lows.length >= 4 ? Math.min(...lows.slice(-40, -20)) : null;
  const lastHigh = highs.length >= 2 ? Math.max(...highs.slice(-20)) : null;
  const prevHigh = highs.length >= 4 ? Math.max(...highs.slice(-40, -20)) : null;

  const higherLow = lastLow !== null && prevLow !== null && lastLow > prevLow;
  const higherHigh = lastHigh !== null && prevHigh !== null && lastHigh > prevHigh;

  const curr = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  const bullishCandle = prev ? curr.close > curr.open && curr.close > prev.close : curr.close > curr.open;
  const supportRejection = curr.low < curr.open && curr.close > (curr.high + curr.low) / 2;
  const entrySignal = higherLow && (higherHigh || bullishCandle || supportRejection);

  return {
    has_data: true,
    higher_low: higherLow,
    higher_high: higherHigh,
    bullish_candle: bullishCandle,
    support_rejection: supportRejection,
    entry_signal: entrySignal,
    broke_swing_high: higherHigh,
    structure_detail: higherLow ? 'Higher low — pullback holding support.' : 'No clear HL structure.',
    candle_detail: bullishCandle ? 'Bullish session.' : '',
  };
}

function emptyMetrics() {
  return {
    has_data: false,
    higher_low: false,
    higher_high: false,
    bullish_candle: false,
    support_rejection: false,
    entry_signal: false,
    broke_swing_high: false,
    structure_detail: 'Insufficient bars for swing structure.',
    candle_detail: '',
  };
}

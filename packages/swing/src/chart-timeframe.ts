/** Swing chart timeframes — parity with PHP TechnicalAnalysisHelper::normalizeSwingChartTimeframe(). */

export type SwingChartTimeframe = '6mo' | '1y' | '2y' | '5y' | '1h';

export const SWING_CHART_TIMEFRAMES: Array<{ id: SwingChartTimeframe; label: string }> = [
  { id: '6mo', label: '6M daily' },
  { id: '1y', label: '1Y daily' },
  { id: '2y', label: '2Y daily' },
  { id: '5y', label: '5Y daily' },
  { id: '1h', label: '1H (60d)' },
];

export function normalizeSwingChartTimeframe(timeframe: string): SwingChartTimeframe {
  const tf = timeframe.toLowerCase().trim();
  if (tf === '6m' || tf === '6mo') return '6mo';
  if (tf === '1y' || tf === '12m') return '1y';
  if (tf === '5y') return '5y';
  if (tf === '1h' || tf === '60d') return '1h';
  return '2y';
}

export function swingChartYahooParams(timeframe: SwingChartTimeframe): { interval: string; range: string } {
  if (timeframe === '1h') return { interval: '60m', range: '60d' };
  return { interval: '1d', range: timeframe };
}

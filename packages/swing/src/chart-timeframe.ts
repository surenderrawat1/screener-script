/** Swing chart timeframes — daily ranges + intraday + weekly (MTF parity with chart patterns). */

export type SwingChartTimeframe = '5m' | '15m' | '1h' | '4h' | '6mo' | '1y' | '2y' | '5y' | '1w';

export type SwingChartTimeframeGroup = 'intraday' | 'daily' | 'weekly';

export interface SwingChartTimeframeOption {
  id: SwingChartTimeframe;
  label: string;
  group: SwingChartTimeframeGroup;
}

export const SWING_CHART_TIMEFRAMES: SwingChartTimeframeOption[] = [
  { id: '5m', label: '5m (5d)', group: 'intraday' },
  { id: '15m', label: '15m (5d)', group: 'intraday' },
  { id: '1h', label: '1H (60d)', group: 'intraday' },
  { id: '4h', label: '4H (60d)', group: 'intraday' },
  { id: '6mo', label: '6M daily', group: 'daily' },
  { id: '1y', label: '1Y daily', group: 'daily' },
  { id: '2y', label: '2Y daily', group: 'daily' },
  { id: '5y', label: '5Y daily', group: 'daily' },
  { id: '1w', label: '1W (5y)', group: 'weekly' },
];

export function isSwingChartIntraday(timeframe: SwingChartTimeframe): boolean {
  return timeframe === '5m' || timeframe === '15m' || timeframe === '1h' || timeframe === '4h';
}

export function normalizeSwingChartTimeframe(timeframe: string): SwingChartTimeframe {
  const tf = timeframe.toLowerCase().trim();
  if (tf === '5m') return '5m';
  if (tf === '15m') return '15m';
  if (tf === '4h' || tf === '240m') return '4h';
  if (tf === '1h' || tf === '60d' || tf === '60m') return '1h';
  if (tf === '1w' || tf === '1wk' || tf === 'weekly') return '1w';
  if (tf === '6m' || tf === '6mo') return '6mo';
  if (tf === '1y' || tf === '12m') return '1y';
  if (tf === '5y') return '5y';
  return '2y';
}

export function swingChartYahooParams(timeframe: SwingChartTimeframe): { interval: string; range: string } {
  switch (timeframe) {
    case '5m':
      return { interval: '5m', range: '5d' };
    case '15m':
      return { interval: '15m', range: '5d' };
    case '1h':
      return { interval: '60m', range: '60d' };
    case '4h':
      return { interval: '240m', range: '60d' };
    case '1w':
      return { interval: '1wk', range: '5y' };
    default:
      return { interval: '1d', range: timeframe };
  }
}

export function swingChartMinBars(timeframe: SwingChartTimeframe): number {
  if (timeframe === '5m' || timeframe === '15m') return 20;
  if (isSwingChartIntraday(timeframe)) return 24;
  if (timeframe === '1w') return 20;
  return 30;
}

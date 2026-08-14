import { getSwingChartPayload } from '@sv/data-adapters';
import { normalizeSwingChartTimeframe } from '@sv/swing';

export async function getSwingChart(symbol: string, timeframe = '2y', refresh = false) {
  const normalized = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  const tf = normalizeSwingChartTimeframe(timeframe);
  if (normalized.length < 2) {
    return {
      ok: false,
      symbol: normalized,
      timeframe: tf,
      error: `Symbol "${normalized || '?'}" is too short. Enter a full NSE ticker (e.g. TCS, SUNPHARMA) and click Evaluate.`,
      chart: null,
    };
  }
  const chart = await getSwingChartPayload(normalized, tf, refresh);
  if (!chart) {
    return {
      ok: false,
      symbol: normalized,
      timeframe: tf,
      error: `No chart data for ${normalized} on NSE (.NS / .BO). Verify the ticker, then click Refresh on the chart.`,
      chart: null,
    };
  }
  return {
    ok: true,
    symbol: normalized,
    timeframe: tf,
    interval: chart.interval,
    range: chart.range,
    bar_count: chart.bars.length,
    fetched_at: chart.fetched_at,
    chart,
  };
}

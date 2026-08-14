import {
  listChartPatternScanDates,
  listChartPatternScanRuns,
  triggerChartPatternScan,
} from '@sv/data-adapters';

export { listChartPatternScanDates, listChartPatternScanRuns };

export async function runChartPatternScanJob(body: {
  universe?: string;
  refresh?: boolean;
  max_symbols?: number;
  wait?: boolean;
}) {
  return triggerChartPatternScan({
    universe: body.universe,
    refresh: body.refresh,
    maxSymbols: body.max_symbols,
    wait: body.wait === true,
    trigger: 'admin',
  });
}

import { fetchInstrumentIntradayChart } from '@sv/data-adapters';
import { backtestIntradayCombo, resolveInstrument } from '@sv/intraday';

export interface IntradayBacktestInput {
  instrument?: string;
  interval?: '5m' | '15m';
  mode?: 'single' | 'combo_compare';
  preset_id?: string;
  days?: number;
  refresh?: boolean;
}

export async function runIntradayBacktestJob(input: IntradayBacktestInput) {
  const instrumentId = (input.instrument ?? 'nifty50').trim();
  const meta = resolveInstrument(instrumentId);
  if (!meta) throw new Error(`Unknown instrument: ${instrumentId}`);

  const range = (input.days ?? 60) >= 30 ? '60d' : '5d';
  const refresh = Boolean(input.refresh);

  const [chart5, chart15] = await Promise.all([
    fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '5m', refresh, range),
    fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '15m', refresh, range),
  ]);

  if (!chart5?.bars?.length) {
    throw new Error('Insufficient 5m chart data for backtest');
  }

  const result = backtestIntradayCombo(
    { bars: chart5.bars, closes: chart5.closes, interval: '5m' },
    { bars: chart15?.bars ?? [], closes: chart15?.closes, interval: '15m' },
    {
      interval: input.interval === '15m' ? '15m' : '5m',
      mode: input.mode ?? 'combo_compare',
      preset_id: input.preset_id,
    },
  );

  return {
    instrument: instrumentId,
    instrument_label: meta.label,
    range,
    ...result,
  };
}

import { fetchInstrumentIntradayChart } from '@sv/data-adapters';
import { backtestIntradayCombo, resolveInstrument, presetOptions } from '@sv/intraday';

async function runOne(instrumentId: string, interval: '5m' | '15m') {
  const meta = resolveInstrument(instrumentId);
  if (!meta) throw new Error(instrumentId);
  const [chart5, chart15] = await Promise.all([
    fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '5m', true, '60d'),
    fetchInstrumentIntradayChart(meta.cache_key, meta.yahoo_symbols, meta.label, '15m', true, '60d'),
  ]);
  if (!chart5?.bars?.length) throw new Error('No 5m bars');
  const result = backtestIntradayCombo(
    { bars: chart5.bars, closes: chart5.closes, interval: '5m' },
    { bars: chart15?.bars ?? [], closes: chart15?.closes, interval: '15m' },
    { interval, mode: 'combo_compare' },
  );
  const focus = new Set([
    'ma20_stratzy',
    'production',
    'cfa_precision',
    'trend_scalp_5m',
    'quality',
    'baseline',
    'sniper',
    'strict_mtf',
  ]);
  const rows = result.presets
    .filter((p) => focus.has(p.preset_id) || p.economic_pass || p.accuracy_pass)
    .map((p) => ({
      id: p.preset_id,
      trades: p.trades,
      stratzy_wr: p.win_rate_pct,
      scaled_wr: p.scaled_win_rate_pct,
      net_wr: p.net_win_rate_pct,
      classic_avg_r: p.classic_avg_r,
      gross_e: p.expectancy_r,
      net_e: p.net_expectancy_r,
      pf: p.profit_factor,
      econ: p.economic_status,
      wr_gate: p.accuracy_status,
      sample_paths: (p.trades_sample ?? []).map((t) => t.exit_path),
    }));
  const stratzy = result.presets.find((p) => p.preset_id === 'ma20_stratzy') ?? null;
  return {
    instrument: meta.label,
    instrument_id: instrumentId,
    interval,
    bars_5m: result.bars_5m,
    bars_15m: result.bars_15m,
    sessions: result.sessions,
    economic_pass_count: result.economic.pass_count,
    high_accuracy_pass_count: result.high_accuracy.pass_count,
    best: result.economic.best_preset_id,
    stratzy_config: {
      exit_profile: presetOptions('ma20_stratzy').exit_profile,
      max_sma20_extension_pct: presetOptions('ma20_stratzy').max_sma20_extension_pct,
      min_mtf_deploy: presetOptions('ma20_stratzy').min_mtf_deploy,
      max_trades_per_session: presetOptions('ma20_stratzy').max_trades_per_session,
    },
    stratzy: stratzy
      ? {
          trades: stratzy.trades,
          wins: stratzy.wins,
          losses: stratzy.losses,
          stratzy_wr: stratzy.win_rate_pct,
          scaled_wr: stratzy.scaled_win_rate_pct,
          net_wr: stratzy.net_win_rate_pct,
          classic_avg_r: stratzy.classic_avg_r,
          gross_e: stratzy.expectancy_r,
          net_e: stratzy.net_expectancy_r,
          pf: stratzy.profit_factor,
          econ: stratzy.economic_status,
          wr_gate: stratzy.accuracy_status,
          sample: stratzy.trades_sample,
        }
      : null,
    rows,
  };
}

const jobs: Array<[string, '5m' | '15m']> = [
  ['nifty50', '5m'],
  ['nifty50', '15m'],
  ['banknifty', '5m'],
  ['banknifty', '15m'],
];

const out = [];
for (const [id, iv] of jobs) {
  try {
    const r = await runOne(id, iv);
    out.push(r);
    console.error(`OK ${id} ${iv} stratzy trades=${r.stratzy?.trades ?? 0} wr=${r.stratzy?.stratzy_wr}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`FAIL ${id} ${iv}`, msg);
    out.push({ instrument_id: id, interval: iv, error: msg });
  }
}

console.log(JSON.stringify(out, null, 2));

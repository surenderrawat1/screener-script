import { runIntradayBacktestJob } from '../src/services/intraday-backtest.js';
import { presetOptions } from '@sv/intraday';

/** Default: paper book only (15m). Pass --all for 5m+15m matrix. */
const allLegs = process.argv.includes('--all');
const jobs: Array<{ instrument: string; interval: '5m' | '15m' }> = allLegs
  ? [
      { instrument: 'nifty50', interval: '5m' },
      { instrument: 'nifty50', interval: '15m' },
      { instrument: 'banknifty', interval: '5m' },
      { instrument: 'banknifty', interval: '15m' },
    ]
  : [
      { instrument: 'nifty50', interval: '15m' },
      { instrument: 'banknifty', interval: '15m' },
    ];

const out = [];
for (const job of jobs) {
  try {
    const result = await runIntradayBacktestJob({
      ...job,
      mode: 'single',
      preset_id: 'ma20_stratzy',
      days: 60,
      refresh: false,
    });
    const stratzy = result.presets.find((p) => p.preset_id === 'ma20_stratzy') ?? result.presets[0] ?? null;
    const paths: Record<string, number> = {};
    for (const t of stratzy?.trades_sample ?? []) {
      const k = String(t.exit_path ?? 'na');
      paths[k] = (paths[k] ?? 0) + 1;
    }
    console.error(
      `OK ${result.instrument} ${result.interval} stratzy n=${stratzy?.trades} wr=${stratzy?.win_rate_pct} netE=${stratzy?.net_expectancy_r} pf=${stratzy?.profit_factor} econ=${stratzy?.economic_status}`,
    );
    out.push({
      instrument: result.instrument_label,
      instrument_id: result.instrument,
      interval: result.interval,
      bars_5m: result.bars_5m,
      bars_15m: result.bars_15m,
      sessions: result.sessions,
      economic_pass_count: result.economic.pass_count,
      high_accuracy_pass_count: result.high_accuracy.pass_count,
      stratzy_config: {
        exit_profile: presetOptions('ma20_stratzy').exit_profile,
        last_entry_min_ist: presetOptions('ma20_stratzy').last_entry_min_ist,
        min_mtf_deploy: presetOptions('ma20_stratzy').min_mtf_deploy,
        min_confidence: presetOptions('ma20_stratzy').min_confidence,
        min_net_score: presetOptions('ma20_stratzy').min_net_score,
        require_ema_stack: presetOptions('ma20_stratzy').require_ema_stack,
        require_strong_direction: presetOptions('ma20_stratzy').require_strong_direction,
        min_setup_grade: presetOptions('ma20_stratzy').min_setup_grade,
        max_sma20_extension_pct: presetOptions('ma20_stratzy').max_sma20_extension_pct,
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
            path_counts: paths,
            sample_paths: (stratzy.trades_sample ?? []).map((t) => ({
              path: t.exit_path,
              r_classic: t.r_classic,
              r_gross: t.r_gross,
              r_net: t.r_multiple,
            })),
          }
        : null,
    });
  } catch (e) {
    console.error(`FAIL ${job.instrument} ${job.interval}`, e);
    out.push({ instrument_id: job.instrument, interval: job.interval, error: String(e) });
  }
}

console.log(JSON.stringify(out, null, 2));

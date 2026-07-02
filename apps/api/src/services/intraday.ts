import { fetchNiftyIntradayCharts } from '@sv/data-adapters';
import {
  analyzeNiftyDirection,
  buildLivePlaybook,
  evaluatePresets,
  gradeSignalQuality,
  mtfConfluence,
  NIFTY_INTRADAY_REFRESH_SEC,
} from '@sv/intraday';

export async function getNiftyIntradayState(interval = '15m', refresh = false) {
  const { chart5, chart15 } = await fetchNiftyIntradayCharts(refresh);
  const analysis5 = analyzeNiftyDirection(chart5, '5m') as Record<string, unknown>;
  const analysis15 = analyzeNiftyDirection(chart15, '15m') as Record<string, unknown>;

  if (analysis5.ok) {
    analysis5.setup_quality = gradeSignalQuality(analysis5, (analysis5.trade_plan as Record<string, unknown>) ?? {}, null);
  }
  if (analysis15.ok) {
    analysis15.setup_quality = gradeSignalQuality(analysis15, (analysis15.trade_plan as Record<string, unknown>) ?? {}, null);
  }

  const mtf = mtfConfluence(analysis5, analysis15);
  const presetEval = evaluatePresets(analysis5, analysis15, mtf);
  const recommendedPreset = 'cfa_precision';
  const activeIv = interval === '5m' ? '5m' : '15m';
  const analysis = activeIv === '5m' ? analysis5 : analysis15;
  const plan = (analysis.trade_plan as Record<string, unknown> | null) ?? null;
  const livePlaybook = buildLivePlaybook(plan, analysis, analysis5, mtf, presetEval, recommendedPreset, activeIv);

  return {
    ok: Boolean(analysis5.ok || analysis15.ok),
    index: 'nifty50',
    index_label: 'Nifty 50',
    interval: activeIv,
    refresh_sec: NIFTY_INTRADAY_REFRESH_SEC,
    recommended_preset: recommendedPreset,
    chart_5m: chart5 ? { bar_count: chart5.bars.length, yahoo: chart5.yahoo } : null,
    chart_15m: chart15 ? { bar_count: chart15.bars.length, yahoo: chart15.yahoo } : null,
    analysis,
    analysis_5m: analysis5,
    analysis_15m: analysis15,
    mtf,
    plan,
    playbook: livePlaybook,
    preset_eval: presetEval,
    server_time: new Date().toISOString(),
  };
}

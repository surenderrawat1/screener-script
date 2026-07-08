import {
  buildIntradayChartPayload,
  fetchChartsForInstrument,
  fetchInstrumentIntradayChart,
  fetchNiftyIntradayCharts,
} from '@sv/data-adapters';
import {
  analyzeNiftyDirection,
  buildFnoTradePlans,
  buildLivePlaybook,
  evaluatePresets,
  gradeSignalQuality,
  hasFnoSupport,
  listIntradayInstruments,
  mtfConfluence,
  NIFTY_INTRADAY_REFRESH_SEC,
  normalizeInstrumentId,
  recommendedPresetForInstrument,
  resolveInstrument,
} from '@sv/intraday';

export async function getNiftyIntradayState(
  interval = '15m',
  refresh = false,
  instrumentId = 'nifty50',
) {
  const instrumentKey = normalizeInstrumentId(instrumentId);
  const meta = resolveInstrument(instrumentKey);
  const { chart5, chart15 } = meta
    ? await fetchChartsForInstrument(meta.cache_key, meta.yahoo_symbols, refresh)
    : await fetchNiftyIntradayCharts(refresh);

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
  const activeIv = interval === '5m' ? '5m' : '15m';
  const recommendedPreset = recommendedPresetForInstrument(instrumentKey, activeIv);
  const analysis = activeIv === '5m' ? analysis5 : analysis15;
  const plan = (analysis.trade_plan as Record<string, unknown> | null) ?? null;
  const livePlaybook = buildLivePlaybook(plan, analysis, analysis5, mtf, presetEval, recommendedPreset, activeIv);
  const fno = buildFnoTradePlans(instrumentKey, plan, analysis, mtf);

  return {
    ok: Boolean(analysis5.ok || analysis15.ok),
    index: instrumentKey,
    index_label: meta?.label ?? 'Nifty 50',
    instrument: meta,
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
    fno,
    fno_supported: hasFnoSupport(instrumentKey),
    server_time: new Date().toISOString(),
  };
}

export async function getIntradayChart(
  instrumentId = 'nifty50',
  interval = '15m',
  refresh = false,
) {
  const instrumentKey = normalizeInstrumentId(instrumentId);
  const meta = resolveInstrument(instrumentKey);
  const activeIv: '5m' | '15m' = interval === '5m' ? '5m' : '15m';
  if (!meta) {
    return { ok: false as const, instrument: instrumentKey, interval: activeIv, error: 'Unknown instrument', chart: null };
  }

  const chart = await fetchInstrumentIntradayChart(
    meta.cache_key,
    meta.yahoo_symbols,
    meta.label,
    activeIv,
    refresh,
  );
  if (!chart) {
    return {
      ok: false as const,
      instrument: meta.id,
      instrument_label: meta.label,
      interval: activeIv,
      error: `No intraday chart data for ${meta.label} (${activeIv}).`,
      chart: null,
    };
  }

  const payload = buildIntradayChartPayload(chart);
  return {
    ok: true as const,
    instrument: meta.id,
    instrument_label: meta.label,
    interval: activeIv,
    range: chart.range,
    yahoo: chart.yahoo,
    bar_count: chart.bars.length,
    fetched_at: chart.fetched_at,
    chart: payload,
  };
}

export function getIntradayInstruments() {
  const instruments = listIntradayInstruments().map((meta) => ({
    ...meta,
    fno_supported: hasFnoSupport(meta.id),
    recommended_preset_15m: recommendedPresetForInstrument(meta.id, '15m'),
    recommended_preset_5m: recommendedPresetForInstrument(meta.id, '5m'),
  }));
  return {
    ok: true,
    indices: instruments.filter((i) => i.kind === 'index'),
    stocks: instruments.filter((i) => i.kind === 'stock'),
    instruments,
  };
}

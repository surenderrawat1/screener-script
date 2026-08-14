import {
  buildIntradayChartPayload,
  fetchChartsForInstrument,
  fetchInstrumentIntradayChart,
  readIntradayStateSnapshot,
  writeIntradayStateSnapshot,
} from '@sv/data-adapters';
import { nseSession } from '@sv/shared';
import {
  analyzeNiftyDirection,
  backtestIntradayCombo,
  buildFnoTradePlans,
  buildLivePlaybook,
  buildScalpSetup,
  evaluatePresets,
  gradeSignalQuality,
  hasFnoSupport,
  INTRADAY_APP_SOURCE,
  listEtfQuickPicks,
  listIntradayInstruments,
  liteDirection,
  liteJournal,
  liteLogPlan,
  liteOpenPosition,
  litePlaybook,
  liteScalpSetup,
  liteTimeStop,
  MIN_INTRADAY_ACCURACY_PCT,
  MIN_INTRADAY_TRADES_PROVEN,
  mtfConfluence,
  NIFTY_INTRADAY_REFRESH_SEC,
  pickLiveRecommendedPreset,
  recommendedPresetForInstrument,
  resolveInstrument,
} from '@sv/intraday';
import { listIntradayPositions } from './intraday-positions.js';

export async function getNiftyIntradayState(
  interval = '15m',
  refresh = false,
  instrumentId = 'nifty50',
  options: { skip_accuracy_gate?: boolean } = {},
) {
  const raw = instrumentId.trim() || 'nifty50';
  const meta = resolveInstrument(raw);
  const activeIv: '5m' | '15m' = interval === '5m' ? '5m' : '15m';
  if (!meta) {
    return {
      ok: false,
      unknown_instrument: true,
      error: `Unknown instrument: ${raw}. Use an NSE/BSE ticker, ETF, or index id (e.g. TCS, NIFTYBEES, nifty50).`,
      index: raw.toLowerCase(),
      index_label: raw.toUpperCase(),
      instrument: null,
      interval: activeIv,
    };
  }
  const skipGate = Boolean(options.skip_accuracy_gate);
  if (!refresh) {
    const hit = await readIntradayStateSnapshot<Record<string, unknown>>(meta.id, activeIv, skipGate);
    if (hit && hit.ok) {
      return {
        ...hit,
        cached: true,
        server_time: new Date().toISOString(),
      };
    }
  }
  return computeNiftyIntradayState(meta, activeIv, refresh, options);
}

async function computeNiftyIntradayState(
  meta: NonNullable<ReturnType<typeof resolveInstrument>>,
  activeIv: '5m' | '15m',
  refresh: boolean,
  options: { skip_accuracy_gate?: boolean },
) {
  const instrumentKey = meta.id;
  const { chart5, chart15 } = await fetchChartsForInstrument(meta.cache_key, meta.yahoo_symbols, refresh);

  const analysis5 = analyzeNiftyDirection(chart5, '5m') as Record<string, unknown>;
  const analysis15 = analyzeNiftyDirection(chart15, '15m') as Record<string, unknown>;

  if (analysis5.ok) {
    analysis5.setup_quality = gradeSignalQuality(analysis5, (analysis5.trade_plan as Record<string, unknown>) ?? {}, null);
  }
  if (analysis15.ok) {
    analysis15.setup_quality = gradeSignalQuality(analysis15, (analysis15.trade_plan as Record<string, unknown>) ?? {}, null);
  }

  const mtf = mtfConfluence(analysis5, analysis15);
  const instrumentPayload = { ...meta };
  const presetEval = evaluatePresets(analysis5, analysis15, mtf, instrumentPayload, activeIv);
  const staticPreset = recommendedPresetForInstrument(instrumentKey, activeIv);
  const recommendedPreset = pickLiveRecommendedPreset(instrumentKey, activeIv, presetEval);
  const analysis = activeIv === '5m' ? analysis5 : analysis15;
  const plan = (analysis.trade_plan as Record<string, unknown> | null) ?? null;
  // Paper / live-session automation must not depend on historical backtests.
  const accuracyGate = options.skip_accuracy_gate
    ? null
    : meta
      ? await intradayAccuracyGate(
          meta.cache_key,
          meta.yahoo_symbols,
          meta.label,
          recommendedPreset,
          activeIv,
          false,
        )
      : missingAccuracyGate(recommendedPreset);
  const livePlaybook = buildLivePlaybook(
    plan,
    analysis,
    analysis5,
    mtf,
    presetEval,
    recommendedPreset,
    activeIv,
    accuracyGate,
    analysis15,
  );
  const fno = buildFnoTradePlans(instrumentKey, plan, analysis, mtf);
  const scalpSetup = buildScalpSetup(analysis5, analysis15, mtf, meta ? { ...meta } : null);

  const state = {
    ok: Boolean(analysis5.ok || analysis15.ok),
    index: instrumentKey,
    index_label: meta.label,
    instrument: meta,
    interval: activeIv,
    refresh_sec: NIFTY_INTRADAY_REFRESH_SEC,
    recommended_preset: recommendedPreset,
    recommended_preset_static: staticPreset,
    recommended_preset_live: recommendedPreset !== staticPreset,
    chart_5m: chart5 ? { bar_count: chart5.bars.length, yahoo: chart5.yahoo } : null,
    chart_15m: chart15 ? { bar_count: chart15.bars.length, yahoo: chart15.yahoo } : null,
    analysis,
    analysis_5m: analysis5,
    analysis_15m: analysis15,
    mtf,
    plan,
    playbook: livePlaybook,
    accuracy_gate: accuracyGate,
    preset_eval: presetEval,
    fno,
    fno_supported: hasFnoSupport(instrumentKey),
    scalp_setup: scalpSetup,
    server_time: new Date().toISOString(),
    skip_accuracy_gate: Boolean(options.skip_accuracy_gate),
    cached: false,
  };
  if (state.ok) {
    await writeIntradayStateSnapshot(
      instrumentKey,
      activeIv,
      state,
      Boolean(options.skip_accuracy_gate),
    ).catch(() => undefined);
  }
  return state;
}

async function intradayAccuracyGate(
  cacheKey: string,
  yahooSymbols: string[],
  label: string,
  presetId: string,
  interval: '5m' | '15m',
  refresh: boolean,
) {
  try {
    const [chart5, chart15] = await Promise.all([
      fetchInstrumentIntradayChart(cacheKey, yahooSymbols, label, '5m', refresh, '60d'),
      fetchInstrumentIntradayChart(cacheKey, yahooSymbols, label, '15m', refresh, '60d'),
    ]);
    if (!chart5?.bars?.length || !chart15?.bars?.length) return missingAccuracyGate(presetId);

    const result = backtestIntradayCombo(
      { bars: chart5.bars, closes: chart5.closes, interval: '5m' },
      { bars: chart15.bars, closes: chart15.closes, interval: '15m' },
      { interval, mode: 'single', preset_id: presetId },
    );
    return result.presets[0] ?? missingAccuracyGate(presetId);
  } catch {
    return missingAccuracyGate(presetId);
  }
}

function missingAccuracyGate(presetId: string) {
  return {
    preset_id: presetId,
    label: presetId,
    trades: 0,
    wins: 0,
    losses: 0,
    win_rate_pct: null,
    avg_r: null,
    accuracy_status: 'missing',
    accuracy_pass: false,
    accuracy_floor_pct: MIN_INTRADAY_ACCURACY_PCT,
    min_trades_required: MIN_INTRADAY_TRADES_PROVEN,
  };
}

export async function getIntradayChart(
  instrumentId = 'nifty50',
  interval = '15m',
  refresh = false,
) {
  const raw = instrumentId.trim() || 'nifty50';
  const meta = resolveInstrument(raw);
  const activeIv: '5m' | '15m' = interval === '5m' ? '5m' : '15m';
  if (!meta) {
    return {
      ok: false as const,
      instrument: raw,
      interval: activeIv,
      error: `Unknown instrument: ${raw}`,
      chart: null,
    };
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
  const decorate = <T extends { id: string }>(meta: T) => ({
    ...meta,
    fno_supported: hasFnoSupport(meta.id),
    recommended_preset_15m: recommendedPresetForInstrument(meta.id, '15m'),
    recommended_preset_5m: recommendedPresetForInstrument(meta.id, '5m'),
  });
  const catalog = listIntradayInstruments().map(decorate);
  const etfs = listEtfQuickPicks().map(decorate);
  return {
    ok: true,
    indices: catalog.filter((i) => i.kind === 'index'),
    stocks: catalog.filter((i) => i.kind === 'stock'),
    etfs,
    instruments: [...catalog, ...etfs],
  };
}

export async function getNiftyIntradayLite(
  userId: string | undefined,
  interval = '5m',
  instrumentId = 'nifty50',
  refresh = false,
) {
  const state = await getNiftyIntradayState(interval, refresh, instrumentId);
  if ('unknown_instrument' in state && state.unknown_instrument) return state;
  const row = state as Record<string, unknown>;

  const uid = userId && userId !== 'system' ? userId : undefined;
  const [openRes, closedRes] = await Promise.all([
    listIntradayPositions(uid, 'open', { live: true }),
    listIntradayPositions(uid, 'closed'),
  ]);
  const openRows = (openRes.positions ?? []) as Record<string, unknown>[];
  const closedRows = (closedRes.positions ?? []) as Record<string, unknown>[];
  const scalp = (row.scalp_setup as Record<string, unknown> | undefined) ?? null;
  const analysis5 = (row.analysis_5m as Record<string, unknown> | undefined) ?? null;
  const playbook = (row.playbook as Record<string, unknown> | undefined) ?? null;
  const inst = row.instrument as Record<string, unknown> | undefined;

  return {
    ok: Boolean(row.ok),
    cached: Boolean(row.cached),
    interval: row.interval ?? interval,
    index: row.index,
    index_label: row.index_label,
    instrument: inst
      ? {
          id: inst.id,
          label: inst.label,
          kind: inst.kind,
          yahoo_symbols: inst.yahoo_symbols,
        }
      : null,
    session: nseSession(),
    time_stop: liteTimeStop(),
    direction: liteDirection(analysis5),
    recommended_preset: row.recommended_preset,
    playbook: litePlaybook(playbook),
    scalp_setup: liteScalpSetup(scalp),
    log_plan: liteLogPlan(scalp),
    log_source: INTRADAY_APP_SOURCE,
    positions: {
      open: openRows.map(liteOpenPosition),
      portfolio: openRes.live?.portfolio ?? { count: openRows.length, net_pnl_inr: null, urgent_count: 0 },
    },
    journal: liteJournal(closedRows),
    refresh_sec: Number(row.refresh_sec ?? NIFTY_INTRADAY_REFRESH_SEC),
    server_time: new Date().toISOString(),
  };
}

import {
  currentMarketRegime,
  dispatchMorningAlerts,
  getCachedMorningBundle,
  getChartPatternsMorningPanel,
  getEveningGttDigest,
  getMorningEtfPanel,
  getSwingAutoSnapshotDurable,
  listStrategyDailyProof,
  scheduleEtfPanelRevalidate,
  setCachedMorningBundle,
  shouldRevalidateEtfPanel,
} from '@sv/data-adapters';

import { nseSession } from '@sv/shared';

import { prisma } from '@sv/db';

import {

  autoRadarPanel,

  buildAlerts,

  intradayPositionsPanel,

  overnightTierChangesFromSnapshots,

  regimeGuidance,

  routineSteps,

  serializeNiftyPanel,

  swingPositionsPanel,

  tradingPresetChips,

} from '@sv/swing';

import { getNiftyIntradayState } from './intraday.js';

import {

  listIntradayPositions,

  trackOpenIntradayPositions,

} from './intraday-positions.js';

import { refreshOpenPositions } from './swing-auto.js';

import { listSwingPositions } from './swing-positions.js';

import { getFundamentalAutoState } from './fundamental-auto.js';

const DISCLAIMER =

  'Research cockpit only — cached Yahoo data and last Swing Auto snapshot. Confirm on NSE before orders.';



async function buildMorningBriefing(

  userId?: string,

  options: { live?: boolean; refreshEtf?: boolean } = {},

) {

  const live = options.live !== false;

  const refreshEtf = options.refreshEtf === true;



  const [
    regime,
    snapshot,
    snapshotArchives,
    swingResult,
    intradayResult,
    niftyState,
    etf,
    ltgAuto,
    eveningGtt,
    dailyProof,
    chartPatterns,
  ] =
    await Promise.all([
    currentMarketRegime(false),
    getSwingAutoSnapshotDurable(),
    prisma.swingAutoSnapshotArchive.findMany({
      orderBy: { savedAt: 'desc' },
      take: 2,
      select: { savedAt: true, tiers: true },
    }),
    listSwingPositions(userId, 'open'),
    listIntradayPositions(userId, 'open'),
    getNiftyIntradayState('15m', false).catch(() => null),
    getMorningEtfPanel(refreshEtf),
    getFundamentalAutoState({ universe: 'nifty250', maxScan: 250 }).catch(() => ({
      available: false,
      saved_at: null,
      universe: 'nifty250',
      max_scan: 250,
      tiers: { high_conviction: [], strict_enter: [], setup_radar: [], breakout_surge: [] },
    })),
    getEveningGttDigest().catch(() => null),
    listStrategyDailyProof({ days: 3 }).catch(() => null),
    getChartPatternsMorningPanel().catch(() => ({
      available: false,
      scan_date: null,
      pattern_count: 0,
      breakout_count: 0,
      confirmed_count: 0,
      forming_count: 0,
      hits: [],
      href: '/patterns',
    })),
  ]);



  const [swingTracked, intradayTracked] = live

    ? await Promise.all([

        refreshOpenPositions(swingResult.positions),

        trackOpenIntradayPositions(intradayResult.positions),

      ])

    : [swingResult.positions, intradayResult.positions];



  const session = nseSession();

  const guidance = regimeGuidance(regime);

  const auto = autoRadarPanel(snapshot);

  const [latestArchive, previousArchive] = snapshotArchives ?? [];
  const autoTierChanges = overnightTierChangesFromSnapshots(
    latestArchive ? { tiers: latestArchive.tiers as Record<string, unknown> } : null,
    previousArchive ? { tiers: previousArchive.tiers as Record<string, unknown> } : null,
  );

  const swing = swingPositionsPanel(swingTracked, { live });

  const intraday = intradayPositionsPanel(intradayTracked, { available: true, live });

  const nifty = serializeNiftyPanel(niftyState);

  const alerts = buildAlerts(swing, intraday);



  return {
    built_at: new Date().toISOString(),
    live,
    session,
    regime,
    guidance,
    auto: {
      ...auto,
      tier_changes: autoTierChanges,
    },
    ltg_auto: ltgAuto,
    swing,
    intraday,
    etf,
    nifty,
    alerts,
    evening_gtt: eveningGtt
      ? {
          date_key: eveningGtt.date_key,
          order_count: eveningGtt.order_count,
          regime_key: eveningGtt.regime_key,
          built_at: eveningGtt.built_at,
          orders: (eveningGtt.orders ?? []).slice(0, 8).map((o) => ({
            symbol: o.symbol,
            name: o.name,
            tier: o.tier,
            qty: o.qty,
            trigger_price: o.trigger_price,
            limit_price: o.limit_price,
            stop_loss: o.stop_loss,
            profit_target: o.profit_target,
            copy_line: o.copy_line,
          })),
          href: '/signals',
        }
      : { date_key: null, order_count: 0, orders: [], href: '/signals' },
    strategy_daily_proof: dailyProof
      ? {
          days: dailyProof.days,
          run_count: dailyProof.runs.length,
          scoreboard: (dailyProof.scoreboard ?? []).slice(0, 5),
          href: '/strategies',
        }
      : { days: 0, run_count: 0, scoreboard: [], href: '/strategies' },
    chart_patterns: chartPatterns,
    presets: tradingPresetChips(),
    routine: routineSteps(session, swing, intraday, etf, auto, nifty, chartPatterns),
    educational_only: true,
    disclaimer: DISCLAIMER,
  };
}



export async function getMorningBriefing(

  userId?: string,

  options: { live?: boolean; refreshEtf?: boolean } = {},

) {

  const live = options.live !== false;

  const refreshEtf = options.refreshEtf === true;



  if (!live && !refreshEtf) {

    const cached = await getCachedMorningBundle(userId);

    if (cached?.briefing) {

      if (shouldRevalidateEtfPanel(cached.briefing.etf as { from_cache?: boolean; cached_at?: string | null })) {

        scheduleEtfPanelRevalidate();

      }

      return {

        ...cached.briefing,

        from_cache: true,

        cache_age_sec: Math.max(

          0,

          Math.floor((Date.now() - Date.parse(cached.cached_at)) / 1000),

        ),

      };

    }

  }



  const briefing = await buildMorningBriefing(userId, options);



  if (!refreshEtf && shouldRevalidateEtfPanel(briefing.etf)) {

    scheduleEtfPanelRevalidate();

  }



  if (!live) {

    await setCachedMorningBundle(userId, briefing);

  }



  return briefing;

}



export async function notifyMorningAlertsIfNeeded(
  briefing: Record<string, unknown> & {
    alerts?: string[];
    swing?: { exit_count?: number };
    intraday?: { exit_count?: number };
  },
  userId?: string,
) {
  const alerts = Array.isArray(briefing.alerts) ? briefing.alerts : [];
  if (alerts.length === 0) return false;
  const result = await dispatchMorningAlerts(
    {
      alerts,
      swing_exit_count: Number(briefing.swing?.exit_count ?? 0),
      intraday_exit_count: Number(briefing.intraday?.exit_count ?? 0),
    },
    userId,
  );
  return result.webhook || result.email;
}



export { getMorningEtfPanel };



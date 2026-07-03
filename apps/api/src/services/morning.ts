import {

  currentMarketRegime,

  dispatchMorningAlertWebhook,

  getCachedMorningBundle,

  getMorningEtfPanel,

  getSwingAutoSnapshotDurable,

  scheduleEtfPanelRevalidate,

  setCachedMorningBundle,

  shouldRevalidateEtfPanel,

} from '@sv/data-adapters';

import { nseSession } from '@sv/shared';

import {

  autoRadarPanel,

  buildAlerts,

  intradayPositionsPanel,

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



const DISCLAIMER =

  'Research cockpit only — cached Yahoo data and last Swing Auto snapshot. Confirm on NSE before orders.';



async function buildMorningBriefing(

  userId?: string,

  options: { live?: boolean; refreshEtf?: boolean } = {},

) {

  const live = options.live !== false;

  const refreshEtf = options.refreshEtf === true;



  const [regime, snapshot, swingResult, intradayResult, niftyState, etf] = await Promise.all([

    currentMarketRegime(false),

    getSwingAutoSnapshotDurable(),

    listSwingPositions(userId, 'open'),

    listIntradayPositions(userId, 'open'),

    getNiftyIntradayState('15m', false).catch(() => null),

    getMorningEtfPanel(refreshEtf),

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

    auto,

    swing,

    intraday,

    etf,

    nifty,

    alerts,

    presets: tradingPresetChips(),

    routine: routineSteps(session, swing, intraday, etf, auto, nifty),

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
) {
  const alerts = Array.isArray(briefing.alerts) ? briefing.alerts : [];
  if (alerts.length === 0) return false;
  return dispatchMorningAlertWebhook({
    alerts,
    swing_exit_count: Number(briefing.swing?.exit_count ?? 0),
    intraday_exit_count: Number(briefing.intraday?.exit_count ?? 0),
  });
}



export { getMorningEtfPanel };



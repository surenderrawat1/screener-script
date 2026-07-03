import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, dateKeyInTimezone, getConfigTimezone, getSchedules, isDailyCronDue } from '@sv/shared';
import { fetchNiftyIntradayCharts } from './intraday-chart.js';
import { currentMarketRegime } from './market-regime.js';
import { getMorningEtfPanel } from './morning-etf.js';

const PREWARM_LAST_KEY = 'prewarm:last';

export interface MorningPrewarmResult {
  ok: boolean;
  regime_key: string | null;
  etf_hit_count: number;
  nifty_charts: boolean;
  duration_ms: number;
  error?: string;
}

export async function warmMorningBriefing(refresh = true): Promise<MorningPrewarmResult> {
  const started = Date.now();
  try {
    const [regime, etf, charts] = await Promise.all([
      currentMarketRegime(refresh),
      getMorningEtfPanel(refresh),
      fetchNiftyIntradayCharts(refresh).catch(() => null),
    ]);

    const result: MorningPrewarmResult = {
      ok: true,
      regime_key: String(regime.key ?? '') || null,
      etf_hit_count: etf.hit_count,
      nifty_charts: Boolean(charts?.chart15?.bars?.length),
      duration_ms: Date.now() - started,
    };

    const tz = getConfigTimezone();
    await cacheSetJson(
      cacheKey(CACHE_PREFIX.MORNING, PREWARM_LAST_KEY),
      { warmed_at: new Date().toISOString(), date_key: dateKeyInTimezone(tz), ...result },
      86400,
    );

    return result;
  } catch (err) {
    return {
      ok: false,
      regime_key: null,
      etf_hit_count: 0,
      nifty_charts: false,
      duration_ms: Date.now() - started,
      error: err instanceof Error ? err.message : 'Morning pre-warm failed',
    };
  }
}

export async function hasMorningPrewarmToday(timezone = getConfigTimezone()): Promise<boolean> {
  const last = await cacheGetJson<{ date_key?: string }>(cacheKey(CACHE_PREFIX.MORNING, PREWARM_LAST_KEY));
  return last?.date_key === dateKeyInTimezone(timezone);
}

export async function tickMorningPrewarm(now = new Date()): Promise<MorningPrewarmResult | null> {
  const schedules = getSchedules();
  const cfg = schedules.intraday.morning_prewarm;
  if (!cfg?.enabled) return null;

  if (await hasMorningPrewarmToday(cfg.timezone)) return null;
  if (!isDailyCronDue(cfg.cron, cfg.timezone, now)) return null;

  return warmMorningBriefing(true);
}

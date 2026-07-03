import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import { CACHE_PREFIX, dateKeyInTimezone, getConfigTimezone } from '@sv/shared';

export interface MorningAlertPayload {
  alerts: string[];
  swing_exit_count: number;
  intraday_exit_count: number;
}

export async function dispatchMorningAlertWebhook(payload: MorningAlertPayload): Promise<boolean> {
  const url = process.env.MORNING_ALERT_WEBHOOK_URL?.trim();
  if (!url || payload.alerts.length === 0) return false;

  const dayKey = dateKeyInTimezone(getConfigTimezone());
  const dedupeKey = cacheKey(
    CACHE_PREFIX.MORNING,
    `alert:${dayKey}:${payload.alerts.slice(0, 3).join('|')}`,
  );
  const alreadySent = await cacheGetJson(dedupeKey);
  if (alreadySent) return false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'morning-routine',
        alerts: payload.alerts,
        swing_exit_count: payload.swing_exit_count,
        intraday_exit_count: payload.intraday_exit_count,
        sent_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) return false;
    await cacheSetJson(dedupeKey, { sent_at: new Date().toISOString() }, 86400);
    return true;
  } catch {
    return false;
  }
}

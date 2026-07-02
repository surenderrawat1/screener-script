/**
 * Minimal daily cron matcher — supports "minute hour * * *" patterns.
 * Used by the worker tick (60s) with a short grace window after the scheduled minute.
 */
export function parseDailyCron(cron: string): { minute: number; hour: number } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parseInt(parts[0] ?? '', 10);
  const hour = parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') return null;
  return { minute, hour };
}

export function zonedTimeParts(timezone: string, now = new Date()): { hour: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    dateKey: `${year}-${month}-${day}`,
  };
}

export function isDailyCronDue(
  cron: string,
  timezone: string,
  now = new Date(),
  graceMinutes = 2,
): boolean {
  const parsed = parseDailyCron(cron);
  if (!parsed) return false;

  const { hour, minute } = zonedTimeParts(timezone, now);
  const nowMins = hour * 60 + minute;
  const wantMins = parsed.hour * 60 + parsed.minute;
  return nowMins >= wantMins && nowMins < wantMins + graceMinutes;
}

export function dateKeyInTimezone(timezone: string, when = new Date()): string {
  return zonedTimeParts(timezone, when).dateKey;
}

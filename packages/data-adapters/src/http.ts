const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function httpGet(url: string, timeoutMs = 15_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function raw(obj: Record<string, unknown> | undefined, key: string): number {
  const v = obj?.[key];
  if (v && typeof v === 'object' && 'raw' in (v as object)) {
    return Number((v as { raw?: number }).raw ?? 0);
  }
  return Number(v ?? 0);
}

export function pct(value: number): number {
  if (value === 0) return 0;
  if (Math.abs(value) < 1) return Math.round(value * 10000) / 100;
  return Math.round(value * 100) / 100;
}

export function toCrores(value: number): number {
  if (value === 0) return 0;
  return Math.round((value / 1e7) * 100) / 100;
}

export function normalizeDebtToEquity(de: number): number {
  if (de <= 0) return 0;
  if (de > 5) return Math.round((de / 100) * 1000) / 1000;
  return de;
}

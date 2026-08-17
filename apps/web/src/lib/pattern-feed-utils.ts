/** Reward:risk from breakout → target vs stop (absolute distances). */
export function patternRewardRisk(
  breakout: number | null | undefined,
  target: number | null | undefined,
  stop: number | null | undefined,
): number | null {
  const b = Number(breakout ?? 0);
  const t = Number(target ?? 0);
  const s = Number(stop ?? 0);
  if (!(b > 0) || !(t > 0) || !(s > 0)) return null;
  const reward = Math.abs(t - b);
  const risk = Math.abs(b - s);
  if (!(risk > 0) || !(reward > 0)) return null;
  return Math.round((reward / risk) * 100) / 100;
}

export function formatRewardRisk(rr: number | null): string {
  if (rr == null || !Number.isFinite(rr)) return '—';
  return `${rr.toFixed(rr >= 10 ? 0 : 1)}R`;
}

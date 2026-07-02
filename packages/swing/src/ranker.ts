import type { SwingScanHit } from './types.js';

export const MIN_LIQUIDITY_CR = 8.0;

export function tier(score: number): string {
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

export function scoreHit(hit: SwingScanHit): number {
  let score = hit.entry_score > 0 ? Math.round(hit.entry_score * 0.65) : 0;
  const discovery = String(hit.verdict ?? '');
  const strict = String(hit.strict_verdict ?? '');
  if (strict === 'ENTER') score += 25;
  else if (discovery === 'ENTER') score += 18;
  else if (discovery === 'SETUP') score += 12;
  else if (discovery === 'WATCH' || strict === 'WATCH') score += 5;
  if (hit.r_multiple_ok) score += 8;
  const liq = Number(hit.ta_avg_value_cr ?? 0);
  if (liq >= 8) score += 6;
  if (hit.stale) score -= 10;
  if (hit.regime_key === 'bear') score -= 8;
  return Math.max(0, Math.min(100, score));
}

export function matchesMinVerdict(strictVerdict: string, discoveryVerdict: string, minVerdict: string): boolean {
  const min = minVerdict.toUpperCase();
  if (min === 'ALL') return true;
  if (strictVerdict === 'ENTER') return true;
  if (min === 'ENTER') return strictVerdict === 'ENTER';
  if (min === 'SETUP_PLUS') return ['ENTER', 'SETUP'].includes(discoveryVerdict);
  return ['ENTER', 'SETUP', 'WATCH'].includes(discoveryVerdict) || strictVerdict === 'WATCH';
}

export function rankHits<T extends SwingScanHit>(hits: T[]): T[] {
  const ranked = hits.map((h) => ({ ...h, swing_rank: scoreHit(h) }));
  ranked.sort((a, b) => {
    const byRank = (b.swing_rank ?? 0) - (a.swing_rank ?? 0);
    if (byRank !== 0) return byRank;
    const byR = (b.r_multiple ?? 0) - (a.r_multiple ?? 0);
    if (byR !== 0) return byR;
    return Number(b.rules_passed ?? 0) - Number(a.rules_passed ?? 0);
  });
  return ranked;
}

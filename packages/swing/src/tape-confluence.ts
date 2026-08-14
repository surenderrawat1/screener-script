import { VOLUME_SURGE_MIN } from './dynamic-signals.js';

export type TapeConfluenceKey = 'strong' | 'aligned' | 'partial' | 'weak' | 'conflict';

export type TapeConfluence = {
  key: TapeConfluenceKey;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  /** Count of confirming factors (0–5). */
  score: number;
  factors: string[];
  summary: string;
};

/**
 * Lightweight multi-factor confluence for Swing Auto hits (Phase D).
 * Uses daily setup + tape + soft E9/hourly already on the hit — no per-symbol 5m/15m fetch.
 */
export function computeTapeConfluence(
  hit: Record<string, unknown>,
  regime?: Record<string, unknown> | null,
): TapeConfluence {
  const factors: string[] = [];
  const strict = String(hit.strict_verdict ?? hit.strict ?? '');
  const discovery = String(hit.verdict ?? hit.discovery_verdict ?? '');
  const dynamic = (hit.dynamic as Record<string, unknown> | null) ?? {};

  if (strict === 'ENTER' || hit.strict_enter_ready === true) factors.push('strict ENTER');
  else if (discovery === 'ENTER') factors.push('discovery ENTER');
  else if (discovery === 'SETUP') factors.push('SETUP');

  const volRatio = Number(hit.ta_volume_ratio ?? 0);
  if (hit.volume_surge === true || volRatio >= VOLUME_SURGE_MIN) factors.push('volume');
  if (hit.broke_swing_high === true) factors.push('breakout');

  const softPassed = Number(hit.rules_soft_passed ?? 0);
  if (dynamic.hourly_ema_bull === true) factors.push('hourly EMA');
  else if (softPassed >= 2) factors.push('soft E9+');
  else if (softPassed >= 1) factors.push('soft catalyst');

  const regimeKey = String(regime?.key ?? '');
  if (regime?.blocks_strict_enter === true) {
    return {
      key: 'conflict',
      label: 'Regime block',
      tone: 'danger',
      score: factors.length,
      factors,
      summary: `Strong-bear regime blocks new risk · ${factors.join(', ') || 'no tape'}`,
    };
  }
  if (regimeKey === 'bull' && (strict === 'ENTER' || discovery === 'ENTER' || discovery === 'SETUP')) {
    factors.push('bull regime');
  }

  const score = factors.length;
  const summary = factors.length > 0 ? factors.join(' · ') : 'No tape confluence factors';

  if (score >= 4) {
    return {
      key: 'strong',
      label: 'Tape strong',
      tone: 'success',
      score,
      factors,
      summary,
    };
  }
  if (score >= 3) {
    return {
      key: 'aligned',
      label: 'Aligned',
      tone: 'success',
      score,
      factors,
      summary,
    };
  }
  if (score >= 2) {
    return {
      key: 'partial',
      label: 'Partial',
      tone: 'warning',
      score,
      factors,
      summary,
    };
  }
  if (score >= 1) {
    return {
      key: 'weak',
      label: 'Thin',
      tone: 'muted',
      score,
      factors,
      summary,
    };
  }
  return {
    key: 'weak',
    label: 'None',
    tone: 'muted',
    score: 0,
    factors: [],
    summary: 'No tape confluence factors',
  };
}

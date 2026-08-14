import { resolveExitProfile, type ExitProfile } from './exit-profile.js';

/** Shares to sell for a scaled book weight, capped by open quantity. */
export function sharesForPartialWeight(
  originalQty: number,
  openQty: number,
  weight: number,
): number {
  if (!(originalQty > 0) || !(openQty > 0) || !(weight > 0)) return 0;
  const target = Math.max(1, Math.floor(originalQty * weight + 1e-9));
  return Math.min(openQty, target);
}

/** Remaining % of original size after booking `sold` shares. */
export function remainingPctAfterSale(originalQty: number, openAfter: number): number {
  if (!(originalQty > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((openAfter / originalQty) * 100)));
}

export function partialWeightForAction(
  action: string,
  profile: ExitProfile = resolveExitProfile('as_planned'),
): number | null {
  if (action === 'PARTIAL_T1') return profile.weights[0];
  if (action === 'PARTIAL_T2') return profile.weights[1];
  return null;
}

export function exitProfileFromEvidence(evidence: unknown): ExitProfile {
  const ev = (evidence ?? {}) as Record<string, unknown>;
  const preset = String(ev.preset ?? ev.exit_profile ?? 'as_planned');
  // Prefer explicit exit_profile stamped at entry; else resolve from preset id via known map.
  if (ev.exit_profile) return resolveExitProfile(String(ev.exit_profile));
  // Paper Stratzy preset uses stratzy_trend book.
  if (preset === 'ma20_stratzy') return resolveExitProfile('stratzy_trend');
  return resolveExitProfile(preset);
}

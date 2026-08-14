/** Exit books applied by preset `exit_profile` (was label-only before). */

export type ExitProfileId =
  | 'as_planned'
  | 'quick_scalp'
  | 'wide_stop'
  | 'cfa_precision'
  | 'stratzy_trend';

export interface ExitProfile {
  id: ExitProfileId;
  label: string;
  /** Fraction of size at each target (must sum ≈ 1). */
  weights: readonly [number, number, number];
  /** R-multiples for T1/T2/T3. */
  rr: readonly [number, number, number];
  partial_pcts: readonly [number, number, number];
}

const PROFILES: Record<ExitProfileId, ExitProfile> = {
  as_planned: {
    id: 'as_planned',
    label: 'As planned 40/40/20 @1/2/3R',
    weights: [0.4, 0.4, 0.2],
    rr: [1, 2, 3],
    partial_pcts: [40, 40, 20],
  },
  quick_scalp: {
    id: 'quick_scalp',
    label: 'Quick scalp 60/30/10 @0.8/1.5/2.2R',
    weights: [0.6, 0.3, 0.1],
    rr: [0.8, 1.5, 2.2],
    partial_pcts: [60, 30, 10],
  },
  wide_stop: {
    id: 'wide_stop',
    label: 'Wide-stop book 40/40/20 @1/2/3R',
    weights: [0.4, 0.4, 0.2],
    rr: [1, 2, 3],
    partial_pcts: [40, 40, 20],
  },
  cfa_precision: {
    id: 'cfa_precision',
    label: 'CFA precision 40/40/20 @1/2/3R',
    weights: [0.4, 0.4, 0.2],
    rr: [1, 2, 3],
    partial_pcts: [40, 40, 20],
  },
  /**
   * Stratzy: closer T1 + heavy first book so more paths lock before 15:15 X_TIME.
   * 60d BTs (Aug 2026): majority died at X_TIME before 0.8R; 0.6R + 70% book targets that leak.
   */
  stratzy_trend: {
    id: 'stratzy_trend',
    label: 'Stratzy trend 70/20/10 @0.6/1.4/2.2R',
    weights: [0.7, 0.2, 0.1],
    rr: [0.6, 1.4, 2.2],
    partial_pcts: [70, 20, 10],
  },
};

export function resolveExitProfile(id?: string | null): ExitProfile {
  const key = String(id ?? 'as_planned') as ExitProfileId;
  return PROFILES[key] ?? PROFILES.as_planned;
}

export function exitProfileIds(): ExitProfileId[] {
  return Object.keys(PROFILES) as ExitProfileId[];
}

/** Build absolute target prices from entry/stop and profile R multiples. */
export function targetsFromProfile(
  entry: number,
  stop: number,
  isLong: boolean,
  profile: ExitProfile = PROFILES.as_planned,
): number[] {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return [];
  return profile.rr.map((rr) =>
    Math.round((isLong ? entry + risk * rr : entry - risk * rr) * 100) / 100,
  );
}

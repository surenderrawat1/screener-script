/** Entry rule tiers for v3.11-lite — hard risk vs soft / style catalysts. */

export type EntryRuleTier = 'hard' | 'soft';

export interface EntryRuleMeta {
  id: string;
  tier: EntryRuleTier;
  /** Short CFA-facing role. */
  role: string;
}

/** Canonical hard vs soft classification (matches evaluate-entry v3.11-lite). */
export const ENTRY_RULE_META: EntryRuleMeta[] = [
  { id: 'E1', tier: 'hard', role: 'Primary SMA trend' },
  { id: 'E2', tier: 'hard', role: 'Pullback zone' },
  { id: 'E3', tier: 'hard', role: 'MACD momentum' },
  { id: 'E4', tier: 'hard', role: '52-week band' },
  { id: 'E5', tier: 'hard', role: 'Not overextended' },
  { id: 'E6', tier: 'hard', role: 'Liquidity' },
  { id: 'E7', tier: 'hard', role: 'EMA primary trend' },
  { id: 'E8', tier: 'hard', role: 'Price action' },
  { id: 'E9', tier: 'soft', role: 'Dynamic momentum (advisory)' },
  { id: 'E10', tier: 'soft', role: 'EMA-21 extension (soft w/ E2)' },
  { id: 'E11', tier: 'soft', role: 'GC9 catalyst (optional)' },
  { id: 'E12', tier: 'soft', role: '20 MA Stratzy (style filter)' },
];

export const HARD_ENTRY_RULE_IDS = ENTRY_RULE_META.filter((r) => r.tier === 'hard').map((r) => r.id);
export const SOFT_ENTRY_RULE_IDS = ENTRY_RULE_META.filter((r) => r.tier === 'soft').map((r) => r.id);

export function entryRuleTier(id: string): EntryRuleTier {
  return ENTRY_RULE_META.find((r) => r.id === id)?.tier ?? 'hard';
}

export function entryRuleRole(id: string): string {
  return ENTRY_RULE_META.find((r) => r.id === id)?.role ?? '';
}

export function summarizeHardSoftRules(
  rules: Array<{ id?: string; passed?: boolean | null }>,
): {
  hard_passed: number;
  hard_total: number;
  soft_passed: number;
  soft_total: number;
  soft_pending: number;
} {
  let hardPassed = 0;
  let hardTotal = 0;
  let softPassed = 0;
  let softTotal = 0;
  let softPending = 0;
  for (const r of rules) {
    const id = String(r.id ?? '');
    if (!id) continue;
    const tier = entryRuleTier(id);
    if (tier === 'hard') {
      hardTotal += 1;
      if (r.passed === true) hardPassed += 1;
    } else {
      softTotal += 1;
      if (r.passed === true) softPassed += 1;
      else if (r.passed === null) softPending += 1;
    }
  }
  return {
    hard_passed: hardPassed,
    hard_total: hardTotal,
    soft_passed: softPassed,
    soft_total: softTotal,
    soft_pending: softPending,
  };
}

import { ENGINE_VERSION, MAX_TARGET_PCT, MIN_R_MULTIPLE, MIN_TARGET_PCT } from './evaluate-entry.js';
import {
  DEFAULT_STOP_LOSS_PCT,
  EXIT_PARTIAL_TARGET_FRACTION,
  exitRuleDefinitions,
  exitRuleSummary,
  SIDEWAYS_TIME_STOP_DAYS,
} from './evaluate-exit.js';
import { ENTRY_RULE_META, HARD_ENTRY_RULE_IDS, SOFT_ENTRY_RULE_IDS } from './entry-rule-tiers.js';
import { SWING_PARTIAL_RR, SWING_PARTIAL_WEIGHTS } from './swing-backtest.js';

export const MIN_NET_EDGE_PCT = 4.0;
export const ESTIMATED_ROUND_TRIP_CHARGE_PCT = 1.25;
export const ENTRY_RULE_COUNT = 12;

export const SCORE_CATEGORY_MAX = {
  trend: 25,
  momentum: 20,
  volume: 15,
  price_action: 20,
  volatility: 10,
  risk: 10,
} as const;

export function buildSwingEngineMeta() {
  return {
    engine_version: ENGINE_VERSION,
    entry_rule_count: ENTRY_RULE_COUNT,
    hard_entry_rule_count: HARD_ENTRY_RULE_IDS.length,
    soft_entry_rule_count: SOFT_ENTRY_RULE_IDS.length,
    entry_rule_tiers: ENTRY_RULE_META,
    rule_stack_note:
      'v3.18: next-open fill + tape-aligned truth; E1–E8 hard; E9–E12 soft. Target = frozen 3R. BT books 40/40/20 @1R/2R/3R.',
    min_r_multiple: MIN_R_MULTIPLE,
    min_net_edge_pct: MIN_NET_EDGE_PCT,
    estimated_round_trip_charge_pct: ESTIMATED_ROUND_TRIP_CHARGE_PCT,
    default_hard_stop_pct: DEFAULT_STOP_LOSS_PCT,
    min_target_pct: MIN_TARGET_PCT,
    max_target_pct: MAX_TARGET_PCT,
    target_policy: 'frozen_3r_band',
    sideways_time_stop_days: SIDEWAYS_TIME_STOP_DAYS,
    partial_target_fraction: EXIT_PARTIAL_TARGET_FRACTION,
    bt_scaled_weights: [...SWING_PARTIAL_WEIGHTS],
    bt_scaled_rr: [...SWING_PARTIAL_RR],
    score_categories: Object.entries(SCORE_CATEGORY_MAX).map(([key, max]) => ({
      key,
      max,
      label:
        key === 'price_action' ? 'PA' : key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' '),
    })),
    exit_rules: exitRuleDefinitions(),
    exit_rules_summary: exitRuleSummary(),
  };
}

import { ENGINE_VERSION, MIN_R_MULTIPLE } from './evaluate-entry.js';
import {
  DEFAULT_STOP_LOSS_PCT,
  EXIT_PARTIAL_TARGET_FRACTION,
  exitRuleDefinitions,
  exitRuleSummary,
  MIN_TARGET_PCT,
  SIDEWAYS_TIME_STOP_DAYS,
} from './evaluate-exit.js';

export const MIN_NET_EDGE_PCT = 4.0;
export const ESTIMATED_ROUND_TRIP_CHARGE_PCT = 1.25;
export const ENTRY_RULE_COUNT = 11;

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
    min_r_multiple: MIN_R_MULTIPLE,
    min_net_edge_pct: MIN_NET_EDGE_PCT,
    estimated_round_trip_charge_pct: ESTIMATED_ROUND_TRIP_CHARGE_PCT,
    default_hard_stop_pct: DEFAULT_STOP_LOSS_PCT,
    min_target_pct: MIN_TARGET_PCT,
    sideways_time_stop_days: SIDEWAYS_TIME_STOP_DAYS,
    partial_target_fraction: EXIT_PARTIAL_TARGET_FRACTION,
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

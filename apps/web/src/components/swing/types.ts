import type { SwingRuleRow } from './SwingRulesTable';

export interface SwingEngineMeta {
  engine_version: string;
  entry_rule_count: number;
  hard_entry_rule_count?: number;
  soft_entry_rule_count?: number;
  rule_stack_note?: string;
  min_r_multiple: number;
  min_net_edge_pct: number;
  estimated_round_trip_charge_pct: number;
  default_hard_stop_pct: number;
  min_target_pct: number;
  max_target_pct?: number;
  target_policy?: string;
  sideways_time_stop_days: number;
  partial_target_fraction: number;
  score_categories: { key: string; max: number; label: string }[];
  exit_rules: string[];
  exit_rules_summary: string;
}

export interface SwingEntryPayload {
  engine_version?: string;
  discovery_verdict?: string;
  strict_verdict?: string;
  strict_enter_ready?: boolean;
  strict_floor?: number;
  entry_score?: number;
  entry_score_detail?: Record<string, number>;
  rules_passed?: number;
  rules_scored?: number;
  rules_hard_passed?: number;
  rules_hard_total?: number;
  rules_soft_passed?: number;
  rules_soft_total?: number;
  rules?: SwingRuleRow[];
  entry_price?: number;
  stop_loss?: number | null;
  hard_stop?: number | null;
  structural_stop?: number | null;
  stop_pct?: number | null;
  risk_pct?: number | null;
  profit_target?: number | null;
  r_multiple?: number | null;
  r_multiple_ok?: boolean;
  min_r_multiple?: number;
  target_pct?: number | null;
  time_stop_days?: number;
  deploy_scale?: number;
  net_edge_ok?: boolean;
  liquidity_strict?: boolean;
  price_action?: Record<string, unknown>;
  gc9?: Record<string, unknown>;
  dynamic?: Record<string, unknown>;
  regime?: Record<string, unknown>;
}

export interface SwingEvaluateResponse {
  ok: boolean;
  symbol: string;
  price: number;
  as_of_date?: string | null;
  regime?: Record<string, unknown>;
  entry: SwingEntryPayload;
  ta?: Record<string, unknown>;
  engine_meta?: SwingEngineMeta;
  scan_eligibility?: { passes: boolean; failed: string[] };
  filters?: Record<string, unknown>;
  error?: string;
}

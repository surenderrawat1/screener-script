export interface OhlcBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TaMetrics = Record<string, unknown>;

export interface SwingRule {
  id: string;
  name: string;
  criterion: string;
  passed: boolean | null;
  detail: string;
}

export interface SwingScanOptions {
  min_verdict?: 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL';
  sort_by?: string;
  zone_52w?: string;
  breakout_volume?: boolean;
  gc9_only?: boolean;
  regime?: Record<string, unknown> | null;
}

export interface SwingScanHit {
  symbol: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  entry_score: number;
  rules_passed: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  r_multiple_ok: boolean;
  ta_avg_value_cr: number | null;
  swing_rank?: number;
  stale?: boolean;
  regime_key?: string | null;
  [key: string]: unknown;
}

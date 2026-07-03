import { z } from 'zod';
import { ROLES, SCREENER_PRESETS } from './constants.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const screenerRunSchema = z.object({
  universe: z.string().min(1),
  preset: z.enum(SCREENER_PRESETS).optional(),
  maxScan: z.number().int().min(10).max(2000).default(200),
  background: z.boolean().optional(),
  refresh: z.boolean().optional(),
  exclude_restricted: z.boolean().optional(),
  filters: z.record(z.unknown()).optional(),
});

export const verifyAutoSchema = z.object({
  symbol: z.string().min(1).max(32),
  refresh: z.boolean().optional(),
});

export const verifyFullFetchSchema = z.object({
  symbol: z.string().min(1).max(32),
  refresh: z.boolean().optional(),
  manual: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const verifyFullRunSchema = z.object({
  symbol: z.string().min(1).max(32).optional(),
  input: z.record(z.union([z.string(), z.number(), z.boolean()])),
});

export const verifyFullDraftSchema = z.object({
  symbol: z.string().min(1).max(32),
  input: z.record(z.union([z.string(), z.number(), z.boolean()])),
  auto_keys: z.array(z.string()).optional(),
});

export type VerifyFullFetchInput = z.infer<typeof verifyFullFetchSchema>;
export type VerifyFullRunInput = z.infer<typeof verifyFullRunSchema>;
export type VerifyFullDraftInput = z.infer<typeof verifyFullDraftSchema>;

export const createUniverseSchema = z.object({
  name: z.string().min(1).max(120),
  symbols: z.array(z.string().min(1)).optional(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum([ROLES.ADMIN, ROLES.ANALYST, ROLES.VIEWER]),
});

export const watchlistUpsertSchema = z.object({
  symbol: z.string().min(1).max(32),
  notes: z.string().max(2000).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const swingPositionCreateSchema = z.object({
  symbol: z.string().min(1).max(32),
  entry_price: z.number().positive(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().nonnegative().optional(),
  stop_loss: z.number().positive().optional(),
  profit_target: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
  source: z.string().max(64).optional(),
});

export const swingPositionCloseSchema = z.object({
  closed_price: z.number().positive(),
  closed_reason: z.string().max(120).optional(),
});

export const niftyIntradayPositionCreateSchema = z.object({
  instrument_id: z.string().min(1).max(32),
  symbol: z.string().min(1).max(32).optional(),
  side: z.enum(['long', 'short']).default('long'),
  timeframe: z.enum(['5m', '15m']).default('15m'),
  entry_price: z.number().positive(),
  entry_time: z.string().datetime().optional(),
  quantity: z.number().positive().optional(),
  stop_loss: z.number().positive().optional(),
  target_t1: z.number().positive().optional(),
  target_t2: z.number().positive().optional(),
  target_t3: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
  source: z.string().max(64).optional(),
});

export const niftyIntradayPositionCloseSchema = z.object({
  closed_price: z.number().positive(),
  closed_reason: z.string().max(120).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ScreenerRunInput = z.infer<typeof screenerRunSchema>;
export type VerifyAutoInput = z.infer<typeof verifyAutoSchema>;
export type CreateUniverseInput = z.infer<typeof createUniverseSchema>;
export const swingScanSchema = z.object({
  universe: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  maxScan: z.number().int().min(5).max(200).default(50),
  background: z.boolean().optional(),
  min_verdict: z.enum(['ENTER', 'SETUP_PLUS', 'WATCH', 'ALL']).optional(),
  zone_52w: z.string().optional(),
  gc9_only: z.boolean().optional(),
  breakout_volume: z.boolean().optional(),
  refresh: z.boolean().optional(),
});

export type SwingScanInput = z.infer<typeof swingScanSchema>;

export const strategyRunSchema = z.object({
  strategy: z.string().min(1).max(64),
  universe: z.string().min(1).optional(),
  maxScan: z.number().int().min(0).max(2000).optional(),
  refresh: z.boolean().optional(),
  background: z.boolean().optional(),
});

export type StrategyRunInput = z.infer<typeof strategyRunSchema>;
export type WatchlistUpsertInput = z.infer<typeof watchlistUpsertSchema>;
export type SwingPositionCreateInput = z.infer<typeof swingPositionCreateSchema>;
export type NiftyIntradayPositionCreateInput = z.infer<typeof niftyIntradayPositionCreateSchema>;

export interface StockMetrics {
  symbol: string;
  name?: string;
  price?: number;
  pe?: number;
  eps?: number;
  book_value?: number;
  roe?: number;
  roce?: number;
  sales_yoy?: number;
  profit_yoy?: number;
  eps_growth?: number;
  revenue_growth?: number;
  revenue_growth_3yr?: number;
  sector?: string;
  market_cap_cr?: number;
  debt_to_equity?: number;
  div_yield?: number;
  [key: string]: unknown;
}

export interface MosEstimate {
  intrinsic: number;
  mos: number | null;
  zone: string;
  action: string;
  fair_pe: number;
  method: string;
  graham: number;
  quality_score?: number;
  final_rating?: string;
}

export interface ScreenerRow extends MosEstimate {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  roce: number;
  composite_score: number;
  recommendation: string;
  passed: boolean;
  promoter_holding?: number;
  moat_tier?: string;
  moat_count?: number;
  market_cap_cr?: number;
  sales_yoy?: number;
  div_yield?: number;
  ta_ready?: boolean;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_macd_hist?: number | null;
  ta_bb_pct_b?: number | null;
  ta_bottom_out_hint?: boolean | null;
  ta_bottom_out_score?: number | null;
  ta_52w_chart_zone?: string | null;
  ta_above_sma50?: boolean | null;
  ta_macd_bullish?: boolean | null;
}

export interface JobProgress {
  phase: string;
  total: number;
  processed: number;
  passed: number;
}

export const cfaTermUpsertSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case'),
  category: z.string().min(1).max(32),
  title: z.string().min(1).max(120),
  definition: z.string().min(1).max(8000),
  formula: z.string().max(4000).optional().nullable(),
  example: z.string().max(2000).optional().nullable(),
  phaseRefs: z.array(z.string()).optional(),
  relatedKeys: z.array(z.string()).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type CfaTermUpsertInput = z.infer<typeof cfaTermUpsertSchema>;

export interface CfaTermDto {
  key: string;
  category: string;
  title: string;
  definition: string;
  formula: string | null;
  example: string | null;
  phase_refs: string[];
  related_keys: string[];
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

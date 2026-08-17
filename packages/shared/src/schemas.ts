import { z } from 'zod';
import { ROLES, SCREENER_PRESETS } from './constants.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16),
});

/** Accept API zones plus UI aliases low→green, high→red. */
export const zone52wSchema = z
  .enum(['any', 'green', 'mid', 'red', 'low', 'high'])
  .transform((v) => (v === 'low' ? 'green' : v === 'high' ? 'red' : v))
  .optional();

export const screenerRunSchema = z.object({
  universe: z.string().min(1),
  preset: z.enum(SCREENER_PRESETS).optional(),
  maxScan: z.number().int().min(10).max(2000).default(200),
  background: z.boolean().optional(),
  refresh: z.boolean().optional(),
  exclude_restricted: z.boolean().optional(),
  recommendation_filter: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
});

export const verifyAutoSchema = z.object({
  symbol: z.string().min(1).max(32),
  refresh: z.boolean().optional(),
});

export const verifyBatchSchema = z
  .object({
    universe: z.string().min(1).optional(),
    symbols: z.array(z.string().min(1).max(32)).optional(),
    maxScan: z.number().int().min(10).max(2000).optional(),
    refresh: z.boolean().optional(),
  })
  .refine(
    (v) => (v.symbols?.length ?? 0) > 0 || Boolean(v.universe),
    { message: 'Provide either symbols[] or universe', path: ['symbols'] },
  );

export const verifyFullFetchSchema = z.object({
  symbol: z.string().min(1).max(32),
  refresh: z.boolean().optional(),
  manual: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const verifyFullRunSchema = z.object({
  symbol: z.string().min(1).max(32).optional(),
  input: z.record(z.union([z.string(), z.number(), z.boolean()])),
  /** From last Fetch & Fill — drives D1 cache freshness gate. */
  cache_meta: z
    .object({
      created_at: z.number().int().positive(),
      expires_at: z.number().int().positive().optional(),
      from_cache: z.boolean().optional(),
    })
    .optional(),
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

export const swingPositionUpdateSchema = z.object({
  entry_price: z.number().positive().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  shares: z.number().nonnegative().nullable().optional(),
  stop_loss: z.number().positive().nullable().optional(),
  profit_target: z.number().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
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

export const niftyIntradayPositionUpdateSchema = z.object({
  entry_price: z.number().positive().optional(),
  quantity: z.number().positive().nullable().optional(),
  stop_loss: z.number().positive().nullable().optional(),
  target_t1: z.number().positive().nullable().optional(),
  target_t2: z.number().positive().nullable().optional(),
  target_t3: z.number().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  t1_booked: z.boolean().optional(),
  t2_booked: z.boolean().optional(),
  breakeven_armed: z.boolean().optional(),
});

export const paperWalletArmSchema = z.object({
  armed: z.boolean(),
});

export const swingPaperArchiveSchema = z.object({
  label: z.string().max(120).optional(),
  reset_wallet: z.boolean().optional(),
});

export const paperPositionCloseSchema = z.object({
  closed_price: z.number().positive().optional(),
  closed_reason: z.string().max(120).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ScreenerRunInput = z.infer<typeof screenerRunSchema>;
export type VerifyAutoInput = z.infer<typeof verifyAutoSchema>;
export type CreateUniverseInput = z.infer<typeof createUniverseSchema>;
export const swingScanSchema = z.object({
  universe: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  maxScan: z.number().int().min(0).max(2000).default(0),
  background: z.boolean().optional(),
  min_verdict: z.enum(['ENTER', 'SETUP_PLUS', 'WATCH', 'ALL']).optional(),
  zone_52w: zone52wSchema,
  gc9_only: z.boolean().optional(),
  breakout_volume: z.boolean().optional(),
  min_rules_passed: z.number().int().min(1).max(8).optional(),
  require_rules: z.array(z.enum(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12'])).optional(),
  sort_by: z
    .enum(['swing_rank', 'rules_passed', 'r_multiple', 'pct_52w', 'volume_ratio', 'entry_score', 'rsi', 'symbol'])
    .optional(),
  refresh: z.boolean().optional(),
});

export type SwingScanInput = z.infer<typeof swingScanSchema>;

export const swingEvaluateSchema = z.object({
  symbol: z.string().min(1),
  refresh: z.boolean().optional(),
  min_verdict: z.enum(['ENTER', 'SETUP_PLUS', 'WATCH', 'ALL']).optional(),
  zone_52w: zone52wSchema,
  gc9_only: z.boolean().optional(),
  breakout_volume: z.boolean().optional(),
  min_rules_passed: z.number().int().min(1).max(8).optional(),
  require_rules: z.array(z.enum(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12'])).optional(),
});

export type SwingEvaluateInput = z.infer<typeof swingEvaluateSchema>;

export const swingEvaluateExitSchema = z.object({
  symbol: z.string().min(1),
  entry_price: z.number().positive(),
  entry_date: z.string().min(8),
  profit_target: z.number().positive().optional(),
  target_pct: z.number().positive().optional(),
  refresh: z.boolean().optional(),
});

export type SwingEvaluateExitInput = z.infer<typeof swingEvaluateExitSchema>;

export const swingBacktestSchema = z
  .object({
    symbol: z.string().min(1).optional(),
    symbols: z.array(z.string().min(1)).max(50).optional(),
    universe: z.string().min(1).optional(),
    maxScan: z.number().int().min(1).max(50).optional(),
    warmup: z.number().int().min(100).max(300).optional(),
    forward_sessions: z.number().int().min(5).max(60).optional(),
    min_verdict: z.enum(['ENTER', 'SETUP_PLUS', 'WATCH', 'ALL']).optional(),
    zone_52w: zone52wSchema,
    gc9_only: z.boolean().optional(),
    breakout_volume: z.boolean().optional(),
    min_rules_passed: z.number().int().min(1).max(8).optional(),
    require_rules: z.array(z.enum(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12'])).optional(),
    portfolio_gates: z.boolean().optional(),
    portfolio_nav: z.number().positive().max(1_000_000_000).optional(),
    notional_inr: z.number().positive().max(5_000_000).optional(),
    refresh: z.boolean().optional(),
    /** Phase D — walk-forward Auto-tier replay (default on for single-symbol). */
    auto_tiers: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.symbol?.trim()) || Boolean(v.symbols?.length) || Boolean(v.universe), {
    message: 'symbol, symbols, or universe required',
  });

export type SwingBacktestInput = z.infer<typeof swingBacktestSchema>;

// --- M12: Screener point-in-time (PIT) backtest (MVP: TA-only)
export const screenerPitBacktestSchema = z
  .object({
    universe: z.string().min(1).optional(),
    symbols: z.array(z.string().min(1).max(16)).optional(),
    // Screener preset key (e.g. `ta_pullback`, `quality`, etc.). For MVP we mainly rely on its TA gates.
    preset: z.string().min(1).optional(),
    // Additional Screener filters to apply.
    filters: z.record(z.unknown()).optional(),
    /**
     * How far back from the latest daily bar to compute TA indicators (bar offset, not strict calendar days).
     * Example: `asOfDaysAgo=180` means "use bars[length-1-180]".
     */
    asOfDaysAgo: z.number().int().min(10).max(600).optional(),
    /** Forward horizon measured in daily bars ahead. */
    forwardDays: z.number().int().min(5).max(120).optional(),
    refresh: z.boolean().optional(),
    maxScan: z.number().int().min(1).max(2000).optional(),
  })
  .refine((v) => Boolean(v.symbols?.length) || Boolean(v.universe), {
    message: 'symbols or universe required',
  });

export type ScreenerPitBacktestInput = z.infer<typeof screenerPitBacktestSchema>;

export const swingAutoScanSchema = z.object({
  force: z.boolean().optional(),
  full: z.boolean().optional(),
});

export type SwingAutoScanInput = z.infer<typeof swingAutoScanSchema>;

export const intradayBacktestSchema = z.object({
  instrument: z.string().min(1).optional(),
  interval: z.enum(['5m', '15m']).optional(),
  mode: z.enum(['single', 'combo_compare']).optional(),
  preset_id: z.string().min(1).optional(),
  days: z.number().int().min(5).max(60).optional(),
  refresh: z.boolean().optional(),
});

export type IntradayBacktestInput = z.infer<typeof intradayBacktestSchema>;

export const strategyRunSchema = z.object({
  strategy: z.string().min(1).max(64),
  universe: z.string().min(1).optional(),
  maxScan: z.number().int().min(0).max(2000).optional(),
  refresh: z.boolean().optional(),
  background: z.boolean().optional(),
});

export type StrategyRunInput = z.infer<typeof strategyRunSchema>;

// --- Strategy builder (M11) — user custom screener presets (minimal slice)
export const userScreenerPresetCreateSchema = z.object({
  name: z.string().min(1).max(80),
  // Stored as raw ScreenerFilters JSON (whatever keys are supported by the screener engine).
  filters: z.record(z.unknown()),
});

export type UserScreenerPresetCreateInput = z.infer<typeof userScreenerPresetCreateSchema>;

export const userScreenerPresetUpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    filters: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.name != null || v.filters != null, { message: 'Provide name and/or filters.' });

export type UserScreenerPresetUpdateInput = z.infer<typeof userScreenerPresetUpdateSchema>;

// --- Strategy builder (M11) — custom swing rule profiles (minimal slice)
export const swingRuleProfileCreateSchema = z.object({
  name: z.string().min(1).max(80),
  options: z.record(z.unknown()),
});

export type SwingRuleProfileCreateInput = z.infer<typeof swingRuleProfileCreateSchema>;

export const swingRuleProfileUpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    options: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.name != null || v.options != null, { message: 'Provide name and/or options.' });

export type SwingRuleProfileUpdateInput = z.infer<typeof swingRuleProfileUpdateSchema>;

export type WatchlistUpsertInput = z.infer<typeof watchlistUpsertSchema>;
export type SwingPositionCreateInput = z.infer<typeof swingPositionCreateSchema>;
export type SwingPositionUpdateInput = z.infer<typeof swingPositionUpdateSchema>;
export type NiftyIntradayPositionCreateInput = z.infer<typeof niftyIntradayPositionCreateSchema>;
export type NiftyIntradayPositionUpdateInput = z.infer<typeof niftyIntradayPositionUpdateSchema>;

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

export interface ScreenerInsightWarning {
  text: string;
  severity: 'critical' | 'watch' | 'info';
  category: string;
  label: string;
}

export interface ScreenerRow extends MosEstimate {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  roce: number;
  composite_score: number;
  verify_score?: number;
  score_basis?: 'quality_proxy' | 'full_scorecard';
  recommendation_basis?: 'screening_matrix' | 'full_verify_matrix';
  recommendation: string;
  passed: boolean;
  promoter_holding?: number;
  promoter_pledge?: number;
  promoter_pledge_as_of?: string;
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
  ta_cross_above_sma20?: boolean | null;
  ta_cross_below_sma20?: boolean | null;
  ta_cross_above_sma50?: boolean | null;
  ta_cross_below_sma50?: boolean | null;
  ta_cross_above_ema20?: boolean | null;
  ta_cross_below_ema20?: boolean | null;
  ta_cross_above_ema50?: boolean | null;
  ta_cross_below_ema50?: boolean | null;
  ta_h_cross_above_sma20?: boolean | null;
  ta_h_cross_below_sma20?: boolean | null;
  ta_h_cross_above_sma50?: boolean | null;
  ta_h_cross_below_sma50?: boolean | null;
  ta_h_cross_above_ema20?: boolean | null;
  ta_h_cross_below_ema20?: boolean | null;
  ta_h_cross_above_ema50?: boolean | null;
  ta_h_cross_below_ema50?: boolean | null;
  ta_cross_above_sma20_bars?: number | null;
  ta_cross_above_sma50_bars?: number | null;
  ta_cross_above_ema20_bars?: number | null;
  ta_cross_above_ema50_bars?: number | null;
  ta_h_cross_above_sma20_bars?: number | null;
  ta_h_cross_above_sma50_bars?: number | null;
  ta_h_cross_above_ema20_bars?: number | null;
  ta_h_cross_above_ema50_bars?: number | null;
  dcf_value?: number;
  pe_intrinsic?: number;
  graham_mos?: number | null;
  graham_credible?: boolean;
  altman_z?: number;
  altman_zone?: string;
  z_score_source?: string;
  altman_skip?: boolean;
  sector_key?: string;
  verify_decision?: string;
  verify_cached?: boolean;
  verify_iv?: number;
  iv_delta_pct?: number;
  iv_drift_warn?: boolean;
  parity_from_cache?: boolean;
  screener_warnings?: ScreenerInsightWarning[];
  screener_has_critical?: boolean;
  screener_has_watch?: boolean;
  promoter_holding_trend?: string;
  promoter_holding_change_pp?: number;
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

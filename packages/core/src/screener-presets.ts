export interface ScreenerFilters {
  min_roe?: number;
  min_roce?: number;
  min_mos?: number;
  max_pe?: number;
  min_promoter_holding?: number;
  min_sales_yoy?: number;
  min_mcap_cr?: number;
  min_div_yield?: number;
  min_score?: number;
  min_moat_tier?: string;
  min_moat_count?: number;
  ta_preset?: boolean;
  show_ta?: boolean;
  technical_only?: boolean;
  min_rsi?: number;
  max_rsi?: number;
  min_pct_52w?: number;
  max_pct_52w?: number;
  min_bb_pct_b?: number;
  max_bb_pct_b?: number;
  above_sma20?: boolean;
  above_sma50?: boolean;
  above_sma200?: boolean;
  zone_52w?: string;
  green_zone_52w?: boolean;
  macd_bullish?: boolean;
  below_bb_lower?: boolean;
  bottom_out_hint?: boolean;
  golden_cross_50_200?: boolean;
  death_cross_50_200?: boolean;
  golden_cross_9_50?: boolean;
  death_cross_9_50?: boolean;
  bull_ma_stack?: boolean;
  bear_ma_stack?: boolean;
}

/** Fundamental + moat filter map — PHP NseStockScreener::PRESETS parity (TA gates applied when enrichment ships). */
export const PRESET_FILTERS: Record<string, ScreenerFilters> = {
  quality: { min_roe: 15, min_roce: 15, max_pe: 35, min_sales_yoy: 0, min_mcap_cr: 3000 },
  value: { min_roe: 10, min_roce: 12, max_pe: 20, min_sales_yoy: -5, min_mcap_cr: 5000 },
  growth: { min_roe: 12, min_roce: 12, max_pe: 45, min_sales_yoy: 10, min_mcap_cr: 2000 },
  defensive: { min_roe: 12, min_roce: 12, max_pe: 25, min_div_yield: 1.5, min_mcap_cr: 5000 },
  cfa_top: { min_roe: 12, min_roce: 12, max_pe: 40, min_sales_yoy: -5, min_mcap_cr: 2000 },
  deep_value: { min_roe: 10, min_roce: 12, max_pe: 30, min_mos: 25, min_mcap_cr: 2000 },
  buy_zone: { min_roe: 12, min_roce: 12, max_pe: 35, min_mos: 15, min_sales_yoy: 0, min_mcap_cr: 3000 },
  buy_picks: { min_roe: 10, min_roce: 12, max_pe: 40, min_mos: 10, min_score: 63, min_mcap_cr: 2000 },
  fair_mos: { min_roe: 15, min_roce: 15, max_pe: 40, min_mos: 0, min_mcap_cr: 5000 },
  near_iv: { min_roe: 10, min_roce: 12, max_pe: 45, min_mos: -5, min_mcap_cr: 3000 },
  strong_buy: { min_roe: 12, min_roce: 12, max_pe: 35, min_mos: 20, min_score: 80, min_mcap_cr: 3000 },
  moat_compounders: {
    min_roe: 15,
    min_roce: 18,
    max_pe: 40,
    min_sales_yoy: 0,
    min_mcap_cr: 5000,
    min_moat_tier: 'strong',
  },
  moat_at_value: {
    min_roe: 12,
    min_roce: 15,
    max_pe: 38,
    min_mos: 10,
    min_mcap_cr: 3000,
    min_moat_tier: 'strong',
  },
  monopoly_stocks: {
    min_roe: 15,
    min_roce: 20,
    max_pe: 45,
    min_mcap_cr: 10000,
    min_moat_tier: 'strong',
    min_moat_count: 2,
  },
  ta_pullback: {
    min_roe: 15,
    min_roce: 15,
    max_pe: 35,
    min_sales_yoy: 0,
    min_mcap_cr: 3000,
    ta_preset: true,
    show_ta: true,
    min_rsi: 25,
    max_rsi: 45,
    max_pct_52w: 35,
  },
  ta_green_zone: {
    min_roe: 8,
    min_roce: 10,
    max_pe: 50,
    min_mcap_cr: 1500,
    ta_preset: true,
    show_ta: true,
    zone_52w: 'green',
  },
  ta_red_zone: {
    min_roe: 8,
    min_roce: 10,
    max_pe: 55,
    min_mcap_cr: 1500,
    ta_preset: true,
    show_ta: true,
    zone_52w: 'red',
  },
  ta_momentum: {
    min_roe: 12,
    min_roce: 12,
    max_pe: 45,
    min_sales_yoy: 5,
    min_mcap_cr: 3000,
    ta_preset: true,
    show_ta: true,
    min_rsi: 45,
    above_sma50: true,
    above_sma200: true,
    macd_bullish: true,
  },
  ta_oversold: {
    min_roe: 15,
    min_roce: 15,
    max_pe: 35,
    min_mos: 5,
    min_mcap_cr: 3000,
    ta_preset: true,
    show_ta: true,
    max_rsi: 35,
    max_bb_pct_b: 25,
  },
  cfa_moat_bottom: {
    min_roe: 12,
    min_roce: 15,
    max_pe: 38,
    min_mos: 8,
    min_mcap_cr: 3000,
    min_moat_tier: 'strong',
    ta_preset: true,
    show_ta: true,
    bottom_out_hint: true,
    max_pct_52w: 38,
    min_rsi: 25,
    max_rsi: 48,
  },
  cfa_moat_uptrend: {
    min_roe: 15,
    min_roce: 18,
    max_pe: 42,
    min_sales_yoy: 0,
    min_mcap_cr: 5000,
    min_moat_tier: 'strong',
    ta_preset: true,
    show_ta: true,
    above_sma50: true,
    above_sma200: true,
    bull_ma_stack: true,
    macd_bullish: true,
  },
  cfa_best_opportunity: {
    min_roe: 12,
    min_roce: 15,
    max_pe: 38,
    min_mos: 8,
    min_mcap_cr: 3000,
    min_moat_tier: 'strong',
    ta_preset: true,
    show_ta: true,
    bottom_out_hint: true,
    max_pct_52w: 45,
    min_rsi: 25,
    max_rsi: 55,
  },
};

export const PRESET_LABELS: Record<string, { label: string; description: string }> = {
  quality: { label: 'Quality Compounders', description: 'ROCE/ROE quality · mid/large cap' },
  value: { label: 'Value + Quality', description: 'P/E ≤ 20 · ROCE floor' },
  growth: { label: 'GARP Growth', description: 'Sales YoY ≥ 10%' },
  defensive: { label: 'Defensive Dividend', description: 'Yield ≥ 1.5%' },
  cfa_top: { label: 'Senior CFA Screen', description: '6-pillar quality bar' },
  deep_value: { label: 'Deep Value', description: 'MOS ≥ 25%' },
  buy_zone: { label: 'Buy Zone', description: 'MOS ≥ 15%' },
  buy_picks: { label: 'Buy Recommendations', description: 'MOS ≥ 10% · score ≥ 63' },
  fair_mos: { label: 'Fair MOS', description: 'Not overpriced · MOS ≥ 0%' },
  near_iv: { label: 'Near Intrinsic', description: 'Within 5% of IV' },
  strong_buy: { label: 'Strong Buy', description: 'MOS ≥ 20% · score ≥ 80' },
  moat_compounders: { label: 'Moat Compounders', description: 'Strong+ moat · ROCE ≥ 18%' },
  moat_at_value: { label: 'Moat at Value', description: 'Strong moat · MOS ≥ 10%' },
  monopoly_stocks: { label: 'Monopoly & Oligopoly', description: 'Mega-cap · ROCE ≥ 20%' },
  ta_pullback: { label: 'Quality Pullback (TA)', description: 'Quality + RSI 25–45 · max 52w% 35' },
  ta_green_zone: { label: '52w Green Zone', description: 'Pullback phase — low date after high date' },
  ta_red_zone: { label: '52w Red Zone', description: 'Rally phase — high date after low date' },
  ta_momentum: { label: 'Momentum Leaders', description: 'Above SMA-50/200 · MACD bullish · RSI ≥ 45' },
  ta_oversold: { label: 'Oversold Quality', description: 'RSI ≤ 35 · lower Bollinger · MOS ≥ 5%' },
  cfa_moat_bottom: { label: 'Moat @ Bottom', description: 'Strong moat · MOS ≥ 8% · bottom-out TA' },
  cfa_moat_uptrend: { label: 'Moat Uptrend', description: 'Strong moat · bull MA stack · MACD+' },
  cfa_best_opportunity: { label: 'Best Opportunity', description: 'Moat + MOS + bottom-out · RSI recovery band' },
};

export const SCREENER_PRESET_KEYS = Object.keys(PRESET_FILTERS);

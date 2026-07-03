import type { VerifyInput } from './types.js';

function bool(raw: Record<string, unknown>, key: string): boolean {
  const v = raw[key];
  return v === '1' || v === 'yes' || v === 'on' || v === true || v === 1;
}

function float(raw: Record<string, unknown>, key: string, defaultValue = 0): number {
  const v = raw[key];
  if (v === undefined || v === null || v === '') return defaultValue;
  return Number(v);
}

function yesNo(raw: Record<string, unknown>, key: string): boolean | null {
  const v = raw[key];
  if (v === undefined || v === null || v === '') return null;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return v === '1' || v === 'yes' || v === 'on';
}

function normalizeEpsMode(mode: string): string {
  return mode === 'standalone' ? 'standalone' : 'consolidated';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeVerifyInput(raw: Record<string, unknown>): VerifyInput {
  const fetchRaw = String(raw.fetch_symbol ?? raw.stock_name ?? '').trim();
  const fetchSymbol = fetchRaw.split('.')[0]?.toUpperCase() ?? '';

  return {
    fetch_symbol: fetchSymbol,
    stock_name: String(raw.stock_name ?? 'Unknown').trim(),
    sector: String(raw.sector ?? 'general'),
    analysis_date: String(raw.analysis_date ?? todayIso()).trim(),
    market_cap_cr: float(raw, 'market_cap_cr'),
    current_price: float(raw, 'current_price'),
    already_holding: bool(raw, 'already_holding'),
    entry_price: float(raw, 'entry_price'),

    p0_emergency_fund: bool(raw, 'p0_emergency_fund'),
    p0_debt_cleared: bool(raw, 'p0_debt_cleared'),
    p0_sip_habit: bool(raw, 'p0_sip_habit'),
    p0_asset_allocation: bool(raw, 'p0_asset_allocation'),
    p0_emotional_discipline: bool(raw, 'p0_emotional_discipline'),

    p1_business_model: yesNo(raw, 'p1_business_model'),
    p1_revenue_model: yesNo(raw, 'p1_revenue_model'),
    p1_industry_outlook: String(raw.p1_industry_outlook ?? ''),
    p1_circle_competence: yesNo(raw, 'p1_circle_competence'),

    moat_brand: bool(raw, 'moat_brand'),
    moat_cost: bool(raw, 'moat_cost'),
    moat_switching: bool(raw, 'moat_switching'),
    moat_network: bool(raw, 'moat_network'),
    moat_regulatory: bool(raw, 'moat_regulatory'),

    p1_promoter_stable: yesNo(raw, 'p1_promoter_stable'),
    p1_promoter_pledge: float(raw, 'p1_promoter_pledge'),
    pledge_data_as_of: String(raw.pledge_data_as_of ?? '').trim(),
    p1_capital_allocation: yesNo(raw, 'p1_capital_allocation'),
    p1_rpt_normal: yesNo(raw, 'p1_rpt_normal'),
    p1_auditor_clean: yesNo(raw, 'p1_auditor_clean'),

    revenue_y4: float(raw, 'revenue_y4'),
    revenue_y3: float(raw, 'revenue_y3'),
    revenue_y2: float(raw, 'revenue_y2'),
    revenue_y1: float(raw, 'revenue_y1'),
    revenue_latest: float(raw, 'revenue_latest'),
    pat_latest: float(raw, 'pat_latest'),
    eps_mode: normalizeEpsMode(String(raw.eps_mode ?? 'consolidated')),
    eps_consolidated: float(raw, 'eps_consolidated'),
    eps_standalone: float(raw, 'eps_standalone'),
    book_value_consolidated: float(raw, 'book_value_consolidated'),
    book_value_standalone: float(raw, 'book_value_standalone'),
    eps: float(raw, 'eps'),
    ebitda_margin_latest: float(raw, 'ebitda_margin_latest'),
    ebitda_margin_prev: float(raw, 'ebitda_margin_prev'),
    total_debt: float(raw, 'total_debt'),
    shareholders_equity: float(raw, 'shareholders_equity'),
    receivable_days_trend: String(raw.receivable_days_trend ?? 'stable'),
    inventory_days_trend: String(raw.inventory_days_trend ?? 'stable'),
    book_value_prev: float(raw, 'book_value_prev'),
    book_value_latest: float(raw, 'book_value_latest'),
    cfo: float(raw, 'cfo'),
    capex: float(raw, 'capex'),
    fcf: float(raw, 'fcf'),
    dividend_paid_cr: float(raw, 'dividend_paid_cr'),
    p2_revenue_growing: yesNo(raw, 'p2_revenue_growing'),
    p2_pat_quality: yesNo(raw, 'p2_pat_quality'),
    p2_margins_ok: yesNo(raw, 'p2_margins_ok'),
    p2_de_ok: yesNo(raw, 'p2_de_ok'),
    p2_bv_growing: yesNo(raw, 'p2_bv_growing'),
    p2_wc_ok: yesNo(raw, 'p2_wc_ok'),
    p2_fcf_positive: yesNo(raw, 'p2_fcf_positive'),
    p2_cfo_pat: yesNo(raw, 'p2_cfo_pat'),
    p2_fcf_dividend: yesNo(raw, 'p2_fcf_dividend'),
    p2_chairman_honest: bool(raw, 'p2_chairman_honest'),
    p2_auditor_clean: bool(raw, 'p2_auditor_clean'),
    p2_contingent_ok: bool(raw, 'p2_contingent_ok'),
    p2_accounting_ok: bool(raw, 'p2_accounting_ok'),

    roe: float(raw, 'roe'),
    roce: float(raw, 'roce'),
    debt_to_equity: float(raw, 'debt_to_equity'),
    interest_coverage: float(raw, 'interest_coverage'),
    pe_ratio: float(raw, 'pe_ratio'),
    pb_ratio: float(raw, 'pb_ratio'),
    eps_growth: float(raw, 'eps_growth'),
    revenue_growth_3yr: float(raw, 'revenue_growth_3yr'),
    dividend_yield: float(raw, 'dividend_yield'),
    roe_3yr_above_15: yesNo(raw, 'roe_3yr_above_15'),
    roce_near_roe: yesNo(raw, 'roce_near_roe'),
    roe_from_operations: yesNo(raw, 'roe_from_operations'),

    intrinsic_dcf: float(raw, 'intrinsic_dcf'),
    intrinsic_fair_pe: float(raw, 'intrinsic_fair_pe'),
    vt_revenue_declining: bool(raw, 'vt_revenue_declining'),
    vt_div_fcf_mismatch: bool(raw, 'vt_div_fcf_mismatch'),
    vt_industry_disrupted: bool(raw, 'vt_industry_disrupted'),
    vt_debt_falling_margin: bool(raw, 'vt_debt_falling_margin'),
    vt_permanent_decline: bool(raw, 'vt_permanent_decline'),
    p4_revenue_cagr: yesNo(raw, 'p4_revenue_cagr'),
    p4_eps_growth_pace: yesNo(raw, 'p4_eps_growth_pace'),
    p4_peg_ok: yesNo(raw, 'p4_peg_ok'),
    p4_scalable: yesNo(raw, 'p4_scalable'),
    p4_runway: yesNo(raw, 'p4_runway'),
    is_growth_stock: bool(raw, 'is_growth_stock'),
    mr_price_reason: String(raw.mr_price_reason ?? '').trim(),
    mr_business_vs_sentiment: String(raw.mr_business_vs_sentiment ?? '').trim(),
    mr_own_10yr: yesNo(raw, 'mr_own_10yr'),

    piotroski_score: raw.piotroski_score !== undefined && raw.piotroski_score !== '' ? Number(raw.piotroski_score) : -1,
    altman_z: float(raw, 'altman_z'),
    altman_skip: bool(raw, 'altman_skip'),
    z_score_source: String(raw.z_score_source ?? '').trim(),
    dcf_iv: float(raw, 'dcf_iv'),
    p5_fscore_ok: yesNo(raw, 'p5_fscore_ok'),
    p5_zscore_ok: yesNo(raw, 'p5_zscore_ok'),
    p5_dcf_sanity: yesNo(raw, 'p5_dcf_sanity'),

    alt_wc: float(raw, 'alt_wc'),
    alt_retained: float(raw, 'alt_retained'),
    alt_ebit: float(raw, 'alt_ebit'),
    alt_total_assets: float(raw, 'alt_total_assets'),
    alt_total_liabilities: float(raw, 'alt_total_liabilities'),
    alt_sales: float(raw, 'alt_sales'),

    bank_nim: float(raw, 'bank_nim'),
    bank_gnpa: float(raw, 'bank_gnpa'),
    bank_nnpa: float(raw, 'bank_nnpa'),
    bank_casa: float(raw, 'bank_casa'),
    bank_roa: float(raw, 'bank_roa'),
    bank_pcr: float(raw, 'bank_pcr'),
    def_order_book: float(raw, 'def_order_book'),
    def_ob_revenue_ratio: float(raw, 'def_ob_revenue_ratio'),
    def_ebitda_trend: String(raw.def_ebitda_trend ?? ''),
    def_execution_ok: yesNo(raw, 'def_execution_ok'),
    it_rev_growth: float(raw, 'it_rev_growth'),
    it_attrition: float(raw, 'it_attrition'),
    it_usd_mix: float(raw, 'it_usd_mix'),
    it_client_concentration: float(raw, 'it_client_concentration'),
    infra_kpi_ok: yesNo(raw, 'infra_kpi_ok'),
    infra_regulatory_ok: yesNo(raw, 'infra_regulatory_ok'),
    infra_asset_quality: yesNo(raw, 'infra_asset_quality'),
    p6_kpi_identified: yesNo(raw, 'p6_kpi_identified'),
    p6_peer_compared: yesNo(raw, 'p6_peer_compared'),
    p6_macro_noted: yesNo(raw, 'p6_macro_noted'),
    auto_volume_growth: float(raw, 'auto_volume_growth'),
    telecom_arpu: float(raw, 'telecom_arpu'),
    utility_plf: float(raw, 'utility_plf'),

    p7_allocation_fit: yesNo(raw, 'p7_allocation_fit'),
    p7_position_size_ok: yesNo(raw, 'p7_position_size_ok'),
    p7_sector_not_overweight: yesNo(raw, 'p7_sector_not_overweight'),
    p7_correlation_ok: yesNo(raw, 'p7_correlation_ok'),
    p7_entry_plan: yesNo(raw, 'p7_entry_plan'),
    p7_portfolio_diversified: yesNo(raw, 'p7_portfolio_diversified'),
    portfolio_pct: float(raw, 'portfolio_pct'),
    sector_portfolio_pct: float(raw, 'sector_portfolio_pct'),
    exit_thesis_broken: bool(raw, 'exit_thesis_broken'),
    exit_pledge_fraud: bool(raw, 'exit_pledge_fraud'),
    exit_fundamentals_bad: bool(raw, 'exit_fundamentals_bad'),
    exit_overvalued_25: bool(raw, 'exit_overvalued_25'),
    exit_down_25_redflags: bool(raw, 'exit_down_25_redflags'),

    thesis_business: String(raw.thesis_business ?? '').trim(),
    thesis_financials: String(raw.thesis_financials ?? '').trim(),
    thesis_valuation: String(raw.thesis_valuation ?? '').trim(),
    invalidation_1: String(raw.invalidation_1 ?? '').trim(),
    invalidation_2: String(raw.invalidation_2 ?? '').trim(),
    review_date: String(raw.review_date ?? '').trim(),

    rf_tip_buy: bool(raw, 'rf_tip_buy'),
    rf_cannot_explain: bool(raw, 'rf_cannot_explain'),
    rf_stock_up_100: bool(raw, 'rf_stock_up_100'),
    rf_auditor_issue: bool(raw, 'rf_auditor_issue'),
    auto_prefilled:
      raw.auto_prefilled !== undefined &&
      (raw.auto_prefilled === '1' || raw.auto_prefilled === 'yes' || raw.auto_prefilled === 'on' || raw.auto_prefilled === true),
    manual_attestation: bool(raw, 'manual_attestation'),
    use_graham_floor: bool(raw, 'use_graham_floor'),
  };
}

/** Apply consolidated/standalone EPS basis before valuation (EpsModeHelper parity). */
export function applyEpsModeToInput(input: VerifyInput): VerifyInput {
  const mode = String(input.eps_mode ?? 'consolidated') === 'standalone' ? 'standalone' : 'consolidated';
  const out: VerifyInput = { ...input, eps_mode: mode };

  const epsAlt =
    mode === 'standalone' ? Number(out.eps_standalone ?? 0) : Number(out.eps_consolidated ?? 0);
  if (epsAlt > 0) out.eps = epsAlt;

  const bvAlt =
    mode === 'standalone'
      ? Number(out.book_value_standalone ?? 0)
      : Number(out.book_value_consolidated ?? 0);
  if (bvAlt > 0) out.book_value_latest = bvAlt;

  const price = Number(out.current_price ?? 0);
  if (price > 0 && Number(out.eps ?? 0) > 0) {
    out.pe_ratio = Math.round((price / Number(out.eps)) * 100) / 100;
  }

  return out;
}

import {
  OUTLOOK_OPTIONS,
  TREND_OPTIONS,
  VERIFY_SECTOR_OPTIONS,
  YES_NO_OPTIONS,
} from './sectors.js';
import type { VerifyFieldDef, VerifyPhaseDef } from './types.js';

const yesNo = (key: string, label: string, opts?: Partial<VerifyFieldDef>): VerifyFieldDef => ({
  key,
  label,
  type: 'yesno',
  options: YES_NO_OPTIONS,
  ...opts,
});

const check = (key: string, label: string, opts?: Partial<VerifyFieldDef>): VerifyFieldDef => ({
  key,
  label,
  type: 'checkbox',
  ...opts,
});

const num = (key: string, label: string, opts?: Partial<VerifyFieldDef>): VerifyFieldDef => ({
  key,
  label,
  type: 'number',
  ...opts,
});

export const VERIFY_FULL_PHASES: VerifyPhaseDef[] = [
  {
    id: 0,
    title: 'Phase 0 — Investor Foundation',
    shortTitle: 'Phase 0: Investor',
    description:
      'Investor readiness before stock picking. Gate: 0.1 or 0.2 fail → fix personal finance first.',
    manualNote: 'Phase 0 is manual only — your personal finance readiness.',
    fields: [
      {
        key: 'stock_name',
        label: 'Stock name / NSE symbol',
        type: 'text',
        section: 'Stock Under Review',
        required: true,
        placeholder: 'e.g. TCS',
      },
      {
        key: 'sector',
        label: 'Sector',
        type: 'select',
        section: 'Stock Under Review',
        options: VERIFY_SECTOR_OPTIONS,
      },
      {
        key: 'current_price',
        label: 'Current price (₹)',
        type: 'number',
        section: 'Stock Under Review',
        required: true,
      },
      { key: 'market_cap_cr', label: 'Market cap (₹ Cr)', type: 'number', section: 'Stock Under Review' },
      { key: 'analysis_date', label: 'Analysis date', type: 'date', section: 'Stock Under Review' },
      {
        key: 'already_holding',
        label: 'Already holding this stock?',
        type: 'checkbox',
        section: 'Stock Under Review',
        manualOnly: true,
      },
      {
        key: 'entry_price',
        label: 'Entry price (₹)',
        type: 'number',
        section: 'Stock Under Review',
        showWhen: { field: 'already_holding', equals: true },
        manualOnly: true,
      },
      {
        key: 'p0_emergency_fund',
        label: '0.1 Emergency fund 6–12 months expenses',
        type: 'checkbox',
        section: 'Investor Readiness',
        manualOnly: true,
      },
      {
        key: 'p0_debt_cleared',
        label: '0.2 High-interest debt cleared',
        type: 'checkbox',
        section: 'Investor Readiness',
        manualOnly: true,
      },
      {
        key: 'p0_sip_habit',
        label: '0.3 Investing 20–40% income (SIP habit)',
        type: 'checkbox',
        section: 'Investor Readiness',
        manualOnly: true,
      },
      {
        key: 'p0_asset_allocation',
        label: '0.4 Asset allocation defined',
        type: 'checkbox',
        section: 'Investor Readiness',
        manualOnly: true,
      },
      {
        key: 'p0_emotional_discipline',
        label: '0.5 Emotional discipline — no FOMO / panic plan',
        type: 'checkbox',
        section: 'Investor Readiness',
        manualOnly: true,
      },
    ],
  },
  {
    id: 1,
    title: 'Phase 1 — Business Quality',
    shortTitle: 'Phase 1: Business',
    description: 'CRITICAL: 1.1 or 1.2 = No → REJECT. Pledge > 25% → CRITICAL FAIL.',
    manualNote: '1.1–1.4 (circle of competence) are manual. Governance numbers auto-fill when fetched.',
    fields: [
      yesNo('p1_business_model', '1.1 Can you explain the business in 2 sentences?', {
        section: '1A — Circle of Competence',
        manualOnly: true,
      }),
      yesNo('p1_revenue_model', '1.2 Do you know how the company makes money?', {
        section: '1A — Circle of Competence',
        manualOnly: true,
      }),
      {
        key: 'p1_industry_outlook',
        label: '1.3 Industry outlook',
        type: 'select',
        section: '1A — Circle of Competence',
        options: OUTLOOK_OPTIONS,
      },
      yesNo('p1_circle_competence', '1.4 Inside circle of competence?', {
        section: '1A — Circle of Competence',
        manualOnly: true,
      }),
      check('moat_brand', 'Brand / pricing power', { section: '1B — Economic Moat' }),
      check('moat_cost', 'Cost advantage', { section: '1B — Economic Moat' }),
      check('moat_switching', 'Switching costs', { section: '1B — Economic Moat' }),
      check('moat_network', 'Network effects', { section: '1B — Economic Moat' }),
      check('moat_regulatory', 'Regulatory / license barrier', { section: '1B — Economic Moat' }),
      { key: 'pledge_data_as_of', label: 'Pledge data as of', type: 'text', hidden: true },
      yesNo('p1_promoter_stable', '1.5 Promoter holding stable?', { section: '1C — Management & Governance' }),
      num('p1_promoter_pledge', '1.6 Promoter pledge (%)', {
        section: '1C — Management & Governance',
        placeholder: '0',
      }),
      yesNo('p1_capital_allocation', '1.7 Capital allocation track record good?', {
        section: '1C — Management & Governance',
      }),
      yesNo('p1_rpt_normal', '1.8 Related-party transactions normal?', {
        section: '1C — Management & Governance',
      }),
      yesNo('p1_auditor_clean', '1.9 Auditor clean (no qualified opinion)?', {
        section: '1C — Management & Governance',
      }),
    ],
  },
  {
    id: 2,
    title: 'Phase 2 — Financial Statements',
    shortTitle: 'Phase 2: Financials',
    description: 'Revenue, PAT, cash flow quality, and annual-report scan.',
    fields: [
      { key: 'eps_consolidated', label: 'EPS consolidated', type: 'number', hidden: true },
      { key: 'eps_standalone', label: 'EPS standalone', type: 'number', hidden: true },
      { key: 'book_value_consolidated', label: 'BV consolidated', type: 'number', hidden: true },
      { key: 'book_value_standalone', label: 'BV standalone', type: 'number', hidden: true },
      {
        key: 'eps_mode',
        label: 'EPS basis (annual report)',
        type: 'select',
        section: 'P&L',
        options: [
          { value: 'consolidated', label: 'Consolidated' },
          { value: 'standalone', label: 'Standalone' },
        ],
      },
      num('revenue_y4', 'Revenue Year -4', { section: 'P&L' }),
      num('revenue_y3', 'Revenue Year -3', { section: 'P&L' }),
      num('revenue_y2', 'Revenue Year -2', { section: 'P&L' }),
      num('revenue_y1', 'Revenue Year -1', { section: 'P&L' }),
      num('revenue_latest', 'Revenue Latest (₹ Cr)', { section: 'P&L' }),
      num('pat_latest', 'PAT Latest (₹ Cr)', { section: 'P&L' }),
      num('eps', 'EPS (₹)', { section: 'P&L' }),
      num('ebitda_margin_latest', 'EBITDA margin % (latest)', { section: 'P&L' }),
      num('ebitda_margin_prev', 'EBITDA margin % (prev year)', { section: 'P&L' }),
      yesNo('p2_revenue_growing', '2.1 Revenue growing 3–5 years?', { section: 'P&L Gates' }),
      yesNo('p2_pat_quality', '2.2 PAT quality (not one-time)?', { section: 'P&L Gates' }),
      yesNo('p2_margins_ok', '2.3 Margins stable/expanding?', { section: 'P&L Gates' }),
      num('total_debt', 'Total debt (₹ Cr)', { section: 'Balance Sheet' }),
      num('shareholders_equity', "Shareholders' equity (₹ Cr)", { section: 'Balance Sheet' }),
      num('book_value_prev', 'Book value prev (₹ Cr)', { section: 'Balance Sheet' }),
      num('book_value_latest', 'Book value latest (₹ Cr)', { section: 'Balance Sheet' }),
      {
        key: 'receivable_days_trend',
        label: 'Receivable days trend',
        type: 'select',
        section: 'Balance Sheet',
        options: TREND_OPTIONS,
      },
      {
        key: 'inventory_days_trend',
        label: 'Inventory days trend',
        type: 'select',
        section: 'Balance Sheet',
        options: TREND_OPTIONS,
      },
      num('cfo', 'Cash from Operations (CFO)', { section: 'Cash Flow' }),
      num('capex', 'CapEx', { section: 'Cash Flow' }),
      num('fcf', 'Free Cash Flow (FCF)', { section: 'Cash Flow' }),
      num('dividend_paid_cr', 'Dividend paid (₹ Cr)', { section: 'Cash Flow' }),
      yesNo('p2_fcf_positive', '2.7 FCF positive or clear path?', { section: 'Cash Flow Gates' }),
      yesNo('p2_cfo_pat', '2.8 CFO tracks PAT?', { section: 'Cash Flow Gates' }),
      yesNo('p2_fcf_dividend', '2.9 FCF covers dividend?', { section: 'Cash Flow Gates' }),
      check('p2_chairman_honest', 'Chairman/MD letter honest vs numbers', { section: 'AR Scan' }),
      check('p2_auditor_clean', 'Auditor report clean', { section: 'AR Scan' }),
      check('p2_contingent_ok', 'No material contingent liabilities', { section: 'AR Scan' }),
      check('p2_accounting_ok', 'No suspicious accounting policy changes', { section: 'AR Scan' }),
    ],
  },
  {
    id: 3,
    title: 'Phase 3 — Fundamental Ratios',
    shortTitle: 'Phase 3: Ratios',
    description: 'CRITICAL: High ROE + ROCE << ROE + D/E > 1.5 = leverage trap.',
    fields: [
      num('roe', 'ROE (%)'),
      num('roce', 'ROCE (%)'),
      num('debt_to_equity', 'Debt / Equity'),
      num('interest_coverage', 'Interest coverage (×)'),
      num('pe_ratio', 'P/E (optional)'),
      num('pb_ratio', 'P/B (optional)'),
      num('eps_growth', 'EPS growth YoY (%)'),
      num('revenue_growth_3yr', 'Revenue 3-yr CAGR (%)'),
      num('dividend_yield', 'Dividend yield (%)'),
      yesNo('roe_3yr_above_15', '3.1 ROE > 15% for 3+ years?', { section: 'ROE Gates' }),
      yesNo('roce_near_roe', '3.2 ROCE within 5% of ROE?', { section: 'ROE Gates' }),
      yesNo('roe_from_operations', '3.3 High ROE from operations, not debt?', { section: 'ROE Gates' }),
    ],
  },
  {
    id: 4,
    title: 'Phase 4 — Value vs Growth Fit',
    shortTitle: 'Phase 4: Valuation',
    description: 'CRITICAL: 3+ value trap signals → REJECT.',
    fields: [
      num('intrinsic_fair_pe', 'Fair P/E × EPS estimate (₹)', { section: '4A — Intrinsic Value' }),
      num('intrinsic_dcf', 'DCF intrinsic value (₹)', { section: '4A — Intrinsic Value' }),
      check('vt_revenue_declining', '4.1 Low P/E but revenue declining 3+ years', {
        section: '4B — Value Trap Filter',
      }),
      check('vt_div_fcf_mismatch', '4.2 High dividend but FCF cannot pay it', {
        section: '4B — Value Trap Filter',
      }),
      check('vt_industry_disrupted', '4.3 Industry structurally disrupted', {
        section: '4B — Value Trap Filter',
      }),
      check('vt_debt_falling_margin', '4.4 High debt + falling margins', {
        section: '4B — Value Trap Filter',
      }),
      check('vt_permanent_decline', '4.5 Cheap because market sees permanent decline', {
        section: '4B — Value Trap Filter',
      }),
      check('is_growth_stock', 'This is a growth stock (enable 4C checks)', { section: '4C — Growth Stock' }),
      yesNo('p4_revenue_cagr', '4.6 Revenue CAGR > 15%?', {
        section: '4C — Growth Stock',
        showWhen: { field: 'is_growth_stock', equals: true },
      }),
      yesNo('p4_eps_growth_pace', '4.7 EPS growth keeping pace?', {
        section: '4C — Growth Stock',
        showWhen: { field: 'is_growth_stock', equals: true },
      }),
      yesNo('p4_peg_ok', '4.8 PEG ≤ 1.5?', {
        section: '4C — Growth Stock',
        showWhen: { field: 'is_growth_stock', equals: true },
      }),
      yesNo('p4_scalable', '4.9 Scalable model?', {
        section: '4C — Growth Stock',
        showWhen: { field: 'is_growth_stock', equals: true },
      }),
      yesNo('p4_runway', '4.10 Runway 5+ years?', {
        section: '4C — Growth Stock',
        showWhen: { field: 'is_growth_stock', equals: true },
      }),
      {
        key: 'mr_price_reason',
        label: 'Why is price falling/rising recently?',
        type: 'textarea',
        section: '4D — Mr. Market Check',
        placeholder: 'Business vs sentiment...',
      },
      {
        key: 'mr_business_vs_sentiment',
        label: 'Business fundamentals vs market sentiment',
        type: 'textarea',
        section: '4D — Mr. Market Check',
      },
    ],
  },
  {
    id: 5,
    title: 'Phase 5 — Quant Screens',
    shortTitle: 'Phase 5: Quant',
    description: 'Piotroski F-Score, Altman Z, and DCF cross-check.',
    fields: [
      num('piotroski_score', 'Piotroski F-Score (0–9)', { placeholder: '-1 if unknown' }),
      num('altman_z', 'Altman Z', { placeholder: 'Auto or enter' }),
      num('dcf_iv', 'DCF IV cross-check (₹)'),
      check('altman_skip', 'Skip Altman (banking / NBFC / insurance / REIT)'),
      num('alt_wc', 'Altman — Working capital', { section: 'Altman Components' }),
      num('alt_retained', 'Altman — Retained earnings', { section: 'Altman Components' }),
      num('alt_ebit', 'Altman — EBIT', { section: 'Altman Components' }),
      num('alt_total_assets', 'Altman — Total assets', { section: 'Altman Components' }),
      num('alt_total_liabilities', 'Altman — Total liabilities', { section: 'Altman Components' }),
      num('alt_sales', 'Altman — Sales / revenue', { section: 'Altman Components' }),
    ],
  },
  {
    id: 6,
    title: 'Phase 6 — Sector-Specific',
    shortTitle: 'Phase 6: Sector',
    description: 'Tick one sector block — form adapts to sector selected in Phase 0.',
    fields: [
      num('bank_nim', 'NIM %', { sectorPanel: 'banking', section: 'Banking' }),
      num('bank_gnpa', 'GNPA %', { sectorPanel: 'banking', section: 'Banking' }),
      num('bank_nnpa', 'NNPA %', { sectorPanel: 'banking', section: 'Banking' }),
      num('bank_casa', 'CASA %', { sectorPanel: 'banking', section: 'Banking' }),
      num('bank_roa', 'ROA %', { sectorPanel: 'banking', section: 'Banking' }),
      num('bank_pcr', 'PCR %', { sectorPanel: 'banking', section: 'Banking' }),
      num('def_order_book', 'Order book (₹ Cr)', { sectorPanel: 'defence', section: 'Defence' }),
      num('def_ob_revenue_ratio', 'Order book ÷ Revenue (×)', { sectorPanel: 'defence', section: 'Defence' }),
      {
        key: 'def_ebitda_trend',
        label: 'EBITDA margin trend',
        type: 'select',
        sectorPanel: 'defence',
        section: 'Defence',
        options: TREND_OPTIONS,
      },
      yesNo('def_execution_ok', 'Execution / delivery history acceptable?', {
        sectorPanel: 'defence',
        section: 'Defence',
      }),
      num('it_rev_growth', 'Revenue growth %', { sectorPanel: 'it', section: 'IT Services' }),
      num('it_attrition', 'Attrition %', { sectorPanel: 'it', section: 'IT Services' }),
      num('it_usd_mix', 'USD revenue mix %', { sectorPanel: 'it', section: 'IT Services' }),
      num('it_client_concentration', 'Largest client %', { sectorPanel: 'it', section: 'IT Services' }),
      yesNo('infra_kpi_ok', 'Sector KPI acceptable?', { sectorPanel: 'infra', section: 'Infrastructure' }),
      yesNo('infra_regulatory_ok', 'Regulatory risk understood?', { sectorPanel: 'infra', section: 'Infrastructure' }),
      yesNo('infra_asset_quality', 'Asset quality acceptable?', { sectorPanel: 'infra', section: 'Infrastructure' }),
      yesNo('p6_peer_compared', 'Brand/pricing vs 2 peers reviewed?', {
        sectorPanel: 'fmcg',
        section: 'FMCG',
      }),
      yesNo('p6_kpi_identified', 'Volume / market-share KPI identified?', {
        sectorPanel: 'fmcg',
        section: 'FMCG',
      }),
      yesNo('p6_macro_noted', 'Policy / export exposure noted?', {
        sectorPanel: 'pharma',
        section: 'Pharma',
      }),
      yesNo('p6_kpi_identified', 'USFDA / pipeline KPI reviewed?', {
        sectorPanel: 'pharma',
        section: 'Pharma',
      }),
      num('auto_volume_growth', 'Volume / revenue growth %', { sectorPanel: 'auto', section: 'Auto' }),
      yesNo('p6_macro_noted', 'Cycle / EV transition understood?', {
        sectorPanel: 'auto',
        section: 'Auto',
      }),
      yesNo('p6_macro_noted', 'Commodity cycle position understood?', {
        sectorPanel: 'metal',
        section: 'Metals & Mining',
      }),
      yesNo('p6_peer_compared', 'Peer EV/EBITDA compared?', {
        sectorPanel: 'metal',
        section: 'Metals & Mining',
      }),
      yesNo('p6_macro_noted', 'Regional demand / capacity cycle noted?', {
        sectorPanel: 'cement',
        section: 'Cement',
      }),
      yesNo('p6_peer_compared', 'Peer EV/EBITDA compared?', {
        sectorPanel: 'cement',
        section: 'Cement',
      }),
      num('telecom_arpu', 'ARPU (₹ / month)', { sectorPanel: 'telecom', section: 'Telecom' }),
      yesNo('p6_kpi_identified', 'ARPU / churn / subscriber KPI reviewed?', {
        sectorPanel: 'telecom',
        section: 'Telecom',
      }),
      yesNo('p6_macro_noted', 'Spectrum / 5G capex risk noted?', {
        sectorPanel: 'telecom',
        section: 'Telecom',
      }),
      num('utility_plf', 'PLF % (generation)', { sectorPanel: 'utility', section: 'Utilities' }),
      yesNo('infra_kpi_ok', 'PLF / regulated return acceptable?', {
        sectorPanel: 'utility',
        section: 'Utilities',
      }),
      yesNo('infra_regulatory_ok', 'Regulatory / tariff risk understood?', {
        sectorPanel: 'utility',
        section: 'Utilities',
      }),
      yesNo('p6_kpi_identified', 'NAV / occupancy reviewed?', {
        sectorPanel: 'reit',
        section: 'REIT / InvIT',
      }),
      yesNo('p6_peer_compared', 'Distribution yield vs peers compared?', {
        sectorPanel: 'reit',
        section: 'REIT / InvIT',
      }),
      yesNo('p6_kpi_identified', '6.1 Sector KPI identified?', { sectorPanel: 'general', section: 'General' }),
      yesNo('p6_peer_compared', '6.2 Compared to 2 peers?', { sectorPanel: 'general', section: 'General' }),
      yesNo('p6_macro_noted', '6.3 Macro tailwind/headwind noted?', { sectorPanel: 'general', section: 'General' }),
    ],
  },
  {
    id: 7,
    title: 'Phase 7 — Portfolio Fit',
    shortTitle: 'Phase 7: Portfolio',
    description: 'Achha stock bhi galat size mein dangerous. Exit if ANY exit trigger true (if holding).',
    manualNote: 'Phase 7 portfolio fit & exit triggers are manual — your portfolio context.',
    fields: [
      yesNo('p7_allocation_fit', '7.1 Fits asset allocation?', { manualOnly: true }),
      num('portfolio_pct', 'This stock as % of portfolio', { placeholder: 'e.g. 5', manualOnly: true }),
      yesNo('p7_position_size_ok', '7.2 Position ≤ 5–10%?', { manualOnly: true }),
      num('sector_portfolio_pct', 'Sector as % of portfolio', { manualOnly: true }),
      yesNo('p7_sector_not_overweight', '7.3 Sector not overweight (>25%)?', { manualOnly: true }),
      yesNo('p7_correlation_ok', '7.4 Correlation acceptable?', { manualOnly: true }),
      yesNo('p7_entry_plan', '7.5 Entry plan defined?', { manualOnly: true }),
      yesNo('p7_portfolio_diversified', '7.6 Portfolio 12–20 stocks?', { manualOnly: true }),
      check('exit_thesis_broken', 'E.1 Investment thesis broken (business, not price)', {
        section: 'Exit Triggers',
        manualOnly: true,
        showWhen: { field: 'already_holding', equals: true },
      }),
      check('exit_pledge_fraud', 'E.2 Promoter pledge >30% or fraud/accounting issue', {
        section: 'Exit Triggers',
        manualOnly: true,
        showWhen: { field: 'already_holding', equals: true },
      }),
      check('exit_fundamentals_bad', 'E.3 Fundamentals deteriorating 2+ quarters', {
        section: 'Exit Triggers',
        manualOnly: true,
        showWhen: { field: 'already_holding', equals: true },
      }),
      check('exit_overvalued_25', 'E.4 Price >25% above intrinsic value', {
        section: 'Exit Triggers',
        manualOnly: true,
        showWhen: { field: 'already_holding', equals: true },
      }),
      check('exit_down_25_redflags', 'E.5 Down 25%+ AND red flags from Phase 1–3', {
        section: 'Exit Triggers',
        manualOnly: true,
        showWhen: { field: 'already_holding', equals: true },
      }),
      check('rf_cannot_explain', 'Cannot explain business model', { section: 'Red Flag Scan', manualOnly: true }),
      check('rf_tip_buy', 'Bought only on tip / Telegram / hype', { section: 'Red Flag Scan', manualOnly: true }),
      check('rf_stock_up_100', 'Stock up 100%+ in 12 months', { section: 'Red Flag Scan', manualOnly: true }),
      check('rf_auditor_issue', 'Auditor qualified / frequent change', { section: 'Red Flag Scan', manualOnly: true }),
    ],
  },
  {
    id: 8,
    title: 'Phase 8 — Final Thesis & Verdict',
    shortTitle: 'Phase 8: Thesis',
    description: 'Write thesis before any buy. Set review date for annual re-verification.',
    fields: [
      {
        key: 'thesis_business',
        label: '1. Business — why is this a good business?',
        type: 'textarea',
        required: true,
        manualOnly: true,
      },
      {
        key: 'thesis_financials',
        label: '2. Financials — 3 metrics prove quality',
        type: 'textarea',
        manualOnly: true,
      },
      {
        key: 'thesis_valuation',
        label: '3. Valuation — why is price attractive (MOS)?',
        type: 'textarea',
        manualOnly: true,
      },
      {
        key: 'invalidation_1',
        label: 'Invalidation trigger 1 (when to sell)',
        type: 'textarea',
        manualOnly: true,
      },
      {
        key: 'invalidation_2',
        label: 'Invalidation trigger 2',
        type: 'textarea',
        manualOnly: true,
      },
      { key: 'review_date', label: 'Review date', type: 'date', manualOnly: true },
      {
        key: 'manual_attestation',
        label:
          'I confirm Phase 0, 7, and thesis above are personally verified — not auto-generated defaults.',
        type: 'checkbox',
        manualOnly: true,
      },
    ],
  },
];

/** All unique field keys across phases (last definition wins for duplicates like p6_*). */
export function allVerifyFieldKeys(): string[] {
  const keys = new Set<string>();
  for (const phase of VERIFY_FULL_PHASES) {
    for (const field of phase.fields) {
      keys.add(field.key);
    }
  }
  return [...keys];
}

export function defaultValueForField(field: VerifyFieldDef): string | boolean {
  if (field.type === 'checkbox') return false;
  if (field.key === 'eps_mode') return 'consolidated';
  if (field.key === 'piotroski_score') return '-1';
  if (field.key === 'p1_promoter_pledge') return '0';
  return '';
}

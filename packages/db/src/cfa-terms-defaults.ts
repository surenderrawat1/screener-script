/** Default CFA glossary seeded on first run. Admins can edit via Admin → CFA Docs. */
export interface CfaTermSeed {
  key: string;
  category: string;
  title: string;
  definition: string;
  formula?: string;
  example?: string;
  phaseRefs?: string[];
  relatedKeys?: string[];
  sortOrder?: number;
}

export const CFA_TERM_DEFAULTS: CfaTermSeed[] = [
  {
    key: 'intrinsic_value',
    category: 'valuation',
    title: 'Intrinsic Value (IV)',
    definition:
      'Estimated fair value per share based on fundamentals, sector-appropriate models, and growth assumptions. The engine routes IT/FMCG/pharma to DCF + Fair P/E (+ DDM when dividend yield is meaningful); banks/NBFC/insurance to P/B; metals/cement/telecom/infra to EV/EBITDA; utilities/REITs to DDM + DCF blend.',
    formula:
      'Sector-routed blend of model outputs (DCF, Fair P/E, DDM, P/B, EV/EBITDA). Final IV is the weighted median of applicable models for the sector.',
    example: 'TCS (IT): DCF and Fair P/E dominate; banking names use book-value multiple instead.',
    relatedKeys: ['mos', 'dcf', 'fair_pe', 'sector_routing'],
    sortOrder: 10,
  },
  {
    key: 'mos',
    category: 'valuation',
    title: 'Margin of Safety (MOS)',
    definition:
      'Discount of market price to intrinsic value. Higher MOS means more cushion against estimation error and adverse events. Used for Buy/Hold/Expensive zones and investment-ready gate (typically MOS ≥ 15%).',
    formula: 'MOS (%) = (Intrinsic Value − Price) / Intrinsic Value × 100',
    example: 'IV ₹2,000, price ₹1,500 → MOS = 25% (Buy zone).',
    relatedKeys: ['intrinsic_value', 'mos_zones', 'recommendation_matrix'],
    sortOrder: 20,
  },
  {
    key: 'mos_zones',
    category: 'valuation',
    title: 'MOS Zones',
    definition: 'Action bands derived from MOS percentage. Extreme MOS (|MOS| > 50%) triggers a data-quality warning.',
    formula:
      '>40% Strong Buy · ≥25% Buy · ≥10% Accumulate · ≥0% Hold · <0% Expensive',
    relatedKeys: ['mos', 'recommendation_matrix'],
    sortOrder: 30,
  },
  {
    key: 'dcf',
    category: 'valuation',
    title: 'Discounted Cash Flow (DCF)',
    definition:
      'Projects free cash flow over five years using sustainable EPS growth (≈85% of EPS CAGR, capped at 12%), discounts at sector WACC, and applies a 3% terminal growth rate.',
    formula:
      'IV_DCF = Σ(FCF_t / (1+WACC)^t) + Terminal / (1+WACC)^5, per share from market cap bridge',
    example: 'WACC typically 10.5–12% by sector; terminal g = 3%.',
    relatedKeys: ['intrinsic_value', 'fair_pe', 'wacc'],
    sortOrder: 40,
  },
  {
    key: 'fair_pe',
    category: 'valuation',
    title: 'Fair P/E',
    definition:
      'Target P/E multiple from growth, profitability, moat, size, and leverage. Zero for banking/metal sectors where P/E is not the primary model.',
    formula:
      'Fair P/E = clamp(8 + 0.4×EPS_CAGR_5Y + 0.1×ROCE + moatPrem + sizePrem − debtPen, 8, 40)',
    relatedKeys: ['intrinsic_value', 'roe', 'roce'],
    sortOrder: 50,
  },
  {
    key: 'ddm',
    category: 'valuation',
    title: 'Dividend Discount Model (DDM)',
    definition:
      'Gordon growth model for dividend-paying stocks. Applied when dividend yield ≥ 0.5% (or ≥1% for utilities/REIT routing).',
    formula: 'IV_DDM = D₁ / (r − g), where g = clamp(2–8%, 60% of EPS CAGR), r = 12%',
    relatedKeys: ['intrinsic_value', 'div_yield'],
    sortOrder: 60,
  },
  {
    key: 'graham_number',
    category: 'valuation',
    title: 'Graham Number',
    definition:
      'Benjamin Graham defensive-stock fair value from EPS and book value. Used as a sanity check in Phase 4 (value vs growth) when earnings are credible.',
    formula: 'Graham = √(22.5 × EPS × Book Value per share)',
    phaseRefs: ['4'],
    relatedKeys: ['eps', 'book_value'],
    sortOrder: 70,
  },
  {
    key: 'ev_ebitda',
    category: 'valuation',
    title: 'EV / EBITDA Model',
    definition:
      'Enterprise value from sector fair EV/EBITDA multiple minus net debt, converted to per-share intrinsic value. Used for metals, cement, telecom, infra, oil & gas.',
    formula: 'Fair EV = sector_multiple × EBITDA; Equity = EV − net debt; IV = equity / shares',
    example: 'Metal fair multiple ≈ 7×; cement ≈ 9×.',
    relatedKeys: ['sector_routing', 'intrinsic_value'],
    sortOrder: 80,
  },
  {
    key: 'pb_intrinsic',
    category: 'valuation',
    title: 'P/B Intrinsic (Banking / NBFC)',
    definition: 'Book-value-based intrinsic for financials. Fair P/B scales with ROE quality.',
    formula: 'IV = Book Value × Fair P/B (ROE-driven)',
    relatedKeys: ['book_value', 'roe', 'sector_routing'],
    sortOrder: 90,
  },
  {
    key: 'sector_routing',
    category: 'valuation',
    title: 'Sector Routing',
    definition:
      'Maps normalized sector key to valuation model set. Ensures banks are not valued on DCF alone and cyclicals use EV/EBITDA.',
    formula:
      'it/fmcg/pharma/auto/defence → dcf_fairpe_ddm · banking/nbfc/insurance → pb · metal/cement/telecom/infra/oil_gas → ev_ebitda · utility/reit → ddm_dcf',
    relatedKeys: ['intrinsic_value', 'dcf', 'ev_ebitda'],
    sortOrder: 100,
  },
  {
    key: 'roe',
    category: 'ratio',
    title: 'Return on Equity (ROE)',
    definition:
      'Profitability relative to shareholders\' equity. Phase 3 gate: ROE ≥ 15% for quality names. Drives quality score (up to 20 pts) and fair P/B for banks.',
    formula: 'ROE (%) = Net Profit / Shareholders\' Equity × 100',
    phaseRefs: ['3'],
    relatedKeys: ['roce', 'quality_score'],
    sortOrder: 110,
  },
  {
    key: 'roce',
    category: 'ratio',
    title: 'Return on Capital Employed (ROCE)',
    definition:
      'Operating efficiency on total capital. Quality score up to 20 pts. Fair P/E formula includes +0.1×ROCE term. Leverage trap: ROE > 15% but ROCE < ROE − 5% with D/E > 1.5.',
    formula: 'ROCE (%) = EBIT / (Equity + Debt) × 100 (as reported / Screener)',
    phaseRefs: ['3'],
    relatedKeys: ['roe', 'debt_to_equity'],
    sortOrder: 120,
  },
  {
    key: 'debt_to_equity',
    category: 'ratio',
    title: 'Debt / Equity',
    definition:
      'Leverage ratio. Quality score penalizes high D/E. Values > 5 from raw feeds are treated as percentages (÷100). Phase 3 checks leverage trap and interest coverage.',
    formula: 'D/E = Total Debt / Shareholders\' Equity',
    phaseRefs: ['3'],
    relatedKeys: ['roce', 'interest_coverage'],
    sortOrder: 130,
  },
  {
    key: 'peg_ratio',
    category: 'ratio',
    title: 'PEG Ratio',
    definition: 'P/E relative to earnings growth. Phase 3: PEG ≤ 2 preferred for growth at reasonable price.',
    formula: 'PEG = P/E / EPS Growth (%)',
    phaseRefs: ['3'],
    relatedKeys: ['pe_ratio', 'eps_growth'],
    sortOrder: 140,
  },
  {
    key: 'quality_score',
    category: 'quality',
    title: 'Quality Score (0–100)',
    definition:
      'Composite fundamental quality before MOS blending. Screener uses this as a quick quality proxy; it is not the Full Verify phase scorecard.',
    formula:
      'ROE (20) + ROCE (20) + D/E discipline (3–15) + Piotroski (15) + Moat (3–15) + Management (10) + Cash flow (5) + Altman distress penalty (5)',
    relatedKeys: ['verify_score', 'piotroski', 'moat', 'altman_z'],
    sortOrder: 200,
  },
  {
    key: 'verify_score',
    category: 'quality',
    title: 'Verify Score',
    definition:
      'Full Verify: sum of phase scorecard (max 56, Phase 8 thesis excluded from total). Quick screening may expose a derived quality proxy, but investment-ready gates use the Full Verify scorecard.',
    formula: 'Full Verify: Σ phase points (0–56)',
    relatedKeys: ['quality_score', 'investment_ready'],
    sortOrder: 210,
  },
  {
    key: 'piotroski',
    category: 'quant',
    title: 'Piotroski F-Score',
    definition: 'Nine-point financial strength screen (profitability, leverage, efficiency). Contributes up to 15 points to quality score.',
    formula: 'Quality contribution = (F-Score / 9) × 15',
    phaseRefs: ['5'],
    relatedKeys: ['quality_score', 'altman_z'],
    sortOrder: 300,
  },
  {
    key: 'altman_z',
    category: 'quant',
    title: 'Altman Z-Score',
    definition:
      'Distress probability for non-financials. Skipped for banking, NBFC, insurance, REIT. Zones: >2.99 safe, 1.81–2.99 grey, <1.81 distress.',
    formula: 'Z = 1.2A + 1.4B + 3.3C + 0.6D + 1.0E (working-capital, retained earnings, EBIT, equity, sales ratios)',
    phaseRefs: ['5'],
    relatedKeys: ['quality_score'],
    sortOrder: 310,
  },
  {
    key: 'moat',
    category: 'quality',
    title: 'Economic Moat',
    definition:
      'Sustainable competitive advantage. Counted from explicit checkboxes (brand, cost, switching, network, regulatory) or heuristics from ROCE and market cap. Tiers: weak / moderate / strong / exceptional.',
    formula: 'Moat premium in Fair P/E and up to 15 pts in quality score',
    phaseRefs: ['1'],
    relatedKeys: ['fair_pe', 'quality_score'],
    sortOrder: 220,
  },
  {
    key: 'recommendation_matrix',
    category: 'verdict',
    title: 'Recommendation Matrix',
    definition:
      'Verdict from score bands crossed with MOS bands. Screener verdicts are quick screening signals; Full Verify verdicts use the manual phase scorecard and red-flag gates.',
    formula: 'Full Verify score bands: ≥45 / ≥35 / ≥25 · MOS bands: ≥20% / ≥10% / ≥0%',
    relatedKeys: ['mos', 'quality_score', 'verify_score'],
    sortOrder: 400,
  },
  {
    key: 'investment_ready',
    category: 'verdict',
    title: 'Investment Ready',
    definition:
      'Full Verify pass gate: score ≥35, MOS ≥15%, ≤1 red flag, no critical phase failures, data quality pass, required phases complete, manual attestation when auto-prefilled.',
    relatedKeys: ['verify_score', 'mos', 'phase_overview'],
    sortOrder: 410,
  },
  {
    key: 'phase_overview',
    category: 'phase',
    title: 'Verification Phases (0–8)',
    definition:
      'Eight-phase CFA checklist plus investor foundation. Phases 0–7 contribute to scorecard; Phase 8 is thesis and attestation.',
    formula:
      'P0 Investor (5) · P1 Business (10) · P2 Financials (9) · P3 Ratios (10) · P4 Value/Growth · P5 Quant · P6 Sector (5) · P7 Portfolio (5) · P8 Thesis (5, excluded from total)',
    relatedKeys: ['investment_ready'],
    sortOrder: 500,
  },
  {
    key: 'phase_0',
    category: 'phase',
    title: 'Phase 0 — Investor Foundation',
    definition: 'Personal readiness: emergency fund and high-interest debt cleared before stock picking.',
    phaseRefs: ['0'],
    sortOrder: 510,
  },
  {
    key: 'phase_1',
    category: 'phase',
    title: 'Phase 1 — Business Quality',
    definition: 'Moat, management, promoter pledge ≤25% (critical fail if exceeded), auditor and capital allocation checks.',
    phaseRefs: ['1'],
    relatedKeys: ['moat', 'promoter_pledge'],
    sortOrder: 520,
  },
  {
    key: 'phase_3',
    category: 'phase',
    title: 'Phase 3 — Fundamental Ratios',
    definition: 'ROE, ROCE, D/E, PEG, FCF, dividend yield, leverage trap detection.',
    phaseRefs: ['3'],
    relatedKeys: ['roe', 'roce', 'debt_to_equity', 'peg_ratio'],
    sortOrder: 540,
  },
  {
    key: 'phase_5',
    category: 'phase',
    title: 'Phase 5 — Quant Screens',
    definition: 'Piotroski F-Score and Altman Z-Score (where applicable).',
    phaseRefs: ['5'],
    relatedKeys: ['piotroski', 'altman_z'],
    sortOrder: 560,
  },
  {
    key: 'promoter_holding',
    category: 'screening',
    title: 'Promoter Holding',
    definition:
      'Percentage held by promoters/promoter group. Screener filter min_promoter_holding; sourced from shareholding CSV, Screener meta, or DB upload.',
    relatedKeys: ['promoter_pledge'],
    sortOrder: 600,
  },
  {
    key: 'promoter_pledge',
    category: 'screening',
    title: 'Promoter Pledge',
    definition: 'Shares pledged by promoters. Phase 1 gate: pledge ≤10% preferred; >25% is critical fail.',
    phaseRefs: ['1'],
    relatedKeys: ['promoter_holding'],
    sortOrder: 610,
  },
  {
    key: 'fcf',
    category: 'ratio',
    title: 'Free Cash Flow (FCF)',
    definition: 'Cash after capex. Phase 3 and quality score consider positive FCF and CFO vs PAT alignment.',
    formula: 'FCF ≈ CFO − Capex (or Screener "Free Cash Flow" line)',
    phaseRefs: ['2', '3'],
    sortOrder: 150,
  },
  {
    key: 'wacc',
    category: 'valuation',
    title: 'WACC (Discount Rate)',
    definition: 'Weighted average cost of capital used in DCF. Sector-tuned, typically 10.5–12% for Indian equities in this engine.',
    relatedKeys: ['dcf'],
    sortOrder: 45,
  },
];

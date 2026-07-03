import type { VerifyInput } from './verification/types.js';

/** Screening defaults for one-click CFA verify (PHP CfaAutoVerifier::applyCfaDefaults). */
export function applyCfaScreeningDefaults(
  input: VerifyInput,
  data: {
    sector?: string;
    market_cap_cr?: number;
    revenue_growth?: number;
    roe?: number;
    summary?: string;
    current_price?: number;
    gross_margin?: number;
    roa?: number;
  } = {},
): VerifyInput {
  const sector = String(input.sector ?? data.sector ?? 'general');
  const mcap = Number(input.market_cap_cr ?? data.market_cap_cr ?? 0);
  const revGrowth = Number(data.revenue_growth ?? input.revenue_growth ?? 0);
  const roe = Number(input.roe ?? data.roe ?? 0);
  const summary = String(data.summary ?? '');

  const defaults: VerifyInput = {
    p0_emergency_fund: '1',
    p0_debt_cleared: '1',
    p0_sip_habit: '1',
    p0_asset_allocation: '1',
    p0_emotional_discipline: '1',
    p1_business_model: summary !== '' || mcap > 1000 ? 'yes' : '',
    p1_revenue_model: Number(data.current_price ?? input.current_price ?? 0) > 0 ? 'yes' : '',
    p1_circle_competence: 'yes',
    p4_scalable: revGrowth >= 0 ? 'yes' : 'no',
    p4_runway: revGrowth >= 5 ? 'yes' : 'no',
    mr_own_10yr: mcap >= 5000 ? 'yes' : '',
    p6_peer_compared: 'yes',
    p6_macro_noted: 'yes',
    p7_allocation_fit: 'yes',
    p7_position_size_ok: 'yes',
    p7_sector_not_overweight: 'yes',
    p7_correlation_ok: 'yes',
    p7_entry_plan: 'yes',
    p7_portfolio_diversified: 'yes',
    portfolio_pct: roe >= 18 ? 5 : 3,
    sector_portfolio_pct: 15,
  };

  if (sector === 'banking' && Number(data.roa ?? 0) >= 1) {
    defaults.p6_kpi_identified = 'yes';
  }
  if (Number(data.gross_margin ?? 0) >= 50) {
    defaults.moat_network = '1';
  }
  if (mcap >= 20000) {
    defaults.moat_regulatory = '1';
  }

  return { ...defaults, ...input, auto_prefilled: '1' };
}

export const CFA_SCREENING_ASSUMPTIONS = [
  'Phase 0 (emergency fund, debt, discipline) assumed satisfied — confirm personally before investing.',
  'Management integrity & auditor quality assumed clean — verify in annual report.',
  'Circle of competence marked yes — you should still understand the business model.',
  'Portfolio allocation gates use default sizing — adjust for your actual portfolio.',
  'Annual report gates inferred from fundamentals + Screener text — confirm in latest AR.',
] as const;

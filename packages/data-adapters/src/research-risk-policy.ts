/**
 * Read-only CFA research / paper risk policy for Admin cockpit.
 * These are code-level controls — changing them requires a deploy, not Admin PATCH.
 */
import {
  HEAT_BLOCK_PCT,
  MAX_OPEN_POSITIONS,
  MAX_PORTFOLIO_HEAT_PCT,
  MAX_RISK_PER_TRADE_PCT,
  MAX_SECTOR_NOTIONAL_PCT,
  DEFAULT_PORTFOLIO_NAV,
  MIN_ROE_PCT,
  MIN_ROCE_PCT,
} from '@sv/swing';
import {
  PAPER_DAILY_LOSS_KILL_PCT,
  PAPER_MAX_HEAT_PCT,
  PAPER_MAX_NOTIONAL_INR,
  PAPER_MAX_OPEN_POSITIONS,
  PAPER_MAX_RISK_PER_TRADE_PCT,
  PAPER_OPENING_BALANCE_INR,
  PAPER_SLIPPAGE_BPS,
} from '@sv/intraday';

export function getResearchRiskPolicy() {
  return {
    editable_in_admin: false,
    note:
      'CFA live-money / paper constants live in code. Admin shows them for operators; change requires release.',
    swing: {
      max_portfolio_heat_pct: MAX_PORTFOLIO_HEAT_PCT,
      heat_block_pct: HEAT_BLOCK_PCT,
      max_sector_notional_pct: MAX_SECTOR_NOTIONAL_PCT,
      max_risk_per_trade_pct: MAX_RISK_PER_TRADE_PCT,
      max_open_positions: MAX_OPEN_POSITIONS,
      default_nav_inr: DEFAULT_PORTFOLIO_NAV,
      quality_floor: {
        min_roe_pct: MIN_ROE_PCT,
        min_roce_pct: MIN_ROCE_PCT,
        roce_waived_for: ['banking', 'nbfc', 'insurance'],
      },
    },
    paper_intraday: {
      opening_balance_inr: PAPER_OPENING_BALANCE_INR,
      max_notional_inr: PAPER_MAX_NOTIONAL_INR,
      max_open_positions: PAPER_MAX_OPEN_POSITIONS,
      max_risk_per_trade_pct: PAPER_MAX_RISK_PER_TRADE_PCT,
      max_heat_pct: PAPER_MAX_HEAT_PCT,
      daily_loss_kill_pct: PAPER_DAILY_LOSS_KILL_PCT,
      slippage_bps: PAPER_SLIPPAGE_BPS,
    },
  };
}

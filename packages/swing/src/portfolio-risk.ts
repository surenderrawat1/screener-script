const DEFAULT_STOP_LOSS_PCT = 5.0;

export const MAX_RISK_PER_TRADE_PCT = 1.0;
export const MAX_OPEN_POSITIONS = 10;
export const MAX_PORTFOLIO_HEAT_PCT = 4.0;
export const HEAT_BLOCK_PCT = 4.0;
export const DEFAULT_PORTFOLIO_NAV = 1_000_000;

export function positionRiskInr(position: Record<string, unknown>): number {
  const entry = Number(position.entry_price ?? 0);
  let stop = Number(position.stop_loss ?? 0);
  const shares = Number(position.shares ?? 0);

  if (entry <= 0) return 0;
  if (stop <= 0) stop = Math.round(entry * (1 - DEFAULT_STOP_LOSS_PCT / 100) * 100) / 100;

  const riskPerShare = Math.max(0, entry - stop);
  if (shares > 0) return riskPerShare * shares;

  const notional = Math.min(15_000, entry * 100);
  return riskPerShare * (notional / entry);
}

export function portfolioHeatPct(openPositions: Record<string, unknown>[], portfolioNav = DEFAULT_PORTFOLIO_NAV): number {
  if (portfolioNav <= 0) return 0;
  const heat = openPositions.reduce((sum, pos) => sum + positionRiskInr(pos), 0);
  return Math.round((heat / portfolioNav) * 10000) / 100;
}

export function canOpenPosition(
  openPositions: Record<string, unknown>[],
  entryPrice: number,
  stopLoss: number | null,
  portfolioNav = DEFAULT_PORTFOLIO_NAV,
  shares = 0,
) {
  const openCount = openPositions.length;
  if (openCount >= MAX_OPEN_POSITIONS) {
    return {
      ok: false,
      reason: `Max open positions (${MAX_OPEN_POSITIONS}) reached.`,
      heat_pct: portfolioHeatPct(openPositions, portfolioNav),
      open_count: openCount,
    };
  }

  const heat = portfolioHeatPct(openPositions, portfolioNav);
  if (heat >= HEAT_BLOCK_PCT) {
    return {
      ok: false,
      reason: `Portfolio heat ${heat.toFixed(1)}% ≥ ${HEAT_BLOCK_PCT}% — no new entries.`,
      heat_pct: heat,
      open_count: openCount,
    };
  }

  const stop = stopLoss ?? Math.round(entryPrice * (1 - DEFAULT_STOP_LOSS_PCT / 100) * 100) / 100;
  const newRisk = positionRiskInr({ entry_price: entryPrice, stop_loss: stop, shares });
  const newHeat = ((heat * portfolioNav) / 100 + newRisk) / portfolioNav * 100;

  if (newHeat > MAX_PORTFOLIO_HEAT_PCT + MAX_RISK_PER_TRADE_PCT) {
    return {
      ok: false,
      reason: `New position would push heat to ${newHeat.toFixed(1)}%.`,
      heat_pct: heat,
      open_count: openCount,
    };
  }

  const tradeRiskPct = portfolioNav > 0 ? (newRisk / portfolioNav) * 100 : 0;
  if (tradeRiskPct > MAX_RISK_PER_TRADE_PCT * 1.05) {
    return {
      ok: false,
      reason: `Trade risk ${tradeRiskPct.toFixed(2)}% exceeds ${MAX_RISK_PER_TRADE_PCT}% per trade.`,
      heat_pct: heat,
      open_count: openCount,
    };
  }

  return { ok: true, reason: '', heat_pct: heat, open_count: openCount };
}

export function suggestedShares(entryPrice: number, stopLoss: number, portfolioNav = DEFAULT_PORTFOLIO_NAV): number {
  if (entryPrice <= 0 || portfolioNav <= 0) return 0;
  const riskBudget = portfolioNav * MAX_RISK_PER_TRADE_PCT / 100;
  const riskPerShare = Math.max(0.01, entryPrice - stopLoss);
  return Math.max(1, Math.floor(riskBudget / riskPerShare));
}

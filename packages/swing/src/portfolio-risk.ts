import { lookupSectorHint } from '@sv/shared';

const DEFAULT_STOP_LOSS_PCT = 5.0;

export const MAX_RISK_PER_TRADE_PCT = 1.0;
export const MAX_OPEN_POSITIONS = 10;
export const MAX_PORTFOLIO_HEAT_PCT = 4.0;
export const HEAT_BLOCK_PCT = 4.0;
/** Max notional in one sector (CFA live-money control). */
export const MAX_SECTOR_NOTIONAL_PCT = 25.0;
export const DEFAULT_PORTFOLIO_NAV = 1_000_000;

function sharesOf(position: Record<string, unknown>): number {
  return Number(position.shares ?? position.quantity ?? 0);
}

export function positionRiskInr(position: Record<string, unknown>): number {
  const entry = Number(position.entry_price ?? 0);
  let stop = Number(position.stop_loss ?? 0);
  const shares = sharesOf(position);

  if (entry <= 0) return 0;
  if (stop <= 0) stop = Math.round(entry * (1 - DEFAULT_STOP_LOSS_PCT / 100) * 100) / 100;

  const riskPerShare = Math.max(0, entry - stop);
  if (shares > 0) return riskPerShare * shares;

  const notional = Math.min(15_000, entry * 100);
  return riskPerShare * (notional / entry);
}

export function positionNotionalInr(position: Record<string, unknown>): number {
  const entry = Number(position.entry_price ?? 0);
  const shares = sharesOf(position);
  if (entry <= 0 || shares <= 0) return 0;
  return entry * shares;
}

/** Resolve CFA sector key for concentration (hint → sector field → general). */
export function resolvePositionSector(position: Record<string, unknown>): string {
  const symbol = String(position.symbol ?? '')
    .toUpperCase()
    .replace(/\.(NS|BO)$/, '');
  const hint = symbol ? lookupSectorHint(symbol) : undefined;
  if (hint) return hint;
  const raw = String(position.sector ?? position.sector_key ?? '')
    .toLowerCase()
    .trim();
  if (!raw || raw === 'general') return 'general';
  if (raw.includes('nbfc') || raw.includes('non-bank')) return 'nbfc';
  if (raw.includes('insurance')) return 'insurance';
  if (raw.includes('bank')) return 'banking';
  if (raw.includes('it') || raw.includes('software')) return 'it';
  if (raw.includes('pharma') || raw.includes('health')) return 'pharma';
  if (raw.includes('auto')) return 'auto';
  if (raw.includes('metal') || raw.includes('steel')) return 'metal';
  if (raw.includes('fmcg') || raw.includes('consumer')) return 'fmcg';
  if (raw.includes('defence') || raw.includes('defense')) return 'defence';
  if (raw.includes('oil') || raw.includes('gas')) return 'oil_gas';
  return raw.replace(/\s+/g, '_').slice(0, 32);
}

export function sectorNotionalInr(
  openPositions: Record<string, unknown>[],
  sector: string,
): number {
  const key = String(sector || 'general').toLowerCase();
  return openPositions.reduce((sum, pos) => {
    if (resolvePositionSector(pos) !== key) return sum;
    return sum + positionNotionalInr(pos);
  }, 0);
}

export function sectorNotionalPct(
  openPositions: Record<string, unknown>[],
  sector: string,
  portfolioNav = DEFAULT_PORTFOLIO_NAV,
): number {
  if (portfolioNav <= 0) return 0;
  return Math.round((sectorNotionalInr(openPositions, sector) / portfolioNav) * 10000) / 100;
}

export function canOpenSectorConcentration(
  openPositions: Record<string, unknown>[],
  sector: string,
  newNotionalInr: number,
  portfolioNav = DEFAULT_PORTFOLIO_NAV,
  maxSectorPct = MAX_SECTOR_NOTIONAL_PCT,
) {
  const key = String(sector || 'general').toLowerCase() || 'general';
  const current = sectorNotionalInr(openPositions, key);
  const after = current + Math.max(0, newNotionalInr);
  const afterPct = portfolioNav > 0 ? (after / portfolioNav) * 100 : 0;
  const currentPct = portfolioNav > 0 ? (current / portfolioNav) * 100 : 0;
  if (afterPct > maxSectorPct + 1e-9) {
    return {
      ok: false,
      reason: `Sector ${key} notional would be ${afterPct.toFixed(1)}% > ${maxSectorPct}% cap.`,
      sector: key,
      sector_pct: Math.round(currentPct * 100) / 100,
      sector_after_pct: Math.round(afterPct * 100) / 100,
    };
  }
  return {
    ok: true,
    reason: '',
    sector: key,
    sector_pct: Math.round(currentPct * 100) / 100,
    sector_after_pct: Math.round(afterPct * 100) / 100,
  };
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
  options?: { sector?: string | null; skip_sector_cap?: boolean },
) {
  const openCount = openPositions.length;
  if (openCount >= MAX_OPEN_POSITIONS) {
    return {
      ok: false,
      reason: `Max open positions (${MAX_OPEN_POSITIONS}) reached.`,
      heat_pct: portfolioHeatPct(openPositions, portfolioNav),
      open_count: openCount,
      sector: null as string | null,
      sector_pct: null as number | null,
      sector_after_pct: null as number | null,
    };
  }

  const heat = portfolioHeatPct(openPositions, portfolioNav);
  if (heat >= HEAT_BLOCK_PCT) {
    return {
      ok: false,
      reason: `Portfolio heat ${heat.toFixed(1)}% ≥ ${HEAT_BLOCK_PCT}% — no new entries.`,
      heat_pct: heat,
      open_count: openCount,
      sector: null as string | null,
      sector_pct: null as number | null,
      sector_after_pct: null as number | null,
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
      sector: null as string | null,
      sector_pct: null as number | null,
      sector_after_pct: null as number | null,
    };
  }

  const tradeRiskPct = portfolioNav > 0 ? (newRisk / portfolioNav) * 100 : 0;
  if (tradeRiskPct > MAX_RISK_PER_TRADE_PCT * 1.05) {
    return {
      ok: false,
      reason: `Trade risk ${tradeRiskPct.toFixed(2)}% exceeds ${MAX_RISK_PER_TRADE_PCT}% per trade.`,
      heat_pct: heat,
      open_count: openCount,
      sector: null as string | null,
      sector_pct: null as number | null,
      sector_after_pct: null as number | null,
    };
  }

  const notional = entryPrice > 0 && shares > 0 ? entryPrice * shares : 0;
  const sector =
    options?.sector != null && String(options.sector).trim() !== ''
      ? String(options.sector).toLowerCase()
      : 'general';

  let sectorPct: number | null = null;
  let sectorAfter: number | null = null;
  if (!options?.skip_sector_cap && notional > 0) {
    const sectorGate = canOpenSectorConcentration(openPositions, sector, notional, portfolioNav);
    sectorPct = sectorGate.sector_pct;
    sectorAfter = sectorGate.sector_after_pct;
    if (!sectorGate.ok) {
      return {
        ok: false,
        reason: sectorGate.reason,
        heat_pct: heat,
        open_count: openCount,
        sector: sectorGate.sector,
        sector_pct: sectorPct,
        sector_after_pct: sectorAfter,
      };
    }
  }

  return {
    ok: true,
    reason: '',
    heat_pct: heat,
    open_count: openCount,
    sector: notional > 0 && !options?.skip_sector_cap ? sector : null,
    sector_pct: sectorPct,
    sector_after_pct: sectorAfter,
  };
}

export function suggestedShares(entryPrice: number, stopLoss: number, portfolioNav = DEFAULT_PORTFOLIO_NAV): number {
  if (entryPrice <= 0 || portfolioNav <= 0) return 0;
  const riskBudget = portfolioNav * MAX_RISK_PER_TRADE_PCT / 100;
  const riskPerShare = Math.max(0.01, entryPrice - stopLoss);
  return Math.max(1, Math.floor(riskBudget / riskPerShare));
}

/** Closed (or open) trade row for chronological portfolio heat gating. */
export interface PortfolioGateTrade {
  symbol?: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  stop_loss?: number | null;
  shares?: number;
  status?: string;
  gate_notional_inr?: number;
  portfolio_gated?: boolean;
}

export interface ApplyPortfolioGatesOptions {
  /** When true, size shares from notional (or scaled NAV deploy). */
  scale_for_nav?: boolean;
  gate_deploy_pct?: number;
  gate_max_deploy?: number;
  nav_deploy_pct?: number;
  nav_max_deploy?: number;
}

/**
 * Apply max-position and portfolio-heat gates across symbols (chronological).
 * Port of PHP `SwingTradingBacktest::applyPortfolioGates`.
 */
export function applyPortfolioGates(
  trades: PortfolioGateTrade[],
  portfolioNav = DEFAULT_PORTFOLIO_NAV,
  notional = 15_000,
  options: ApplyPortfolioGatesOptions = {},
): { trades: PortfolioGateTrade[]; blocked: number; accepted: number } {
  const nav = Math.max(1, portfolioNav);
  const baseNotional = Math.max(1, notional);
  const scaleForNav = Boolean(options.scale_for_nav);
  const deployPct = Math.max(0, Number(options.gate_deploy_pct ?? options.nav_deploy_pct ?? 0));
  const maxDeploy = Math.max(
    baseNotional,
    Number(options.gate_max_deploy ?? options.nav_max_deploy ?? baseNotional),
  );

  const candidates = trades
    .filter((t) => {
      const status = String(t.status ?? 'closed');
      return status === 'closed' && Boolean(t.entry_date) && Boolean(t.exit_date);
    })
    .slice()
    .sort((a, b) => {
      const cmp = String(a.entry_date).localeCompare(String(b.entry_date));
      if (cmp !== 0) return cmp;
      return String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''));
    });

  const accepted: PortfolioGateTrade[] = [];
  const openBook: PortfolioGateTrade[] = [];
  let blocked = 0;

  for (const trade of candidates) {
    const entryDate = String(trade.entry_date).slice(0, 10);
    const exitDate = String(trade.exit_date).slice(0, 10);

    // Drop positions that have already exited on or before this entry date
    for (let i = openBook.length - 1; i >= 0; i--) {
      if (String(openBook[i].exit_date).slice(0, 10) <= entryDate) openBook.splice(i, 1);
    }

    const entryPrice = Number(trade.entry_price ?? 0);
    const stopLoss =
      trade.stop_loss != null && Number(trade.stop_loss) > 0
        ? Number(trade.stop_loss)
        : Math.round(entryPrice * (1 - DEFAULT_STOP_LOSS_PCT / 100) * 100) / 100;

    let gateNotional = baseNotional;
    if (scaleForNav && deployPct > 0) {
      const scaled = (nav * deployPct) / 100;
      gateNotional = Math.max(baseNotional, Math.min(maxDeploy, scaled));
    }

    let shares = Number(trade.shares ?? 0);
    if (entryPrice > 0 && (shares <= 0 || scaleForNav)) {
      shares = Math.floor(gateNotional / entryPrice);
    }

    const openPositions = openBook.map((p) => ({
      symbol: String(p.symbol ?? ''),
      entry_price: Number(p.entry_price ?? 0),
      stop_loss: Number(p.stop_loss ?? 0),
      shares: Number(p.shares ?? 0),
    }));

    // Sector concentration is a live/paper control; walk-forward BT keeps heat/count only.
    const gate = canOpenPosition(openPositions, entryPrice, stopLoss, nav, shares, {
      skip_sector_cap: true,
    });
    if (!gate.ok) {
      blocked++;
      continue;
    }

    const gated: PortfolioGateTrade = {
      ...trade,
      stop_loss: stopLoss,
      shares,
      gate_notional_inr: Math.round(gateNotional * 100) / 100,
      portfolio_gated: true,
    };
    accepted.push(gated);
    openBook.push({
      symbol: String(trade.symbol ?? ''),
      entry_date: entryDate,
      exit_date: exitDate,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      shares,
    });
  }

  return { trades: accepted, blocked, accepted: accepted.length };
}

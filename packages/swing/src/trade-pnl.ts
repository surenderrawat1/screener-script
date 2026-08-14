/** Indian equity cash-market charges — delivery + intraday (NSE schedule). */

/** Delivery STT: 0.1% each side. */
export const STT_DELIVERY_RATE = 0.001;
/** Intraday STT: 0.025% sell only. */
export const STT_INTRADAY_SELL_RATE = 0.00025;
/** Stamp duty: delivery 0.015% / intraday 0.003% — buy side only. */
export const STAMP_DELIVERY_RATE = 0.00015;
export const STAMP_INTRADAY_RATE = 0.00003;
/** NSE equity cash txn charge (~0.0030699%). */
export const NSE_TXN_RATE = 0.000030699;
/** SEBI turnover fee: ₹10 / crore. */
export const SEBI_PER_CRORE = 10;
export const GST_RATE = 0.18;
/** Typical discount-broker flat brokerage per order (₹). */
export const BROKERAGE_PER_ORDER = 20;
/** Typical DP debit on delivery sell (₹). */
export const DP_CHARGE_SELL = 15.93;

/** @deprecated Use STT_DELIVERY_RATE — kept for parity with older call sites. */
export const STT_RATE = STT_DELIVERY_RATE;
/** @deprecated Use STAMP_DELIVERY_RATE */
export const STAMP_RATE = STAMP_DELIVERY_RATE;

export type EquitySettlement = 'delivery' | 'intraday';
export type FillSide = 'buy' | 'sell';

export interface TradeChargeBreakdown {
  brokerage: number;
  stt: number;
  stamp: number;
  nse_txn: number;
  sebi: number;
  gst: number;
  dp: number;
  total: number;
  settlement: EquitySettlement;
  side: FillSide;
}

export interface TradePnlResult {
  gross_pnl: number;
  charges: TradeChargeBreakdown & { buy?: TradeChargeBreakdown; sell?: TradeChargeBreakdown };
  net_pnl: number;
  turnover: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-fill statutory + brokerage estimate for NSE equity cash.
 * GST applies only to brokerage + exchange + SEBI (not STT / stamp / DP).
 */
export function estimateFillCharges(input: {
  notional: number;
  side: FillSide;
  settlement?: EquitySettlement;
  brokerage?: number;
}): TradeChargeBreakdown {
  const notional = Math.max(0, Number(input.notional) || 0);
  const side = input.side;
  const settlement = input.settlement ?? 'delivery';
  const brokerage =
    input.brokerage != null ? Math.max(0, Number(input.brokerage)) : notional > 0 ? BROKERAGE_PER_ORDER : 0;

  let stt = 0;
  if (settlement === 'delivery') {
    stt = notional * STT_DELIVERY_RATE;
  } else if (side === 'sell') {
    stt = notional * STT_INTRADAY_SELL_RATE;
  }

  let stamp = 0;
  if (side === 'buy') {
    stamp = notional * (settlement === 'delivery' ? STAMP_DELIVERY_RATE : STAMP_INTRADAY_RATE);
  }

  const nseTxn = notional * NSE_TXN_RATE;
  const sebi = (notional / 10_000_000) * SEBI_PER_CRORE;
  const gst = (brokerage + nseTxn + sebi) * GST_RATE;
  const dp = settlement === 'delivery' && side === 'sell' ? DP_CHARGE_SELL : 0;
  const total = brokerage + stt + stamp + nseTxn + sebi + gst + dp;

  return {
    brokerage: round2(brokerage),
    stt: round2(stt),
    stamp: round2(stamp),
    nse_txn: round2(nseTxn),
    sebi: round2(sebi),
    gst: round2(gst),
    dp: round2(dp),
    total: round2(total),
    settlement,
    side,
  };
}

/** Backward-compatible total-only helper (defaults to delivery buy half of a round trip is wrong — prefer estimateFillCharges). */
export function estimateFillFeesInr(
  notional: number,
  side: FillSide = 'buy',
  settlement: EquitySettlement = 'delivery',
): number {
  return estimateFillCharges({ notional, side, settlement }).total;
}

export function computeTradePnl(
  entry: number,
  exit: number,
  shares: number,
  settlement: EquitySettlement = 'delivery',
): TradePnlResult {
  const qty = Math.max(0, shares);
  const buyValue = entry * qty;
  const sellValue = exit * qty;
  const turnover = buyValue + sellValue;
  const gross = round2(sellValue - buyValue);

  const buy = estimateFillCharges({ notional: buyValue, side: 'buy', settlement });
  const sell = estimateFillCharges({ notional: sellValue, side: 'sell', settlement });
  const total = round2(buy.total + sell.total);

  return {
    gross_pnl: gross,
    charges: {
      brokerage: round2(buy.brokerage + sell.brokerage),
      stt: round2(buy.stt + sell.stt),
      stamp: round2(buy.stamp + sell.stamp),
      nse_txn: round2(buy.nse_txn + sell.nse_txn),
      sebi: round2(buy.sebi + sell.sebi),
      gst: round2(buy.gst + sell.gst),
      dp: round2(buy.dp + sell.dp),
      total,
      settlement,
      side: 'sell',
      buy,
      sell,
    },
    net_pnl: round2(gross - total),
    turnover: round2(turnover),
  };
}

export function summarizeOpenTradePnl(
  rows: Array<{ entry_price: number; current_price: number | null; shares: number | null }>,
) {
  let invested = 0;
  let currentValue = 0;
  let grossSum = 0;
  let netSum = 0;
  let chargesSum = 0;
  let count = 0;

  for (const row of rows) {
    const sh = row.shares ?? 0;
    const entry = row.entry_price;
    const cur = row.current_price;
    if (sh <= 0 || entry <= 0 || cur == null || cur <= 0) continue;
    invested += entry * sh;
    currentValue += cur * sh;
    const pnl = computeTradePnl(entry, cur, sh, 'delivery');
    grossSum += pnl.gross_pnl;
    netSum += pnl.net_pnl;
    chargesSum += pnl.charges.total;
    count += 1;
  }

  return {
    count,
    invested: Math.round(invested),
    current_value: Math.round(currentValue),
    gross_pnl: count > 0 ? round2(grossSum) : 0,
    net_pnl: count > 0 ? round2(netSum) : 0,
    charges_total: count > 0 ? round2(chargesSum) : 0,
  };
}

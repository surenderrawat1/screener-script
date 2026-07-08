/** Indian equity delivery charges — parity with PHP SwingTradePnl.php */

export const STT_RATE = 0.001;
export const STAMP_RATE = 0.00015;
export const NSE_TXN_RATE = 0.0000345;
export const SEBI_PER_CRORE = 10;
export const GST_RATE = 0.18;
export const DP_CHARGE_SELL = 15.93;

export interface TradeChargeBreakdown {
  stt: number;
  stamp: number;
  nse_txn: number;
  sebi: number;
  gst: number;
  dp: number;
  total: number;
}

export interface TradePnlResult {
  gross_pnl: number;
  charges: TradeChargeBreakdown;
  net_pnl: number;
  turnover: number;
}

export function computeTradePnl(entry: number, exit: number, shares: number): TradePnlResult {
  const qty = Math.max(0, shares);
  const buyValue = entry * qty;
  const sellValue = exit * qty;
  const turnover = buyValue + sellValue;
  const gross = Math.round((sellValue - buyValue) * 100) / 100;

  const stt = Math.round((buyValue + sellValue) * STT_RATE * 100) / 100;
  const stamp = Math.round(buyValue * STAMP_RATE * 100) / 100;
  const nseTxn = Math.round(turnover * NSE_TXN_RATE * 100) / 100;
  const sebi = Math.round((turnover / 10_000_000) * SEBI_PER_CRORE * 100) / 100;
  const feeBase = nseTxn + sebi;
  const gst = Math.round(feeBase * GST_RATE * 100) / 100;
  const dp = DP_CHARGE_SELL;
  const total = Math.round((stt + stamp + nseTxn + sebi + gst + dp) * 100) / 100;

  return {
    gross_pnl: gross,
    charges: { stt, stamp, nse_txn: nseTxn, sebi, gst, dp, total },
    net_pnl: Math.round((gross - total) * 100) / 100,
    turnover: Math.round(turnover * 100) / 100,
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
    const pnl = computeTradePnl(entry, cur, sh);
    grossSum += pnl.gross_pnl;
    netSum += pnl.net_pnl;
    chargesSum += pnl.charges.total;
    count += 1;
  }

  return {
    count,
    invested: Math.round(invested),
    current_value: Math.round(currentValue),
    gross_pnl: count > 0 ? Math.round(grossSum * 100) / 100 : 0,
    net_pnl: count > 0 ? Math.round(netSum * 100) / 100 : 0,
    charges_total: count > 0 ? Math.round(chargesSum * 100) / 100 : 0,
  };
}

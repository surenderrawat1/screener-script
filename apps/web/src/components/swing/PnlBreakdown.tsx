import { fmtNum } from './format';

export interface ChargeDetail {
  stt?: number;
  stamp?: number;
  nse_txn?: number;
  sebi?: number;
  gst?: number;
  dp?: number;
  total?: number;
}

function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PnlBreakdown({
  entryPrice,
  currentPrice,
  shares,
  gainPct,
  grossPnl,
  netPnl,
  charges,
}: {
  entryPrice: number;
  currentPrice: number;
  shares: number;
  gainPct?: number | null;
  grossPnl?: number | null;
  netPnl?: number | null;
  charges?: ChargeDetail | Record<string, unknown> | null;
}) {
  const qty = shares > 0 ? shares : 0;
  if (qty <= 0 || netPnl == null) {
    return gainPct != null ? (
      <span className={gainPct >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg'}>{fmtNum(gainPct, '%', 2)}</span>
    ) : (
      <span className="muted">—</span>
    );
  }

  const buyValue = entryPrice * qty;
  const nowValue = currentPrice * qty;
  const gross = grossPnl ?? Math.round((nowValue - buyValue) * 100) / 100;
  const net = netPnl;
  const netPct = buyValue > 0 ? ((net / buyValue) * 100).toFixed(2) : '—';
  const c = charges as ChargeDetail | undefined;
  const totalCharges = Number(c?.total ?? 0);

  return (
    <details className="swing-pnl-detail">
      <summary className={net >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg'}>
        Net {netPct}%
        <span className="muted swing-pnl-net-amt"> · {fmtInr(net)}</span>
      </summary>
      <div className="swing-pnl-breakdown">
        <div className="swing-pnl-row">
          <span>Buy value</span>
          <span>{fmtInr(buyValue)}</span>
        </div>
        <div className="swing-pnl-row">
          <span>Now value</span>
          <span>{fmtInr(nowValue)}</span>
        </div>
        <div className={`swing-pnl-row ${gross >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg'}`}>
          <span>Gross P&amp;L</span>
          <span>
            {fmtInr(gross)} ({gainPct != null ? fmtNum(gainPct, '%', 2) : '—'})
          </span>
        </div>
        {totalCharges > 0 ? (
          <>
            <div className="swing-pnl-section">Charges (est.)</div>
            {c?.stt != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>STT (buy + sell 0.1%)</span>
                <span>{fmtInr(c.stt)}</span>
              </div>
            ) : null}
            {c?.stamp != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>Stamp duty (buy)</span>
                <span>{fmtInr(c.stamp)}</span>
              </div>
            ) : null}
            {c?.nse_txn != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>Exchange txn</span>
                <span>{fmtInr(c.nse_txn)}</span>
              </div>
            ) : null}
            {c?.sebi != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>SEBI fee</span>
                <span>{fmtInr(c.sebi)}</span>
              </div>
            ) : null}
            {c?.gst != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>GST (18% on fees)</span>
                <span>{fmtInr(c.gst)}</span>
              </div>
            ) : null}
            {c?.dp != null ? (
              <div className="swing-pnl-row swing-charge-row">
                <span>DP charge (sell)</span>
                <span>{fmtInr(c.dp)}</span>
              </div>
            ) : null}
            <div className="swing-pnl-row">
              <span>Total charges</span>
              <span>{fmtInr(totalCharges)}</span>
            </div>
          </>
        ) : null}
        <div className={`swing-pnl-row ${net >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg'}`}>
          <strong>Net P&amp;L</strong>
          <strong>
            {fmtInr(net)} ({netPct}%)
          </strong>
        </div>
        <p className="swing-pnl-note">
          NSE delivery (CNC) estimate — STT 0.1% both legs, stamp 0.015% on buy. Excludes STCG/LTCG tax.
        </p>
      </div>
    </details>
  );
}

import { Link } from 'react-router-dom';
import { UndoCloseButton } from '../UndoCloseButton';
import type { OpenPositionRow } from './OpenPositionsPanel';
function fmtRs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return '';
  return n >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg';
}

export interface ClosedSwingRow extends OpenPositionRow {
  closed_at?: string | null;
  closed_price?: number | null;
  closed_reason?: string | null;
  can_undo?: boolean;
  undo_seconds_left?: number;
}

export function SwingClosedPanel({
  positions,
  stats,
  onRefresh,
}: {
  positions: ClosedSwingRow[];
  stats?: {
    with_pnl?: number;
    wins?: number;
    losses?: number;
    win_rate_pct?: number | null;
    avg_r?: number | null;
    total_net_pnl?: number;
    best?: { instrument: string; net_pnl: number; r_multiple: number | null } | null;
    worst?: { instrument: string; net_pnl: number; r_multiple: number | null } | null;
  } | null;
  onRefresh?: () => void | Promise<void>;
}) {
  if (positions.length === 0) return null;

  return (
    <section className="card swing-closed-panel">
      <h2>Closed trades</h2>
      {stats && (stats.with_pnl ?? 0) > 0 ? (
        <div className="swing-pos-summary swing-journal-kpi">
          <span>
            Closed <strong>{stats.with_pnl}</strong>
          </span>
          <span>
            Win rate{' '}
            <strong className={pnlClass((stats.win_rate_pct ?? 0) - 50)}>
              {stats.win_rate_pct != null ? `${stats.win_rate_pct}%` : '—'}
            </strong>
            <span className="muted">
              {' '}
              ({stats.wins}W / {stats.losses}L)
            </span>
          </span>
          {stats.avg_r != null ? (
            <span>
              Avg R <strong>{stats.avg_r}</strong>
            </span>
          ) : null}
          <span>
            Net total{' '}
            <strong className={pnlClass(stats.total_net_pnl)}>{fmtInr(stats.total_net_pnl)}</strong>
          </span>
          {stats.best ? (
            <span>
              Best <strong className="swing-pnl-pos">{stats.best.instrument}</strong> {fmtInr(stats.best.net_pnl)}
              {stats.best.r_multiple != null ? ` · ${stats.best.r_multiple}R` : ''}
            </span>
          ) : null}
          {stats.worst ? (
            <span>
              Worst <strong className="swing-pnl-neg">{stats.worst.instrument}</strong> {fmtInr(stats.worst.net_pnl)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Shares</th>
              <th>P&amp;L</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const shares = p.shares ?? 1;
              const pnl =
                p.closed_price != null
                  ? Math.round((p.closed_price - p.entry_price) * shares * 100) / 100
                  : null;
              return (
                <tr key={p.id}>
                  <td>
                    <Link to={`/stock/${encodeURIComponent(p.symbol)}`}>{p.symbol}</Link>
                  </td>
                  <td>
                    {fmtRs(p.entry_price)}
                    <div className="muted swing-pos-date">{p.entry_date}</div>
                  </td>
                  <td>
                    {fmtRs(p.closed_price)}
                    <div className="muted swing-pos-date">{p.closed_at?.slice(0, 10) ?? ''}</div>
                  </td>
                  <td>{p.shares ?? '—'}</td>
                  <td className={pnlClass(pnl)}>{pnl != null ? fmtInr(pnl) : '—'}</td>
                  <td className="muted">{p.closed_reason ?? '—'}</td>
                  <td>
                    <UndoCloseButton
                      positionId={p.id}
                      closedAt={p.closed_at}
                      reopenPath={`/api/v1/swing/positions/${p.id}/reopen`}
                      onDone={onRefresh}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

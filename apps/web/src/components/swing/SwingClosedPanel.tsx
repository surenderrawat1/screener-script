import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { UndoCloseButton } from '../UndoCloseButton';
import { PnlBreakdown } from './PnlBreakdown';
import { fetchSymbolPrice } from './fetchSymbolPrice';
import type { OpenPositionRow } from './OpenPositionsPanel';
import { sourceBadgeClass, sourceBadgeLabel } from './PositionPriceCell';

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

function ClosedPositionEdit({
  position,
  onSaved,
}: {
  position: ClosedSwingRow;
  onSaved?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [fetchBusy, setFetchBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    entry_price: String(position.entry_price),
    entry_date: position.entry_date,
    shares: position.shares != null ? String(position.shares) : '',
    stop_loss: position.stop_loss != null ? String(position.stop_loss) : '',
    profit_target: position.profit_target != null ? String(position.profit_target) : '',
    notes: position.notes ?? '',
  });

  async function fetchNow() {
    setFetchBusy(true);
    try {
      const price = await fetchSymbolPrice(position.symbol);
      if (price != null) setForm((f) => ({ ...f, entry_price: String(price) }));
    } finally {
      setFetchBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/swing/positions/${position.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          entry_price: Number(form.entry_price),
          entry_date: form.entry_date,
          shares: form.shares ? Number(form.shares) : null,
          stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
          profit_target: form.profit_target ? Number(form.profit_target) : null,
          notes: form.notes || null,
        }),
      });
      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="swing-pos-edit">
      <summary>Edit entry</summary>
      {error ? <p className="error">{error}</p> : null}
      <form className="swing-edit-form" onSubmit={(e) => void save(e)}>
        <label>
          <span className="field-name">Entry ₹</span>
          <div className="swing-entry-price-wrap">
            <input
              type="number"
              step="0.05"
              required
              value={form.entry_price}
              onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary btn-xs" disabled={fetchBusy || busy} onClick={() => void fetchNow()}>
              {fetchBusy ? '…' : 'Fetch now'}
            </button>
          </div>
        </label>
        <label>
          <span className="field-name">Date</span>
          <input type="date" required value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} />
        </label>
        <label>
          <span className="field-name">Shares</span>
          <input type="number" min={0} value={form.shares} onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))} />
        </label>
        <label>
          <span className="field-name">Stop ₹</span>
          <input type="number" step="0.05" value={form.stop_loss} onChange={(e) => setForm((f) => ({ ...f, stop_loss: e.target.value }))} />
        </label>
        <label>
          <span className="field-name">Target ₹</span>
          <input type="number" step="0.05" value={form.profit_target} onChange={(e) => setForm((f) => ({ ...f, profit_target: e.target.value }))} />
        </label>
        <label className="swing-edit-notes">
          <span className="field-name">Notes</span>
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
          {busy ? '…' : 'Save'}
        </button>
      </form>
    </details>
  );
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
              const shares = p.shares ?? 0;
              const exitPrice = p.closed_price;
              const gainPct =
                exitPrice != null && p.entry_price > 0
                  ? Math.round(((exitPrice - p.entry_price) / p.entry_price) * 10000) / 100
                  : null;
              return (
                <tr key={p.id}>
                  <td>
                    <Link to={`/swing?mode=symbol&symbol=${encodeURIComponent(p.symbol)}&autorun=1`}>
                      {p.symbol}
                    </Link>
                    {sourceBadgeLabel(p.source) ? (
                      <span className={`swing-source-badge ${sourceBadgeClass(p.source)}`}>
                        {sourceBadgeLabel(p.source)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {fmtRs(p.entry_price)}
                    <div className="muted swing-pos-date">{p.entry_date}</div>
                    <ClosedPositionEdit position={p} onSaved={onRefresh} />
                  </td>
                  <td>
                    {fmtRs(p.closed_price)}
                    <div className="muted swing-pos-date">{p.closed_at?.slice(0, 10) ?? ''}</div>
                  </td>
                  <td>{p.shares ?? '—'}</td>
                  <td>
                    {exitPrice != null && shares > 0 && p.net_pnl != null ? (
                      <PnlBreakdown
                        entryPrice={p.entry_price}
                        currentPrice={exitPrice}
                        shares={shares}
                        gainPct={gainPct}
                        grossPnl={p.gross_pnl}
                        netPnl={p.net_pnl}
                        charges={p.pnl_detail}
                      />
                    ) : (
                      <span className={pnlClass(p.net_pnl)}>{p.net_pnl != null ? fmtInr(p.net_pnl) : '—'}</span>
                    )}
                  </td>
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

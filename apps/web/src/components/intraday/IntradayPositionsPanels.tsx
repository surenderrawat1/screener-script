import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { EmptyState } from '../PageLayout';
import { UndoCloseButton } from '../UndoCloseButton';

export interface IntradayPositionRow {
  id: string;
  instrument_id: string;
  instrument_label: string;
  symbol: string;
  status: string;
  side: string;
  side_label: string;
  timeframe: string;
  entry_price: number;
  entry_time: string;
  quantity: number | null;
  notes: string | null;
  source: string | null;
  ok?: boolean;
  error?: string | null;
  current_price: number | null;
  as_of?: string | null;
  gain_pct: number | null;
  pnl_inr: number | null;
  exit_verdict: string;
  position_action: string;
  action_label: string;
  exit_triggers: string[];
  effective_stop: number | null;
  target_t1: number | null;
  target_t2: number | null;
  target_t3: number | null;
  remaining_pct?: number;
  t1_booked?: boolean;
  t2_booked?: boolean;
  closed_at?: string | null;
  closed_price?: number | null;
  closed_reason?: string | null;
}

const URGENT_ACTIONS = new Set(['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET', 'CUT_LOSS']);

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
  return n >= 0 ? 'nip-pnl-pos' : 'nip-pnl-neg';
}

function actionClass(action: string): string {
  if (URGENT_ACTIONS.has(action)) return 'nip-row-urgent';
  if (['PARTIAL_T1', 'PARTIAL_T2', 'TIGHTEN_STOP'].includes(action)) return 'nip-row-watch';
  return '';
}

function decisionClass(action: string): string {
  if (['EXIT_NOW', 'EXIT_TIME', 'EXIT_TARGET'].includes(action)) return 'nip-act-exit';
  if (action === 'PARTIAL_T1' || action === 'PARTIAL_T2') return 'nip-act-partial';
  if (action === 'TIGHTEN_STOP') return 'nip-act-tighten';
  return 'nip-act-hold';
}

function sourceBadge(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source.startsWith('fno_')) return source.replace('fno_', '').toUpperCase();
  if (source === 'auto_radar' || source === 'radar') return 'Radar';
  return source;
}

function formatEntryTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export function IntradayOpenPanel({
  positions,
  portfolio,
  refreshedAt,
  onRefresh,
  onClosed,
}: {
  positions: IntradayPositionRow[];
  portfolio?: {
    exit_count?: number;
    urgent_count?: number;
    net_pnl_inr?: number | null;
  } | null;
  refreshedAt?: string | null;
  onRefresh?: () => void | Promise<void>;
  onClosed?: () => void | Promise<void>;
}) {
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const [closeError, setCloseError] = useState('');

  const urgent = positions.filter((r) => URGENT_ACTIONS.has(r.position_action));
  const exitCount = portfolio?.exit_count ?? 0;
  const netPnl = portfolio?.net_pnl_inr;

  async function closePosition(p: IntradayPositionRow) {
    const price = p.current_price;
    if (!p.id || price == null) return;
    if (!window.confirm(`Close ${p.instrument_label} at ${fmtRs(price)}?`)) return;

    setCloseBusy(p.id);
    setCloseError('');
    try {
      await api(`/api/v1/intraday/positions/${p.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ closed_price: price, closed_reason: 'ledger' }),
      });
      if (onClosed) await onClosed();
      else await onRefresh?.();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setCloseBusy(null);
    }
  }

  return (
    <section className="card nip-open-panel">
      {urgent.length > 0 ? (
        <div className="nip-pos-alert" role="alert">
          {urgent.length} position(s) need exit:{' '}
          {urgent.map((r) => `${r.instrument_label} → ${r.action_label}`).join('; ')}
        </div>
      ) : exitCount > 0 ? (
        <div className="nip-pos-alert" role="alert">
          {exitCount} position(s) triggered EXIT rules — review immediately.
        </div>
      ) : null}

      {closeError && <p className="error">{closeError}</p>}

      <div className="nip-kpi">
        <span>
          Open <strong>{positions.length}</strong>
        </span>
        <span className={exitCount > 0 ? 'nip-pnl-neg' : ''}>
          Exit signals <strong>{exitCount}</strong>
        </span>
        {netPnl != null ? (
          <span>
            Session P&amp;L <strong className={pnlClass(netPnl)}>{fmtInr(netPnl)}</strong>
          </span>
        ) : null}
        {refreshedAt ? (
          <span className="muted">Updated {new Date(refreshedAt).toLocaleTimeString()}</span>
        ) : null}
      </div>

      {positions.length === 0 ? (
        <EmptyState>
          No open positions. Log from the{' '}
          <Link to="/intraday">intraday radar</Link> when a trade plan is active.
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="data-table nip-pos-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Side</th>
                <th>TF</th>
                <th>Entry</th>
                <th>Now</th>
                <th>P&amp;L</th>
                <th>Action</th>
                <th>Levels</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id} className={actionClass(p.position_action)}>
                  <td>
                    <Link
                      to={`/intraday?instrument=${encodeURIComponent(p.instrument_id)}&interval=${encodeURIComponent(p.timeframe)}`}
                    >
                      {p.instrument_label}
                    </Link>
                    {sourceBadge(p.source) ? (
                      <span className="nip-source-badge">{sourceBadge(p.source)}</span>
                    ) : null}
                    {p.notes ? <div className="muted nip-notes">{p.notes}</div> : null}
                  </td>
                  <td>{p.side_label}</td>
                  <td>{p.timeframe}</td>
                  <td>
                    {fmtRs(p.entry_price)}
                    <div className="muted nip-time">{formatEntryTime(p.entry_time)}</div>
                  </td>
                  <td>
                    {p.ok && p.current_price != null ? (
                      <>
                        {fmtRs(p.current_price)}
                        {p.as_of ? <div className="muted nip-time">{String(p.as_of)}</div> : null}
                      </>
                    ) : (
                      <span className="nip-pnl-neg">{p.error || 'No data'}</span>
                    )}
                  </td>
                  <td>
                    {p.gain_pct != null ? (
                      <>
                        <span className={pnlClass(p.gain_pct)}>{p.gain_pct >= 0 ? '+' : ''}{p.gain_pct}%</span>
                        {p.pnl_inr != null ? (
                          <div className={`nip-net-pnl ${pnlClass(p.pnl_inr)}`}>{fmtInr(p.pnl_inr)}</div>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`nip-action-badge ${decisionClass(p.position_action)}`}>
                      {p.action_label}
                    </span>
                    {p.exit_triggers.length > 0 ? (
                      <ul className="nip-triggers">
                        {p.exit_triggers.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="nip-levels">
                    <div>Stop {fmtRs(p.effective_stop)}</div>
                    <div>T1 {fmtRs(p.target_t1)}</div>
                    <div>T3 {fmtRs(p.target_t3)}</div>
                    {p.t1_booked ? <span className="nip-booked">T1 ✓</span> : null}
                    {p.t2_booked ? <span className="nip-booked">T2 ✓</span> : null}
                  </td>
                  <td>
                    {p.id && p.current_price != null ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={closeBusy === p.id}
                        onClick={() => void closePosition(p)}
                      >
                        {closeBusy === p.id ? '…' : 'Close'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function IntradayClosedPanel({
  positions,
  stats,
  onRefresh,
}: {
  positions: IntradayPositionRow[];
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
    <section className="card nip-closed-panel">
      <h2>Session journal</h2>
      {stats && (stats.with_pnl ?? 0) > 0 ? (
        <div className="nip-kpi nip-journal-kpi">
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
              Best <strong className="nip-pnl-pos">{stats.best.instrument}</strong> {fmtInr(stats.best.net_pnl)}
            </span>
          ) : null}
          {stats.worst ? (
            <span>
              Worst <strong className="nip-pnl-neg">{stats.worst.instrument}</strong> {fmtInr(stats.worst.net_pnl)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Side</th>
              <th>TF</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const entry = p.entry_price;
              const exit = p.closed_price ?? 0;
              const qty = p.quantity ?? 1;
              const pnl =
                p.side === 'short' ? (entry - exit) * qty : (exit - entry) * qty;
              return (
                <tr key={p.id}>
                  <td>{p.instrument_label}</td>
                  <td>{p.side_label}</td>
                  <td>{p.timeframe}</td>
                  <td>{fmtRs(entry)}</td>
                  <td>{fmtRs(p.closed_price)}</td>
                  <td className={pnlClass(pnl)}>{p.closed_price != null ? fmtInr(pnl) : '—'}</td>
                  <td className="muted">{p.closed_reason ?? '—'}</td>
                  <td>
                    <UndoCloseButton
                      positionId={p.id}
                      closedAt={p.closed_at}
                      reopenPath={`/api/v1/intraday/positions/${p.id}/reopen`}
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

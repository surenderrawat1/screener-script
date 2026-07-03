import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { EmptyState } from '../PageLayout';

export interface OpenPositionRow {
  id: string;
  symbol: string;
  notes?: string;
  source?: string | null;
  status?: string;
  entry_price: number;
  entry_date: string;
  shares: number | null;
  sessions_held?: number;
  current_price: number | null;
  gain_pct: number | null;
  net_pnl: number | null;
  exit_verdict: string;
  exit_triggers: string[];
  position_action: string;
  action_label: string;
  action_reasons: string[];
  active_stop: number | null;
  effective_stop: number | null;
  profit_target: number | null;
  trail_armed: boolean;
  trail_stop: number | null;
  trail_arm_pct: number | null;
  trail_from_high_pct: number | null;
  high_water: number | null;
  gain_to_arm_trail_pct: number | null;
  breakeven_armed: boolean;
  stop_distance_pct: number | null;
  r_unrealized: number | null;
  in_high_conviction?: boolean;
  ok: boolean;
  error?: string;
}

export interface PositionsBlock {
  open: OpenPositionRow[];
  count: number;
  exit_count?: number;
  urgent_count?: number;
  refreshed_at?: string;
  summary?: { open: number; exit_signals: number };
  portfolio?: {
    count: number;
    net_pnl: number;
    invested?: number;
    current_value?: number;
    gross_pnl?: number;
  };
}

const URGENT_ACTIONS = new Set(['EXIT_NOW', 'CUT_LOSS', 'TIGHTEN_STOP']);

function fmtRs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return '';
  return n >= 0 ? 'swing-pnl-pos' : 'swing-pnl-neg';
}

function actionRowClass(action: string): string {
  if (URGENT_ACTIONS.has(action)) return 'swing-pos-urgent';
  if (action.includes('TRIM') || action.includes('REVIEW')) return 'swing-pos-watch';
  if (action.includes('TRAIL') || action.includes('HOLD')) return 'swing-pos-hold';
  return '';
}

function decisionBadgeClass(action: string): string {
  if (action === 'EXIT_NOW') return 'swing-dec-exit';
  if (action === 'CUT_LOSS') return 'swing-dec-cut';
  if (action === 'TIGHTEN_STOP') return 'swing-dec-tighten';
  if (action === 'TRIM_PROFIT') return 'swing-dec-trim';
  if (action === 'TRAIL_ACTIVE') return 'swing-dec-trail';
  if (action === 'HOLD') return 'swing-dec-hold';
  return 'swing-dec-review';
}

function verdictClass(verdict: string): string {
  return verdict === 'EXIT' ? 'swing-verdict-exit' : 'swing-verdict-hold';
}

function StopTargetCell({ p }: { p: OpenPositionRow }) {
  const eff = p.effective_stop ?? p.active_stop;
  const parts: ReactNode[] = [];

  if (p.trail_armed && p.trail_stop != null) {
    parts.push(
      <span key="trail" className="swing-trail-armed">
        Trail {fmtRs(p.trail_stop)}
      </span>,
    );
    if (p.high_water != null && p.trail_from_high_pct != null) {
      parts.push(
        <span key="hw" className="swing-trail-bar">
          −{p.trail_from_high_pct}% from {fmtRs(p.high_water)}
        </span>,
      );
    }
  } else if (p.gain_to_arm_trail_pct != null && p.gain_to_arm_trail_pct > 0) {
    parts.push(
      <span key="arm" className="swing-trail-bar">
        Trail arms at +{p.trail_arm_pct ?? 2}% (need +{p.gain_to_arm_trail_pct}%)
      </span>,
    );
  }

  if (eff != null) parts.push(<span key="floor">Floor {fmtRs(eff)}</span>);
  if (p.stop_distance_pct != null) {
    parts.push(
      <span key="dist" className="swing-trail-bar">
        {p.stop_distance_pct}% above floor
      </span>,
    );
  }
  if (p.profit_target != null) parts.push(<span key="tgt">Tgt {fmtRs(p.profit_target)}</span>);
  if (p.breakeven_armed) parts.push(<span key="be" className="swing-trail-armed">BE+</span>);

  if (parts.length === 0) return <span className="muted">—</span>;

  return (
    <div className="swing-stop-stack">
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </div>
  );
}

export function OpenPositionsPanel({
  positions,
  onRefresh,
  onClosed,
  mode = 'radar',
  showSessions = false,
}: {
  positions: PositionsBlock;
  onRefresh?: () => void | Promise<void>;
  onClosed?: () => void | Promise<void>;
  mode?: 'radar' | 'ledger';
  showSessions?: boolean;
}) {
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const [closeError, setCloseError] = useState('');

  const rows = positions.open;
  const exitCount = positions.exit_count ?? positions.summary?.exit_signals ?? 0;
  const netPnl = positions.portfolio?.net_pnl;
  const invested = positions.portfolio?.invested;
  const currentValue = positions.portfolio?.current_value;
  const refreshedAt = positions.refreshed_at
    ? new Date(positions.refreshed_at).toLocaleTimeString()
    : null;

  const urgent = rows.filter((r) => URGENT_ACTIONS.has(r.position_action));

  async function closePosition(p: OpenPositionRow) {
    if (!p.id || p.current_price == null) return;
    const reason =
      mode === 'ledger'
        ? window.prompt(`Close ${p.symbol} at ${fmtRs(p.current_price)} — exit reason (e.g. X1, X4):`, 'manual')
        : null;
    if (mode === 'ledger' && reason === null) return;

    const ok = window.confirm(
      `Close ${p.symbol} at ${fmtRs(p.current_price)}? This marks the position closed in the ledger.`,
    );
    if (!ok) return;

    setCloseBusy(p.id);
    setCloseError('');
    try {
      await api(`/api/v1/swing/positions/${p.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          closed_price: p.current_price,
          closed_reason: reason || 'auto_radar',
        }),
      });
      if (onClosed) await onClosed();
      else await onRefresh?.();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setCloseBusy(null);
    }
  }

  function sourceBadge(source: string | null | undefined): string | null {
    if (!source || source === 'manual') return null;
    if (source === 'auto_radar') return 'Radar';
    return source.replace(/_/g, ' ');
  }

  return (
    <section className="card swing-pos-panel">
      <div className="swing-pos-header">
        <h2 style={{ margin: 0 }}>{mode === 'ledger' ? 'Open swing positions' : 'Open positions'}</h2>
        <span className="muted swing-pos-subtitle">
          {mode === 'ledger' ? 'Live exit eval · stops & targets' : 'Decision actions · loss control'}
        </span>
      </div>

      {urgent.length > 0 ? (
        <div className="swing-pos-alert" role="alert">
          {urgent.length} position(s) need action:{' '}
          {urgent.map((r) => `${r.symbol} → ${r.action_label || r.position_action}`).join('; ')}
        </div>
      ) : exitCount > 0 ? (
        <div className="swing-pos-alert" role="alert">
          {exitCount} position(s) triggered EXIT rules — review immediately.
        </div>
      ) : null}

      {closeError && <p className="error">{closeError}</p>}

      <div className="swing-pos-summary">
        {rows.length > 0 ? (
          <>
            <span>
              Open <strong>{positions.summary?.open ?? rows.length}</strong>
            </span>
            <span className={exitCount > 0 ? 'swing-pnl-neg' : ''}>
              EXIT signals <strong>{exitCount}</strong>
            </span>
            {invested != null && invested > 0 ? (
              <span>
                Invested <strong>₹{invested.toLocaleString('en-IN')}</strong>
              </span>
            ) : null}
            {currentValue != null && currentValue > 0 ? (
              <span>
                Now <strong>₹{currentValue.toLocaleString('en-IN')}</strong>
              </span>
            ) : null}
            {netPnl != null && (positions.portfolio?.count ?? 0) > 0 ? (
              <span>
                Gross P&amp;L{' '}
                <strong className={pnlClass(netPnl)}>₹{Math.round(netPnl).toLocaleString('en-IN')}</strong>
              </span>
            ) : null}
            {refreshedAt ? <span className="muted">Updated {refreshedAt}</span> : null}
          </>
        ) : (
          <span className="muted">No open positions</span>
        )}
      </div>

      <p className="muted swing-pos-footer">
        Refreshes every 60s with live prices.{' '}
        {mode === 'ledger' ? (
          <Link to="/swing/auto">Swing Auto Radar →</Link>
        ) : (
          <Link to="/positions">Full positions ledger →</Link>
        )}
      </p>

      {rows.length === 0 ? (
        <EmptyState>
          {mode === 'ledger'
            ? 'No open swing positions. Add below or from Swing Auto Radar tier hits.'
            : 'No open swing positions. Add from a tier hit when heat and regime allow.'}
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="data-table swing-pos-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Entry</th>
                <th>Last</th>
                <th>P&amp;L</th>
                {showSessions ? <th>Sessions</th> : null}
                <th>R</th>
                <th>Action</th>
                <th>Exit</th>
                <th>Stop / target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id || p.symbol} className={actionRowClass(p.position_action)}>
                  <td>
                    <Link to={`/stock/${encodeURIComponent(p.symbol)}`}>{p.symbol}</Link>
                    {sourceBadge(p.source) ? (
                      <span className="swing-source-badge">{sourceBadge(p.source)}</span>
                    ) : null}
                    {p.in_high_conviction ? <span className="swing-hc-star" title="High conviction"> ★</span> : null}
                    {p.notes ? <div className="muted swing-pos-notes">{p.notes}</div> : null}
                  </td>
                  <td>
                    {fmtRs(p.entry_price)}
                    {p.entry_date ? <div className="muted swing-pos-date">{p.entry_date}</div> : null}
                    {p.shares != null && p.shares > 0 ? (
                      <div className="muted swing-pos-date">{p.shares} sh</div>
                    ) : null}
                  </td>
                  <td>
                    {p.ok && p.current_price != null ? (
                      fmtRs(p.current_price)
                    ) : (
                      <span className="swing-pnl-neg">{p.error || 'No data'}</span>
                    )}
                  </td>
                  <td>
                    {p.gain_pct != null ? (
                      <>
                        <span className={pnlClass(p.gain_pct)}>{fmtPct(p.gain_pct)}</span>
                        {p.net_pnl != null ? (
                          <div className={`swing-net-pnl ${pnlClass(p.net_pnl)}`}>
                            Net ₹{Math.round(p.net_pnl).toLocaleString('en-IN')}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  {showSessions ? (
                    <td>{p.sessions_held != null && p.sessions_held > 0 ? p.sessions_held : '—'}</td>
                  ) : null}
                  <td>{p.r_unrealized != null ? `${p.r_unrealized}R` : '—'}</td>
                  <td>
                    <span className={`swing-decision ${decisionBadgeClass(p.position_action)}`}>
                      {p.action_label || p.position_action}
                    </span>
                    {p.action_reasons.length > 0 ? (
                      <div className="muted swing-pos-reasons">{p.action_reasons.join(' · ')}</div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`swing-verdict ${verdictClass(p.exit_verdict)}`}>
                      {p.exit_verdict}
                    </span>
                    {p.exit_triggers.length > 0 ? (
                      <div className="muted swing-pos-triggers">{p.exit_triggers.join(', ')}</div>
                    ) : null}
                  </td>
                  <td className="swing-stop-cell">
                    <StopTargetCell p={p} />
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

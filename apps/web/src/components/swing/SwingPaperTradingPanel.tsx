import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

interface SwingPaperState {
  ok: boolean;
  wallet: {
    cash_balance: number;
    reserved_cash: number;
    equity_inr: number;
    realized_pnl: number;
    swing_auto_armed: boolean;
    last_tick_at: string | null;
  };
  period?: {
    id: string;
    label: string;
    started_at: string;
    equity_start_inr: number;
  };
  archives?: Array<{
    id: string;
    label: string;
    started_at: string;
    ended_at: string;
    closed_trade_count: number;
    wallet_reset: boolean;
    proof: { trades: number; win_rate_pct: number | null; net_pnl_inr: number };
    risk: { max_drawdown_pct: number };
  }>;
  open_positions: Array<{
    id: string;
    symbol: string;
    quantity: number;
    entry_price: number;
    stop_loss: number | null;
    effective_stop: number | null;
    target: number | null;
    notional_inr: number;
  }>;
  closed_positions: Array<{
    id: string;
    symbol: string;
    realized_pnl: number | null;
    closed_reason: string | null;
  }>;
  heat_pct: number;
  proof: {
    trades: number;
    wins: number;
    losses: number;
    win_rate_pct: number | null;
    net_pnl_inr: number;
    expectancy_inr?: number | null;
    profit_factor?: number | null;
    by_regime?: Array<{
      regime: string;
      trades: number;
      wins: number;
      losses: number;
      win_rate_pct: number | null;
      net_pnl_inr: number;
      expectancy_inr: number | null;
      profit_factor: number | null;
      expectancy_pct?: number | null;
    }>;
  };
  risk?: {
    max_drawdown_pct: number;
    max_drawdown_inr: number;
    rolling_max_drawdown_pct: number;
    rolling_window_trades: number;
    downside_deviation_pct: number | null;
    equity_end_inr: number;
  };
  sample?: {
    closed_trades: number;
    archived_trades: number;
    total_trades: number;
    min_trades: number;
    target_trades: number;
    pct_to_min: number;
    pct_to_target: number;
    min_ready: boolean;
    target_ready: boolean;
    status: string;
    summary: string;
    regimes?: { bull: number; sideways: number; bear: number; unknown: number };
    min_per_regime?: number;
    regimes_covered?: number;
    regimes_needed?: number;
    cycle_ready?: boolean;
    cycle_gaps?: string[];
  };
  policy: {
    min_bt_trades: number;
    min_bt_win_rate_pct: number;
    strict_enter_only: boolean;
    max_entries_per_tick: number;
    paper_only: boolean;
    rolling_dd_trades?: number;
    max_sector_notional_pct?: number;
    sample_min_per_regime?: number;
  };
  nse: { label: string; phase: string; ist_time: string };
}

export function SwingPaperTradingPanel() {
  const [state, setState] = useState<SwingPaperState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setState(await api<SwingPaperState>('/api/v1/swing/paper/state'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load swing paper wallet');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function arm(armed: boolean) {
    setBusy(true);
    setError('');
    try {
      await api('/api/v1/swing/paper/arm', {
        method: 'POST',
        body: JSON.stringify({ armed }),
      });
      setNotice(armed ? 'Swing paper auto-trading armed.' : 'Swing paper auto-trading disarmed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update Swing paper arm');
    } finally {
      setBusy(false);
    }
  }

  async function tick() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{
        skipped?: boolean;
        reason?: string;
        entries?: Array<{ skipped?: boolean }>;
        exits?: Array<{ closed?: boolean }>;
      }>('/api/v1/swing/paper/tick', { method: 'POST', body: '{}' });
      const opened = (result.entries ?? []).filter((entry) => !entry.skipped).length;
      const closed = (result.exits ?? []).filter((exit) => exit.closed).length;
      setNotice(
        result.skipped
          ? `Tick: ${result.reason ?? 'No action'} · ${closed} closed`
          : `Tick complete: ${opened} opened · ${closed} closed`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Swing paper tick failed');
    } finally {
      setBusy(false);
    }
  }

  async function archive(resetWallet: boolean) {
    const label = window.prompt(
      resetWallet
        ? 'Archive this evaluation period and reset paper cash to opening balance. Optional label:'
        : 'Archive this evaluation period (stats only; cash unchanged). Optional label:',
      state?.period?.label ?? '',
    );
    if (label === null) return;
    if (resetWallet) {
      const ok = window.confirm(
        'Reset paper wallet cash to opening balance? Requires no open Swing or intraday paper positions. Continues?',
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{
        ok: boolean;
        error?: string;
        archive?: { label: string; closed_trade_count: number };
        wallet_reset?: boolean;
      }>('/api/v1/swing/paper/archive', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim() || undefined, reset_wallet: resetWallet }),
      });
      if (!result.ok) {
        setError(result.error ?? 'Archive failed');
        return;
      }
      setNotice(
        `Archived “${result.archive?.label ?? 'period'}” · ${result.archive?.closed_trade_count ?? 0} closes` +
          (result.wallet_reset ? ' · wallet reset' : ''),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setBusy(false);
    }
  }

  const wallet = state?.wallet;
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Swing Auto live paper trading</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Paper-only execution from fresh High Conviction hits. Requires Strict ENTER, soft-valid 3R
        geometry, at least {state?.policy.min_bt_trades ?? 10} backtest trades and soft ≥
        {state?.policy.min_bt_win_rate_pct ?? 70}% profitable trades. Maximum{' '}
        {state?.policy.max_entries_per_tick ?? 2} new positions per worker tick. Fees use NSE
        delivery schedule (STT, stamp, exchange, SEBI, GST, DP + ₹20 brokerage/order).
      </p>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      {wallet ? (
        <>
          <div className="swing-backtest-stats">
            <span>Cash ₹{wallet.cash_balance.toLocaleString('en-IN')}</span>
            <span>Reserved ₹{wallet.reserved_cash.toLocaleString('en-IN')}</span>
            <span>Equity ₹{wallet.equity_inr.toLocaleString('en-IN')}</span>
            <span>Realized ₹{wallet.realized_pnl.toLocaleString('en-IN')}</span>
            <span>Heat {state?.heat_pct ?? 0}%</span>
            <span className={wallet.swing_auto_armed ? 'swing-pnl-pos' : 'muted'}>
              Swing auto {wallet.swing_auto_armed ? 'ARMED' : 'OFF'}
            </span>
            <span className="muted">
              NSE {state?.nse.label} · {state?.nse.ist_time}
            </span>
          </div>
          {state?.period ? (
            <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              Evaluation period: <strong>{state.period.label}</strong> · started{' '}
              {state.period.started_at.slice(0, 10)} · equity start ₹
              {state.period.equity_start_inr.toLocaleString('en-IN')}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void arm(!wallet.swing_auto_armed)}
            >
              {wallet.swing_auto_armed ? 'Disarm Swing paper' : 'Arm Swing paper'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void tick()}>
              Run paper tick now
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || (state?.open_positions.length ?? 0) > 0}
              title="Snapshot proof/risk and start a new evaluation period (cash unchanged)"
              onClick={() => void archive(false)}
            >
              Archive period
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || (state?.open_positions.length ?? 0) > 0}
              title="Archive period and reset shared paper cash to opening balance"
              onClick={() => void archive(true)}
            >
              Archive + reset cash
            </button>
          </div>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Period proof: {state?.proof.trades ?? 0} trades · WR {state?.proof.win_rate_pct ?? '—'}% ·
            E ₹{state?.proof.expectancy_inr ?? '—'} · PF {state?.proof.profit_factor ?? '—'} · net ₹
            {(state?.proof.net_pnl_inr ?? 0).toLocaleString('en-IN')}
            {' · '}
            <Link to="/" className="muted">
              Ops alerts on Dashboard
            </Link>
          </p>
          {(state?.proof.by_regime?.some((r) => r.trades > 0) ?? false) ? (
            <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Regime</th>
                    <th>n</th>
                    <th>WR</th>
                    <th>E ₹</th>
                    <th>PF</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.proof.by_regime!
                    .filter((row) => row.trades > 0)
                    .map((row) => (
                      <tr key={row.regime}>
                        <td>{row.regime}</td>
                        <td>{row.trades}</td>
                        <td>{row.win_rate_pct != null ? `${row.win_rate_pct}%` : '—'}</td>
                        <td>{row.expectancy_inr != null ? row.expectancy_inr : '—'}</td>
                        <td>{row.profit_factor != null ? row.profit_factor : '—'}</td>
                        <td>₹{row.net_pnl_inr.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {state?.sample ? (
            <div className="swing-backtest-stats" style={{ marginTop: '0.35rem' }}>
              <span
                className={
                  state.sample.target_ready
                    ? 'swing-pnl-pos'
                    : state.sample.min_ready
                      ? undefined
                      : 'muted'
                }
                title={state.sample.summary}
              >
                OOS sample {state.sample.total_trades}/{state.sample.target_trades}
                {state.sample.archived_trades > 0
                  ? ` (${state.sample.closed_trades} period + ${state.sample.archived_trades} archived)`
                  : ''}
              </span>
              <span title="Progress to CFA minimum 30 closes">
                Min {state.sample.pct_to_min}%
              </span>
              <span title="Progress to CFA target 50 closes">
                Target {state.sample.pct_to_target}%
              </span>
              {state.sample.regimes ? (
                <span
                  className={state.sample.cycle_ready ? 'swing-pnl-pos' : 'muted'}
                  title={
                    state.sample.cycle_ready
                      ? `Cycle coverage ready (≥${state.sample.min_per_regime ?? 5} each)`
                      : `Need ≥${state.sample.min_per_regime ?? 5} closes in each regime: ${(state.sample.cycle_gaps ?? []).join(', ') || '—'}`
                  }
                >
                  Cycles B{state.sample.regimes.bull}/S{state.sample.regimes.sideways}/Be
                  {state.sample.regimes.bear}
                  {state.sample.regimes.unknown > 0 ? ` · ?${state.sample.regimes.unknown}` : ''}
                </span>
              ) : null}
            </div>
          ) : null}
          {state?.risk ? (
            <div className="swing-backtest-stats" style={{ marginTop: '0.35rem' }}>
              <span title="Peak-to-trough on this period’s closed-trade equity curve">
                Max DD {state.risk.max_drawdown_pct}% (₹
                {state.risk.max_drawdown_inr.toLocaleString('en-IN')})
              </span>
              <span
                title={`Max drawdown on last ${state.risk.rolling_window_trades} closed trades`}
              >
                Rolling DD {state.risk.rolling_max_drawdown_pct}% (n=
                {state.risk.rolling_window_trades})
              </span>
              <span title="Downside deviation of per-trade returns (MAR = 0)">
                Downside σ{' '}
                {state.risk.downside_deviation_pct != null
                  ? `${state.risk.downside_deviation_pct}%`
                  : '—'}
              </span>
            </div>
          ) : null}
          {(state?.archives?.length ?? 0) > 0 ? (
            <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Archived period</th>
                    <th>Trades</th>
                    <th>WR</th>
                    <th>Net</th>
                    <th>Max DD</th>
                    <th>Reset</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.archives!.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.label}</strong>
                        <br />
                        <span className="muted">
                          {row.started_at.slice(0, 10)} → {row.ended_at.slice(0, 10)}
                        </span>
                      </td>
                      <td>{row.closed_trade_count}</td>
                      <td>{row.proof.win_rate_pct != null ? `${row.proof.win_rate_pct}%` : '—'}</td>
                      <td>₹{row.proof.net_pnl_inr.toLocaleString('en-IN')}</td>
                      <td>{row.risk.max_drawdown_pct}%</td>
                      <td>{row.wallet_reset ? 'yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {(state?.open_positions.length ?? 0) > 0 ? (
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Target</th>
                    <th>Notional</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.open_positions.map((position) => (
                    <tr key={position.id}>
                      <td><strong>{position.symbol}</strong></td>
                      <td>{position.quantity}</td>
                      <td>₹{position.entry_price}</td>
                      <td>₹{position.effective_stop ?? position.stop_loss ?? '—'}</td>
                      <td>₹{position.target ?? '—'}</td>
                      <td>₹{position.notional_inr.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No open Swing paper positions.</p>
          )}
        </>
      ) : (
        <p className="muted">Loading paper wallet…</p>
      )}
    </section>
  );
}

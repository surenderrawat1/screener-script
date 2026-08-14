import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

interface PaperProofSummary {
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  net_pnl_inr: number;
  stratzy_trades: number;
  sample_ok: boolean;
}

interface PaperWalletState {
  ok: boolean;
  strategy_preset?: string;
  strategy_label?: string;
  proof?: {
    today: PaperProofSummary;
    all: PaperProofSummary;
    note: string;
  };
  wallet: {
    cash_balance: number;
    reserved_cash: number;
    equity_inr: number;
    realized_pnl: number;
    auto_armed: boolean;
    opening_balance: number;
    max_notional_inr: number;
    max_open_positions: number;
    last_tick_at: string | null;
  };
  heat_pct: number;
  session_date: string;
  session_day_realized_pnl: number;
  nse: { phase: string; label: string; ist_time: string };
  open_positions: Array<{
    id: string;
    symbol: string;
    side: string;
    quantity: number;
    entry_price: number;
    notional_inr: number;
    stop_loss: number | null;
  }>;
  closed_today: Array<{
    id: string;
    symbol: string;
    realized_pnl: number | null;
    closed_reason: string | null;
  }>;
}

interface PaperTickResult {
  skipped?: boolean;
  reason?: string;
  entries?: Array<{
    instrument?: string;
    skipped?: boolean;
    reason?: string;
    position?: { symbol?: string };
  }>;
  exits?: Array<{ closed?: boolean }>;
}

export function IntradayPaperWalletPanel() {
  const [state, setState] = useState<PaperWalletState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api<PaperWalletState>('/api/v1/intraday/paper/wallet');
      setState(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet load failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function fund() {
    setBusy(true);
    try {
      await api('/api/v1/intraday/paper/fund', { method: 'POST', body: '{}' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fund failed');
    } finally {
      setBusy(false);
    }
  }

  async function arm(armed: boolean) {
    setBusy(true);
    try {
      await api('/api/v1/intraday/paper/arm', {
        method: 'POST',
        body: JSON.stringify({ armed }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Arm failed');
    } finally {
      setBusy(false);
    }
  }

  async function tick() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<PaperTickResult>('/api/v1/intraday/paper/tick', {
        method: 'POST',
        body: '{}',
      });
      if (result.skipped) {
        const forced = (result.exits ?? []).filter((exit) => exit.closed).length;
        setNotice(
          forced > 0
            ? `Tick: ${result.reason ?? 'session close'} (${forced} force-closed).`
            : `Tick skipped: ${result.reason ?? 'No action required'}.`,
        );
      } else {
        const entries = result.entries ?? [];
        const opened = entries.filter((entry) => !entry.skipped).length;
        const duplicates = entries.filter(
          (entry) => entry.skipped && entry.reason?.toLowerCase().startsWith('already open'),
        ).length;
        const closed = (result.exits ?? []).filter((exit) => exit.closed).length;
        const parts = [`${opened} opened`, `${closed} closed`];
        if (duplicates > 0) parts.push(`${duplicates} duplicate ${duplicates === 1 ? 'symbol' : 'symbols'} skipped`);
        setNotice(`Tick complete: ${parts.join(' · ')}.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tick failed');
    } finally {
      setBusy(false);
    }
  }

  const w = state?.wallet;

  return (
    <section className="card">
      <h2>Paper wallet (test)</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        ₹1 lakh seed · liquid stocks only · max ₹30k/trade · max 10 opens · bar-close fills · Stratzy
        proof uses <strong>20 MA Stratzy</strong> (<code>ma20_stratzy</code>) with no historical
        backtest gate. Worker ticks every 60s when armed.
      </p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="nip-log-success">{notice}</p>}
      {w ? (
        <>
          <div className="swing-backtest-stats">
            <span>Cash ₹{w.cash_balance.toLocaleString('en-IN')}</span>
            <span>Reserved ₹{w.reserved_cash.toLocaleString('en-IN')}</span>
            <span>Equity ₹{w.equity_inr.toLocaleString('en-IN')}</span>
            <span>Realized ₹{w.realized_pnl.toLocaleString('en-IN')}</span>
            <span>Heat {state?.heat_pct ?? 0}%</span>
            <span>
              Day P&amp;L ₹{(state?.session_day_realized_pnl ?? 0).toLocaleString('en-IN')}
            </span>
            <span className="muted">
              NSE {state?.nse.label} · {state?.nse.ist_time} · {state?.session_date}
            </span>
            <span className={w.auto_armed ? 'intraday-pos' : 'muted'}>
              Auto {w.auto_armed ? 'ARMED' : 'OFF'}
            </span>
            <span className="muted">
              Strategy {state?.strategy_label ?? '20 MA Stratzy'}
              {state?.strategy_preset ? ` · ${state.strategy_preset}` : ''}
            </span>
          </div>
          <p className="muted" style={{ margin: '0.65rem 0 0' }}>
            Duplicate guard active: auto-trading skips any symbol that already has an open paper position today.
          </p>
          {state?.proof ? (
            <div className="swing-backtest-stats" style={{ marginTop: '0.75rem' }}>
              <span>
                Today {state.proof.today.trades} closes · WR{' '}
                {state.proof.today.win_rate_pct ?? '—'}% · ₹
                {state.proof.today.net_pnl_inr.toLocaleString('en-IN')}
              </span>
              <span>
                All-time {state.proof.all.trades} closes · WR {state.proof.all.win_rate_pct ?? '—'}% · ₹
                {state.proof.all.net_pnl_inr.toLocaleString('en-IN')}
              </span>
              <span className={state.proof.all.sample_ok ? 'intraday-pos' : 'muted'}>
                Stratzy sample {state.proof.all.stratzy_trades}
                {state.proof.all.sample_ok ? ' · ready' : ' / 5'}
              </span>
              <span className="muted">{state.proof.note}</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void fund()}>
              Ensure ₹1L fund
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void arm(!w.auto_armed)}
            >
              {w.auto_armed ? 'Disarm auto' : 'Arm auto-trade'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void tick()}>
              Run tick now
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {(state?.open_positions.length ?? 0) > 0 ? (
            <>
              <h3 style={{ marginTop: '1rem' }}>Open paper positions</h3>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Notional</th>
                    <th>Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.open_positions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.symbol}</td>
                      <td>{p.side}</td>
                      <td>{p.quantity}</td>
                      <td>₹{p.entry_price}</td>
                      <td>₹{p.notional_inr.toLocaleString('en-IN')}</td>
                      <td>{p.stop_loss ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              No open paper positions.
            </p>
          )}
          {(state?.closed_today.length ?? 0) > 0 ? (
            <>
              <h3 style={{ marginTop: '1rem' }}>Closed today</h3>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>P&amp;L</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.closed_today.map((p) => (
                    <tr key={p.id}>
                      <td>{p.symbol}</td>
                      <td className={(p.realized_pnl ?? 0) >= 0 ? 'intraday-pos' : 'intraday-neg'}>
                        ₹{(p.realized_pnl ?? 0).toLocaleString('en-IN')}
                      </td>
                      <td>{p.closed_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : (
        <p className="muted">Loading wallet…</p>
      )}
    </section>
  );
}

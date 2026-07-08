import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface PresetRow {
  preset_id: string;
  label: string;
  sessions: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  avg_r: number | null;
}

interface BacktestPayload {
  ok: boolean;
  instrument_label: string;
  range: string;
  interval: string;
  mode: string;
  sessions: number;
  bars_5m: number;
  bars_15m: number;
  presets: PresetRow[];
  disclaimer: string;
}

export default function IntradayBacktestPage() {
  const [searchParams] = useSearchParams();
  const [instrument, setInstrument] = useState(searchParams.get('instrument') ?? 'nifty50');
  const [interval, setInterval] = useState<'5m' | '15m'>(
    searchParams.get('interval') === '15m' ? '15m' : '5m',
  );
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BacktestPayload | null>(null);

  const run = useCallback(async () => {
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await api<BacktestPayload>('/api/v1/intraday/backtests', {
        method: 'POST',
        body: JSON.stringify({
          instrument,
          interval,
          mode: 'combo_compare',
          days,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }, [instrument, interval, days]);

  useEffect(() => {
    if (searchParams.get('autorun') === '1') void run();
  }, [searchParams, run]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await run();
  }

  return (
    <Page>
      <PageHeader
        title="Intraday Backtest"
        subtitle="60d preset matrix — same entry-filter gates as live radar"
        actions={
          <Link to="/intraday" className="btn btn-secondary">
            ← Live radar
          </Link>
        }
      />
      <p className="disclaimer">
        Simulated fills at plan stop/T1 — no slippage, charges, or partial exits. Run before sizing live
        intraday trades.
      </p>

      <form className="card form-grid" onSubmit={onSubmit}>
        <label>
          Instrument
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            <option value="nifty50">Nifty 50</option>
            <option value="banknifty">Bank Nifty</option>
          </select>
        </label>
        <label>
          Active TF
          <select value={interval} onChange={(e) => setInterval(e.target.value as '5m' | '15m')}>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
          </select>
        </label>
        <label>
          History (days)
          <input type="number" min={5} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Running matrix…' : 'Run combo compare'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card">
          <h2>
            {result.instrument_label} · {result.range} · {result.sessions} sessions
          </h2>
          <p className="muted">
            {result.bars_5m} × 5m bars · {result.bars_15m} × 15m bars · ranked by avg R
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Preset</th>
                  <th>Trades</th>
                  <th>Win%</th>
                  <th>Avg R</th>
                  <th>W/L</th>
                </tr>
              </thead>
              <tbody>
                {result.presets.map((row) => (
                  <tr key={row.preset_id}>
                    <td>
                      <strong>{row.label}</strong>
                      <div className="muted">{row.preset_id}</div>
                    </td>
                    <td>{row.trades}</td>
                    <td>{row.win_rate_pct != null ? `${row.win_rate_pct}%` : '—'}</td>
                    <td>{row.avg_r != null ? `${row.avg_r}R` : '—'}</td>
                    <td>
                      {row.wins}/{row.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            {result.disclaimer}
          </p>
        </div>
      )}
    </Page>
  );
}

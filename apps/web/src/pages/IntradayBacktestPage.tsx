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
  scaled_win_rate_pct?: number | null;
  net_win_rate_pct?: number | null;
  avg_r: number | null;
  classic_avg_r?: number | null;
  expectancy_r?: number | null;
  net_expectancy_r?: number | null;
  profit_factor?: number | null;
  profit_factor_gross?: number | null;
  economic_status?: string;
  economic_pass?: boolean;
  accuracy_status: 'pass' | 'fail' | 'unproven' | 'missing';
  accuracy_pass: boolean;
  accuracy_floor_pct: number;
  min_trades_required: number;
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
  high_accuracy: {
    floor_pct: number;
    strictly_above_floor: boolean;
    min_trades_required: number;
    passing_presets: string[];
    pass_count: number;
  };
  economic?: {
    min_expectancy_r: number;
    min_profit_factor: number;
    passing_presets: string[];
    pass_count: number;
    best_preset_id: string | null;
  };
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
        <strong>Stratzy Win%</strong> is classic T1-only (+1R/−1R) — same as before today (typically
        mid-40%s; &gt;70% live gate unchanged). <strong>Net E</strong> uses scaled T1/T2/T3 after costs.
        Lower scaled/net WR does not mean entries got worse.
      </p>

      <form className="card form-grid" onSubmit={onSubmit}>
        <label>
          Instrument
          <input
            value={instrument}
            onChange={(e) => setInstrument(e.target.value.trim())}
            placeholder="nifty50, TCS, NIFTYBEES, SUNPHARMA"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            list="intraday-bt-instruments"
          />
          <datalist id="intraday-bt-instruments">
            <option value="nifty50">Nifty 50</option>
            <option value="banknifty">Bank Nifty</option>
            <option value="sensex">Sensex</option>
            <option value="finnifty">Fin Nifty</option>
            <option value="tcs">TCS</option>
            <option value="niftybees">NIFTYBEES</option>
          </datalist>
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
            {result.bars_5m} × 5m bars · {result.bars_15m} × 15m bars · ranked by{' '}
            <strong>net expectancy → PF</strong>, then WR gate
          </p>
          <p className={result.economic && result.economic.pass_count > 0 ? 'success' : 'disclaimer'}>
            Economic gate: net E &gt;{result.economic?.min_expectancy_r ?? 0.1}R and PF ≥
            {result.economic?.min_profit_factor ?? 1.25} ·{' '}
            <strong>{result.economic?.pass_count ?? 0} preset(s) pass</strong>
            {result.economic?.best_preset_id ? ` · best ${result.economic.best_preset_id}` : ''}
          </p>
          <p className={result.high_accuracy.pass_count > 0 ? 'success' : 'disclaimer'}>
            Live Stratzy WR gate (T1-only):{' '}
            <strong>&gt;{result.high_accuracy.floor_pct}% profitable trades</strong> with at least{' '}
            {result.high_accuracy.min_trades_required} trades ·{' '}
            <strong>{result.high_accuracy.pass_count} preset(s) pass</strong>
            {result.high_accuracy.passing_presets.length
              ? ` — ${result.high_accuracy.passing_presets.join(', ')}`
              : ' — no live-eligible preset in this sample'}
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Preset</th>
                  <th>Trades</th>
                  <th title="Classic T1-only win rate — Stratzy / pre-today yardstick">Stratzy WR</th>
                  <th title="Scaled-book gross win rate (runners can give back)">Scaled WR</th>
                  <th>Net E</th>
                  <th>PF</th>
                  <th>Econ</th>
                  <th>&gt;70% WR</th>
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
                    <td className="muted">
                      {row.scaled_win_rate_pct != null ? `${row.scaled_win_rate_pct}%` : '—'}
                    </td>
                    <td className={(row.net_expectancy_r ?? 0) > 0 ? 'swing-pnl-pos' : 'swing-pnl-neg'}>
                      {row.net_expectancy_r != null ? `${row.net_expectancy_r}R` : '—'}
                    </td>
                    <td>{row.profit_factor ?? '—'}</td>
                    <td>
                      <strong className={row.economic_pass ? 'swing-pnl-pos' : 'swing-pnl-neg'}>
                        {(row.economic_status ?? 'missing').toUpperCase()}
                      </strong>
                    </td>
                    <td>
                      <strong className={row.accuracy_pass ? 'swing-pnl-pos' : 'swing-pnl-neg'}>
                        {row.accuracy_status === 'pass'
                          ? 'PASS'
                          : row.accuracy_status === 'unproven'
                            ? `UNPROVEN (<${row.min_trades_required})`
                            : row.accuracy_status.toUpperCase()}
                      </strong>
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

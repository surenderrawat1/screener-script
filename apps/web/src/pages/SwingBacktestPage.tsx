import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface BacktestStats {
  signal_count: number;
  enter_count: number;
  setup_count: number;
  target_hit_rate_pct: number | null;
  stop_hit_rate_pct: number | null;
  avg_forward_return_pct: number | null;
  win_rate_pct: number | null;
}

interface BacktestResult {
  ok: boolean;
  symbol: string;
  bars_used: number;
  warmup: number;
  stats: BacktestStats;
  signals: Array<{
    date: string;
    price: number;
    verdict: string;
    strict_verdict: string;
    rules_passed: number;
    forward_return_pct: number | null;
    hit_target: boolean;
    hit_stop: boolean;
  }>;
}

export default function SwingBacktestPage() {
  const [searchParams] = useSearchParams();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [mode, setMode] = useState<'symbol' | 'universe'>('symbol');
  const [symbol, setSymbol] = useState(searchParams.get('symbol') ?? 'TCS');
  const [universe, setUniverse] = useState('nifty50');
  const [maxScan, setMaxScan] = useState(10);
  const [minVerdict, setMinVerdict] = useState('SETUP_PLUS');
  const [zone52w, setZone52w] = useState('any');
  const [gc9Only, setGc9Only] = useState(false);
  const [warmup, setWarmup] = useState(220);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<{
    combined: Record<string, unknown>;
    results: BacktestResult[];
  } | null>(null);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes').then((r) => setUniverses(r.universes)).catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    setError('');
    setLoading(true);
    setPayload(null);
    try {
      const body =
        mode === 'symbol'
          ? { symbol: symbol.trim().toUpperCase(), min_verdict: minVerdict, zone_52w: zone52w, gc9_only: gc9Only, warmup }
          : { universe, maxScan, min_verdict: minVerdict, zone_52w: zone52w, gc9_only: gc9Only, warmup };
      const res = await api<{ combined: Record<string, unknown>; results: BacktestResult[] }>('/api/v1/swing/backtest', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPayload(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }, [mode, symbol, universe, maxScan, minVerdict, zone52w, gc9Only, warmup]);

  useEffect(() => {
    if (searchParams.get('autorun') === '1' && symbol) void run();
  }, [searchParams, symbol, run]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await run();
  }

  return (
    <Page>
      <PageHeader
        title="Swing Backtest"
        subtitle="Walk-forward E1–E11 replay on daily bars (same filters as scanner)"
        actions={
          <Link to="/swing" className="btn btn-secondary">
            ← Scanner
          </Link>
        }
      />
      <p className="disclaimer">Educational backtest — not live P&amp;L. Uses current NIFTYBEES regime for all historical bars.</p>

      <form className="card" onSubmit={onSubmit}>
        <div className="segmented" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className={mode === 'symbol' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('symbol')}>
            Single symbol
          </button>
          <button type="button" className={mode === 'universe' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('universe')}>
            Universe sample
          </button>
        </div>

        {mode === 'symbol' ? (
          <div className="form-group">
            <label>Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
        ) : (
          <div className="form-row">
            <div className="form-group">
              <label>Universe</label>
              <select value={universe} onChange={(e) => setUniverse(e.target.value)} style={{ width: '100%' }}>
                {universes.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Max symbols</label>
              <input type="number" min={1} max={15} value={maxScan} onChange={(e) => setMaxScan(Number(e.target.value))} />
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Min verdict</label>
            <select value={minVerdict} onChange={(e) => setMinVerdict(e.target.value)} style={{ width: '100%' }}>
              <option value="ENTER">ENTER</option>
              <option value="SETUP_PLUS">SETUP+</option>
              <option value="WATCH">WATCH</option>
              <option value="ALL">ALL</option>
            </select>
          </div>
          <div className="form-group">
            <label>52w zone</label>
            <select value={zone52w} onChange={(e) => setZone52w(e.target.value)} style={{ width: '100%' }}>
              <option value="any">Any</option>
              <option value="green">Green</option>
              <option value="mid">Mid</option>
              <option value="red">Red</option>
            </select>
          </div>
          <div className="form-group">
            <label>Warmup bars</label>
            <input type="number" min={100} max={300} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} />
          </div>
        </div>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={gc9Only} onChange={(e) => setGc9Only(e.target.checked)} />
          GC9 entry only
        </label>

        <button type="button" className="btn" disabled={loading} onClick={() => void run()}>
          {loading ? 'Running…' : 'Run backtest'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {payload && (
        <>
          <section className="card">
            <h2>Summary</h2>
            <p>
              Symbols {String(payload.combined.symbols)} · Total signals {String(payload.combined.total_signals)} · Strict ENTER{' '}
              {String(payload.combined.total_enter_signals)} · Avg win rate {String(payload.combined.avg_win_rate_pct ?? '—')}%
            </p>
          </section>

          {payload.results.map((r) => (
            <section key={r.symbol} className="card">
              <h2>
                {r.symbol} <span className="muted">({r.bars_used} bars · warmup {r.warmup})</span>
              </h2>
              <div className="swing-backtest-stats">
                <span>Signals {r.stats.signal_count}</span>
                <span>ENTER {r.stats.enter_count}</span>
                <span>Win rate {r.stats.win_rate_pct ?? '—'}%</span>
                <span>Avg fwd {r.stats.avg_forward_return_pct ?? '—'}%</span>
                <span>Target hit {r.stats.target_hit_rate_pct ?? '—'}%</span>
                <span>Stop hit {r.stats.stop_hit_rate_pct ?? '—'}%</span>
              </div>
              {r.signals.length > 0 ? (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Price</th>
                      <th>Verdict</th>
                      <th>Strict</th>
                      <th>Rules</th>
                      <th>Fwd 20d %</th>
                      <th>Tgt</th>
                      <th>Stp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.signals.map((s) => (
                      <tr key={`${r.symbol}-${s.date}`}>
                        <td>{s.date}</td>
                        <td>₹{s.price}</td>
                        <td>{s.verdict}</td>
                        <td>{s.strict_verdict}</td>
                        <td>{s.rules_passed}</td>
                        <td>{s.forward_return_pct ?? '—'}</td>
                        <td>{s.hit_target ? '✓' : '—'}</td>
                        <td>{s.hit_stop ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No signals matched filters in lookback window.</p>
              )}
            </section>
          ))}
        </>
      )}
    </Page>
  );
}

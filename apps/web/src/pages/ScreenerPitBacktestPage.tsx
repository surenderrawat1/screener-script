import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

type ScreenerPreset = {
  id: string;
  label: string;
};

type PitBacktestResultRow = {
  symbol: string;
  price_as_of: number | null;
  forward_return_pct: number | null;
  passed: boolean;
};

type PitBacktestResult = {
  ok: true;
  universe: string | null;
  asOfDaysAgo: number;
  forwardDays: number;
  total_symbols: number;
  tested: number;
  passed: number;
  rows: PitBacktestResultRow[];
};

export default function ScreenerPitBacktestPage() {
  const [universes, setUniverses] = useState<Array<{ key: string; name: string; symbolCount: number }>>([]);
  const [presets, setPresets] = useState<ScreenerPreset[]>([]);

  const [universe, setUniverse] = useState('nifty50');
  const [preset, setPreset] = useState('quality');
  const [symbolsText, setSymbolsText] = useState('');

  const [asOfDaysAgo, setAsOfDaysAgo] = useState(180);
  const [forwardDays, setForwardDays] = useState(60);
  const [maxScan, setMaxScan] = useState(200);
  const [refresh, setRefresh] = useState(false);

  const [result, setResult] = useState<PitBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ universes: Array<{ key: string; name: string; symbolCount: number }> }>('/api/v1/universes').then((r) => setUniverses(r.universes)).catch(() => {});
    api<{ presets: ScreenerPreset[] }>('/api/v1/screener/presets').then((r) => setPresets(r.presets)).catch(() => {});
  }, []);

  const symbols = useMemo(() => {
    const parts = symbolsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase());
    return parts.length ? parts : undefined;
  }, [symbolsText]);

  async function runPitBacktest() {
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const payload = {
        universe: symbols ? undefined : universe,
        symbols,
        preset,
        asOfDaysAgo,
        forwardDays,
        refresh,
        maxScan,
      };
      const res = await api<PitBacktestResult>('/api/v1/screener/pit-backtest', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIT backtest failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Screener PIT backtest (TA-only)"
        subtitle="Replays screener TA gates on historical daily bars using an as-of bar offset"
        actions={<Link to="/screener" className="btn btn-secondary">Back to Screener</Link>}
      />

      <p className="disclaimer">
        MVP limitation: daily-only TA gates. If your filter set requires hourly/crossover metrics, results may be rejected.
      </p>

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Universe</label>
            <select value={universe} onChange={(e) => setUniverse(e.target.value)} style={{ width: '100%' }} disabled={Boolean(symbols)}>
              {universes.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name} ({u.symbolCount})
                </option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {symbols ? 'Symbols input provided; universe ignored.' : 'Used when symbols field is empty.'}
            </div>
          </div>
          <div className="form-group">
            <label>Preset (TA gates)</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: '100%' }}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Symbols (optional, comma-separated)</label>
            <input
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="TCS, INFY"
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group">
            <label>Max scan (cap)</label>
            <input
              type="number"
              min={1}
              max={2000}
              value={maxScan}
              onChange={(e) => setMaxScan(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>asOfDaysAgo (bar offset)</label>
            <input
              type="number"
              min={10}
              max={600}
              value={asOfDaysAgo}
              onChange={(e) => setAsOfDaysAgo(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group">
            <label>forwardDays (daily bars)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={forwardDays}
              onChange={(e) => setForwardDays(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <label className="checkbox-inline" style={{ display: 'block', marginTop: 10 }}>
          <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
          Refresh data
        </label>

        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

        <button className="btn" type="button" onClick={() => void runPitBacktest()} disabled={loading}>
          {loading ? 'Running…' : 'Run PIT backtest'}
        </button>
      </div>

      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0 }}>PIT report</h2>
          <p className="muted">
            {result.universe ? result.universe : 'symbols'} · tested {result.tested} · passed {result.passed} · asOf {result.asOfDaysAgo}d · fwd {result.forwardDays}d
          </p>

          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Price @ as-of</th>
                  <th>Forward return</th>
                  <th>Passed</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 30).map((r) => (
                  <tr key={r.symbol}>
                    <td>
                      <strong>{r.symbol}</strong>
                    </td>
                    <td>{r.price_as_of != null ? r.price_as_of.toFixed(2) : '—'}</td>
                    <td>{r.forward_return_pct != null ? `${r.forward_return_pct.toFixed(2)}%` : '—'}</td>
                    <td>{r.passed ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.rows.length > 30 && <p className="muted">Showing first 30 rows.</p>}
        </div>
      )}
    </Page>
  );
}


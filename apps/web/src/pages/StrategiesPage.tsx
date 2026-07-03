import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { ResearchRowActions } from '../components/ResearchRowActions';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface StrategyDef {
  key: string;
  label: string;
  description: string;
  style: string;
  engine: string;
  horizon: string;
  universe_default: string;
  max_scan_default: number;
  icon: string;
  ready: boolean;
  blocked_reason?: string;
}

interface SwingHit {
  symbol: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  entry_score: number;
  rules_passed: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  swing_rank?: number;
}

interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  mos: number | null;
  zone: string;
  recommendation: string;
  composite_score: number;
  ta_ready?: boolean;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_bottom_out_hint?: boolean | null;
}

type StrategyResult =
  | { engine: 'swing'; scanned: number; hits: SwingHit[]; skipped: number; label: string; universe: string }
  | {
      engine: 'screener';
      scanned: number;
      passed: number;
      rows: ScreenerRow[];
      label: string;
      universe: string;
      cache_hits?: number;
      restricted_skipped?: number;
    }
  | {
      engine: 'hybrid';
      screener_passed: number;
      scanned: number;
      hits: SwingHit[];
      skipped: number;
      label: string;
      universe: string;
    };

const STYLE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'swing', label: 'Swing' },
  { key: 'positional', label: 'Positional' },
  { key: 'hybrid', label: 'Hybrid' },
] as const;

function verdictClass(v: string): string {
  const u = v.toUpperCase();
  if (u === 'ENTER') return 'badge badge-buy';
  if (u.includes('SETUP')) return 'badge badge-hold';
  return 'badge badge-expensive';
}

function zoneClass(zone: string): string {
  if (zone.includes('Buy')) return 'badge badge-buy';
  if (zone === 'Hold' || zone === 'Accumulate') return 'badge badge-hold';
  return 'badge badge-expensive';
}

export default function StrategiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [styleTab, setStyleTab] = useState(searchParams.get('style') ?? 'all');
  const [strategies, setStrategies] = useState<StrategyDef[]>([]);
  const [styleLabels, setStyleLabels] = useState<Record<string, string>>({});
  const [readyCount, setReadyCount] = useState(0);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [selected, setSelected] = useState(searchParams.get('strategy') ?? 'swing_strict_enter');
  const [universe, setUniverse] = useState('');
  const [maxScan, setMaxScan] = useState(0);
  const [background, setBackground] = useState(false);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; passed: number; phase?: string } | null>(
    null,
  );

  const active = useMemo(() => strategies.find((s) => s.key === selected), [strategies, selected]);

  const loadStrategies = useCallback((style: string) => {
    const qs = style && style !== 'all' ? `?style=${encodeURIComponent(style)}` : '';
    return api<{
      strategies: StrategyDef[];
      style_labels: Record<string, string>;
      ready_count: number;
    }>(`/api/v1/strategies${qs}`).then((r) => {
      setStrategies(r.strategies);
      setStyleLabels(r.style_labels);
      setReadyCount(r.ready_count);
    });
  }, []);

  useEffect(() => {
    void loadStrategies(styleTab);
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => setUniverses(r.universes))
      .catch(() => {});
  }, [styleTab, loadStrategies]);

  useEffect(() => {
    if (!active) return;
    setUniverse(active.universe_default);
    setMaxScan(active.max_scan_default);
  }, [active?.key]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (styleTab !== 'all') params.set('style', styleTab);
    if (selected) params.set('strategy', selected);
    setSearchParams(params, { replace: true });
  }, [styleTab, selected, setSearchParams]);

  useEffect(() => {
    if (!jobId) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/jobs/${jobId}`);
    ws.onmessage = (ev) => {
      const p = JSON.parse(ev.data);
      setProgress(p);
      if (p.phase === 'done') {
        void pollJob(jobId);
      }
    };
    const interval = setInterval(() => void pollJob(jobId), 2000);
    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [jobId]);

  async function pollJob(id: string) {
    try {
      const res = await api<{
        job: {
          status: string;
          result?: StrategyResult;
          error?: string;
          progress?: typeof progress;
        };
      }>(`/api/v1/strategies/jobs/${id}`);
      if (res.job.progress) setProgress(res.job.progress as typeof progress);
      if (res.job.status === 'done' && res.job.result) {
        setResult(res.job.result);
        setLoading(false);
      }
      if (res.job.status === 'failed') {
        setError(res.job.error ?? 'Strategy job failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Poll failed');
      setLoading(false);
    }
  }

  async function onRun(e: FormEvent) {
    e.preventDefault();
    if (!active?.ready) return;
    setError('');
    setActionMsg('');
    setLoading(true);
    setResult(null);
    setJobId(null);
    setProgress(null);
    try {
      const res = await api<StrategyResult | { jobId: string; background: boolean; status: string }>(
        '/api/v1/strategies/run',
        {
          method: 'POST',
          body: JSON.stringify({
            strategy: selected,
            universe: universe || undefined,
            maxScan: maxScan > 0 ? maxScan : undefined,
            background: background || undefined,
          }),
        },
      );
      if ('jobId' in res && res.background) {
        setJobId(res.jobId);
        await pollJob(res.jobId);
      } else {
        setResult(res as StrategyResult);
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Strategy run failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Trading Strategies"
        subtitle={`${readyCount} ready · 21 curated swing, positional & hybrid filters`}
        actions={
          <Link to="/presets" className="btn btn-secondary">
            Daily presets
          </Link>
        }
      />
      <p className="disclaimer">
        Routes to swing scanner or CFA screener engines — verify on NSE before orders.
      </p>

      <div className="card segmented strategies-tabs">
        {STYLE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={styleTab === tab.key ? 'btn' : 'btn btn-secondary'}
            onClick={() => setStyleTab(tab.key)}
          >
            {styleLabels[tab.key] ?? tab.label}
          </button>
        ))}
      </div>

      <div className="strategies-layout">
        <aside className="card strategies-list">
          <h2 style={{ marginTop: 0 }}>Strategies</h2>
          <ul className="strategies-picker">
            {strategies.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`strategy-pick ${selected === s.key ? 'active' : ''} ${s.ready ? '' : 'disabled'}`}
                  onClick={() => setSelected(s.key)}
                >
                  <span className="strategy-icon">{s.icon}</span>
                  <span>
                    <strong>{s.label}</strong>
                    <span className="muted block">{s.horizon}</span>
                    {!s.ready ? (
                      <span className="strategy-blocked muted">Not ready</span>
                    ) : (
                      <span className="strategy-engine muted">{s.engine}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="strategies-main">
          {active && (
            <form className="card" onSubmit={onRun}>
              <h2 style={{ marginTop: 0 }}>
                {active.icon} {active.label}
              </h2>
              <p className="muted">{active.description}</p>
              {!active.ready && active.blocked_reason ? (
                <p className="error">{active.blocked_reason}</p>
              ) : null}

              <div className="form-row">
                <div className="form-group">
                  <label>Universe</label>
                  <select value={universe} onChange={(e) => setUniverse(e.target.value)} style={{ width: '100%' }}>
                    {universes.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.name} ({u.symbolCount})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Max scan (0 = strategy default)</label>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={maxScan}
                    onChange={(e) => setMaxScan(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                />
                Run in background (auto for large universes)
              </label>

              {progress && loading ? (
                <p className="muted">
                  {progress.phase ?? 'running'} — {progress.processed}/{progress.total}
                  {progress.passed ? ` · ${progress.passed} passed` : ''}
                </p>
              ) : null}

              <button type="submit" className="btn" disabled={loading || !active.ready}>
                {loading ? 'Running…' : 'Run strategy'}
              </button>
            </form>
          )}

          {error && <p className="error">{error}</p>}
          {actionMsg && <p className="flash success">{actionMsg}</p>}

          {result?.engine === 'swing' && (
            <div className="card">
              <h2>Swing hits ({result.hits.length})</h2>
              <p className="muted">
                {result.label} · {result.universe} · scanned {result.scanned}
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Price</th>
                      <th>Verdict</th>
                      <th>Strict</th>
                      <th>Score</th>
                      <th>R</th>
                      <th>Stop</th>
                      <th>Target</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((h) => (
                      <tr key={h.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(h.symbol)}`}>
                            <strong>{h.symbol}</strong>
                          </Link>
                        </td>
                        <td>{h.price}</td>
                        <td>
                          <span className={verdictClass(h.verdict)}>{h.verdict}</span>
                        </td>
                        <td>{h.strict_verdict}</td>
                        <td>{h.entry_score}</td>
                        <td>{h.r_multiple ?? '—'}</td>
                        <td>{h.stop_loss ?? '—'}</td>
                        <td>{h.profit_target ?? '—'}</td>
                        <td>
                          <ResearchRowActions
                            symbol={h.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            swing={{
                              symbol: h.symbol,
                              price: h.price,
                              stop_loss: h.stop_loss,
                              profit_target: h.profit_target,
                            }}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.engine === 'screener' && (
            <div className="card">
              <h2>Screener passes ({result.rows.length})</h2>
              <p className="muted">
                {result.label} · {result.universe} · scanned {result.scanned}
                {result.cache_hits ? ` · ${result.cache_hits} cache hits` : ''}
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>P/E</th>
                      <th>ROE</th>
                      <th>MOS</th>
                      <th>Score</th>
                      <th>Zone</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(r.symbol)}`}>
                            <strong>{r.symbol}</strong>
                          </Link>
                        </td>
                        <td>{r.pe}</td>
                        <td>{r.roe}%</td>
                        <td>{r.mos != null ? `${r.mos}%` : '—'}</td>
                        <td>{r.composite_score}</td>
                        <td>
                          <span className={zoneClass(r.zone)}>{r.zone}</span>
                        </td>
                        <td>
                          <ResearchRowActions
                            symbol={r.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.engine === 'hybrid' && (
            <div className="card">
              <h2>Hybrid — swing hits ({result.hits.length})</h2>
              <p className="muted">
                Stage 1: {result.screener_passed} passed CFA screen · Stage 2: {result.hits.length} swing hits
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Price</th>
                      <th>Verdict</th>
                      <th>Rank</th>
                      <th>R</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((h) => (
                      <tr key={h.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(h.symbol)}`}>
                            <strong>{h.symbol}</strong>
                          </Link>
                        </td>
                        <td>{h.price}</td>
                        <td>
                          <span className={verdictClass(h.verdict)}>{h.verdict}</span>
                        </td>
                        <td>{h.swing_rank ?? '—'}</td>
                        <td>{h.r_multiple ?? '—'}</td>
                        <td>
                          <ResearchRowActions
                            symbol={h.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            swing={{
                              symbol: h.symbol,
                              price: h.price,
                              stop_loss: h.stop_loss,
                              profit_target: h.profit_target,
                            }}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

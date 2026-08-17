import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { fmtMoney } from '../components/swing/format';
import { formatRewardRisk, patternRewardRisk } from '../lib/pattern-feed-utils';

interface PatternRow {
  pattern_key: string;
  pattern: string;
  kind: string;
  type: string;
  status: string;
  confidence: number;
  timeframe: string;
  start_date: string;
  end_date: string;
  last_bar_date: string;
  support: number | null;
  resistance: number | null;
  breakout: number | null;
  target: number | null;
  stop_loss: number | null;
  volume_confirmed: boolean;
  rsi_confirmed: boolean;
  macd_confirmed: boolean;
  detail: string;
  symbol: string;
}

interface FeedResponse {
  scan_date: string | null;
  count: number;
  patterns: PatternRow[];
}

interface BacktestKindStat {
  kind: string;
  label: string;
  timeframe: string;
  symbol_samples: number;
  occurrences: number;
  confirmed_breakouts: number;
  target_hits: number;
  stop_hits: number;
  unresolved: number;
  success_rate_pct: number | null;
  avg_return_pct: number | null;
  avg_mfe_pct: number | null;
  avg_mae_pct: number | null;
}

interface BacktestSummaryResponse {
  scan_date: string | null;
  symbol_count: number;
  kinds: BacktestKindStat[];
}

interface ScanRun {
  run_date: string;
  trigger: string;
  symbols_total: number;
  symbols_ok: number;
  symbols_failed: number;
  patterns_found: number;
  duration_ms: number;
  status: string;
  error: string | null;
  created_at: string;
}

const STATUS_CHIPS = [
  { value: 'forming', label: 'Forming' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'confirmed', label: 'Confirmed' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'forming', label: 'Forming' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All biases' },
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'neutral', label: 'Neutral' },
];

const KIND_OPTIONS = [
  { value: '', label: 'All kinds' },
  { value: 'double_bottom', label: 'Double bottom' },
  { value: 'double_top', label: 'Double top' },
  { value: 'head_and_shoulders', label: 'Head & shoulders' },
  { value: 'inverse_head_and_shoulders', label: 'Inverse H&S' },
  { value: 'ascending_triangle', label: 'Ascending triangle' },
  { value: 'descending_triangle', label: 'Descending triangle' },
  { value: 'symmetrical_triangle', label: 'Symmetrical triangle' },
  { value: 'rising_wedge', label: 'Rising wedge' },
  { value: 'falling_wedge', label: 'Falling wedge' },
  { value: 'bull_flag', label: 'Bull flag' },
  { value: 'bear_flag', label: 'Bear flag' },
  { value: 'bull_pennant', label: 'Bull pennant' },
  { value: 'bear_pennant', label: 'Bear pennant' },
  { value: 'cup_and_handle', label: 'Cup & handle' },
  { value: 'rounding_bottom', label: 'Rounding bottom' },
  { value: 'rounding_top', label: 'Rounding top' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'price_channel', label: 'Price channel' },
];

function biasClass(type: string): string {
  if (type === 'bullish') return 'badge badge-buy';
  if (type === 'bearish') return 'badge badge-sell';
  return 'badge badge-muted';
}

function statusClass(status: string): string {
  return `pattern-status pattern-status-${status}`;
}

function buildQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ['kind', 'status', 'type', 'symbol', 'min_confidence', 'limit', 'scan_date']) {
    const v = params.get(key);
    if (v) q.set(key, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export default function ChartPatternsFeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [scanDates, setScanDates] = useState<string[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<BacktestSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const kind = searchParams.get('kind') ?? '';
  const status = searchParams.get('status') ?? '';
  const type = searchParams.get('type') ?? '';
  const symbol = searchParams.get('symbol') ?? '';
  const scanDate = searchParams.get('scan_date') ?? '';
  const minConfidence = searchParams.get('min_confidence') ?? '';
  const limit = searchParams.get('limit') ?? '100';

  const queryPath = useMemo(() => `/api/v1/chart-patterns/feed${buildQuery(searchParams)}`, [searchParams]);
  const backtestQuery = useMemo(() => {
    const q = scanDate ? `?scan_date=${encodeURIComponent(scanDate)}` : '';
    return `/api/v1/chart-patterns/backtest-summary${q}`;
  }, [scanDate]);
  const latestRun = scanRuns[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [feed, datesRes, runsRes, backtestRes] = await Promise.all([
        api<FeedResponse>(queryPath),
        api<{ dates: string[] }>('/api/v1/chart-patterns/scan-dates'),
        api<{ runs: ScanRun[] }>('/api/v1/chart-patterns/scan-runs?limit=5'),
        api<BacktestSummaryResponse>(backtestQuery),
      ]);
      setData(feed);
      setScanDates(datesRes.dates);
      setScanRuns(runsRes.runs);
      setBacktestSummary(backtestRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pattern feed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryPath, backtestQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    if (scanDate) next.set('scan_date', scanDate);
    setSearchParams(next, { replace: true });
  };

  const toggleKindFilter = (nextKind: string) => {
    setFilter('kind', kind === nextKind ? '' : nextKind);
  };

  const sortedPatterns = useMemo(() => {
    const rows = data?.patterns ?? [];
    return [...rows].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }, [data?.patterns]);

  const filtersActive = Boolean(kind || status || type || symbol || minConfidence);

  if (loading && !data) return <PageLoading label="Loading chart patterns…" />;

  return (
    <Page>
      <PageHeader
        title="Chart pattern feed"
        subtitle={
          data?.scan_date
            ? `Scan ${data.scan_date} · ${data.count} pattern${data.count === 1 ? '' : 's'} shown`
            : 'Cross-symbol pattern detections from daily scan'
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {latestRun && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p className="muted" style={{ margin: 0 }}>
            Last batch: <strong>{latestRun.run_date}</strong> · {latestRun.trigger} · {latestRun.symbols_ok}/
            {latestRun.symbols_total} symbols · {latestRun.patterns_found} patterns ·{' '}
            {formatDuration(latestRun.duration_ms)} · {latestRun.status}
            {latestRun.error ? ` · ${latestRun.error}` : ''}
          </p>
        </div>
      )}

      <div className="card filter-bar" style={{ marginBottom: '1rem' }}>
        <div className="filter-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
          <label>
            Scan date
            <select value={scanDate} onChange={(e) => setFilter('scan_date', e.target.value)}>
              <option value="">Latest</option>
              {scanDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Symbol
            <input
              type="text"
              placeholder="e.g. TCS"
              value={symbol}
              onChange={(e) => setFilter('symbol', e.target.value.trim().toUpperCase())}
              style={{ width: '6rem' }}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bias
            <select value={type} onChange={(e) => setFilter('type', e.target.value)}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setFilter('kind', e.target.value)}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Min confidence
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              placeholder="e.g. 60"
              value={minConfidence}
              onChange={(e) => setFilter('min_confidence', e.target.value)}
              style={{ width: '5rem' }}
            />
          </label>
          <label>
            Limit
            <select value={limit} onChange={(e) => setFilter('limit', e.target.value)}>
              {[50, 100, 150, 200].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters} disabled={!filtersActive}>
            Clear filters
          </button>
        </div>
        <div className="pattern-status-chips" style={{ marginTop: '0.65rem' }}>
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`btn btn-secondary btn-sm${status === chip.value ? ' is-active' : ''}`}
              onClick={() => setFilter('status', status === chip.value ? '' : chip.value)}
            >
              {chip.label}
            </button>
          ))}
          <span className="muted" style={{ fontSize: '0.82rem', marginLeft: '0.35rem' }}>
            Tip: click an accuracy card below to filter by pattern kind
          </span>
        </div>
      </div>

      {backtestSummary && backtestSummary.kinds.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="pattern-backtest">
            <h3 className="admin-subhead">Pattern accuracy summary</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Walk-forward stats aggregated across {backtestSummary.symbol_count} symbol
              {backtestSummary.symbol_count === 1 ? '' : 's'}
              {backtestSummary.scan_date ? ` · scan ${backtestSummary.scan_date}` : ''}. No look-ahead.
            </p>
            <div className="pattern-backtest-grid">
              {backtestSummary.kinds.map((bt) => (
                <article
                  key={bt.kind}
                  className={`pattern-backtest-card${kind === bt.kind ? ' is-active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleKindFilter(bt.kind)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleKindFilter(bt.kind);
                    }
                  }}
                  title={kind === bt.kind ? 'Clear kind filter' : `Filter feed to ${bt.label}`}
                >
                  <div className="pattern-backtest-head">
                    <strong>{bt.label}</strong>
                    <span className="muted">
                      {bt.timeframe} · {bt.symbol_samples} sym
                    </span>
                  </div>
                  <dl className="pattern-backtest-stats">
                    <div>
                      <dt>Detected</dt>
                      <dd>{bt.occurrences}</dd>
                    </div>
                    <div>
                      <dt>Breakouts</dt>
                      <dd>{bt.confirmed_breakouts}</dd>
                    </div>
                    <div>
                      <dt>Target hit</dt>
                      <dd>{bt.target_hits}</dd>
                    </div>
                    <div>
                      <dt>Stop hit</dt>
                      <dd>{bt.stop_hits}</dd>
                    </div>
                    <div>
                      <dt>Success rate</dt>
                      <dd>{bt.success_rate_pct != null ? `${bt.success_rate_pct}%` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Avg return</dt>
                      <dd>
                        {bt.avg_return_pct != null
                          ? `${bt.avg_return_pct > 0 ? '+' : ''}${bt.avg_return_pct}%`
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {!error && data && data.patterns.length === 0 && (
        <EmptyState>
          No patterns match these filters
          {data.scan_date ? ` for scan ${data.scan_date}` : ''}. Try loosening filters or run a chart pattern scan from
          Admin.
        </EmptyState>
      )}

      {data && sortedPatterns.length > 0 && (
        <div className="card table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Pattern</th>
                <th>Status</th>
                <th>Bias</th>
                <th>Conf.</th>
                <th>TF</th>
                <th>Breakout</th>
                <th>Target</th>
                <th>Stop</th>
                <th title="Reward / risk from breakout">R:R</th>
                <th>Confirm</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPatterns.map((p) => {
                const rr = patternRewardRisk(p.breakout, p.target, p.stop_loss);
                return (
                <tr key={`${p.symbol}-${p.pattern_key}`}>
                  <td>
                    <Link to={`/stock/${encodeURIComponent(p.symbol)}`}>{p.symbol}</Link>
                  </td>
                  <td>
                    <div>{p.pattern}</div>
                    <div className="muted" style={{ fontSize: '0.85em' }}>
                      {p.start_date} → {p.end_date}
                    </div>
                    {p.detail ? (
                      <div className="muted" style={{ fontSize: '0.85em', marginTop: '0.15rem' }}>
                        {p.detail}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusClass(p.status)}>{p.status}</span>
                  </td>
                  <td>
                    <span className={biasClass(p.type)}>{p.type}</span>
                  </td>
                  <td>{p.confidence}%</td>
                  <td>{p.timeframe}</td>
                  <td>{p.breakout != null ? fmtMoney(p.breakout) : '—'}</td>
                  <td>{p.target != null ? fmtMoney(p.target) : '—'}</td>
                  <td>{p.stop_loss != null ? fmtMoney(p.stop_loss) : '—'}</td>
                  <td className={rr != null && rr >= 2 ? 'pos' : undefined}>{formatRewardRisk(rr)}</td>
                  <td className="muted" style={{ fontSize: '0.85em' }}>
                    {[p.volume_confirmed && 'Vol', p.rsi_confirmed && 'RSI', p.macd_confirmed && 'MACD']
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="pattern-row-actions">
                    <Link
                      to={`/verify?symbol=${encodeURIComponent(p.symbol)}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Verify
                    </Link>
                    <Link
                      to={`/stock/${encodeURIComponent(p.symbol)}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Chart
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

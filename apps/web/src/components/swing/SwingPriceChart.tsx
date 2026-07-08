import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { StockDailyChart, type ChartPayload } from '../StockDailyChart';

const TIMEFRAMES = [
  { id: '6mo', label: '6M daily' },
  { id: '1y', label: '1Y daily' },
  { id: '2y', label: '2Y daily' },
  { id: '5y', label: '5Y daily' },
  { id: '1h', label: '1H (60d)' },
] as const;

type TimeframeId = (typeof TIMEFRAMES)[number]['id'];

interface SwingChartResponse {
  ok: boolean;
  symbol: string;
  timeframe: string;
  interval: string;
  range: string;
  bar_count: number;
  fetched_at?: string;
  chart: ChartPayload | null;
  error?: string;
}

interface Props {
  symbol: string;
  defaultTimeframe?: TimeframeId;
  title?: string;
  asOfDate?: string | null;
}

export function SwingPriceChart({ symbol, defaultTimeframe = '1h', title, asOfDate }: Props) {
  const sym = symbol.trim().toUpperCase();
  const [activeTf, setActiveTf] = useState<TimeframeId>(defaultTimeframe);
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [meta, setMeta] = useState<{ interval: string; range: string; bar_count: number; fetched_at?: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadChart = useCallback(
    async (tf: TimeframeId, forceRefresh = false) => {
      if (!sym || sym.length < 2) return;
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({ tf });
        if (forceRefresh) q.set('refresh', '1');
        const res = await api<SwingChartResponse>(
          `/api/v1/swing/chart/${encodeURIComponent(sym)}?${q.toString()}`,
        );
        if (!res.ok || !res.chart) {
          setChart(null);
          setMeta(null);
          setError(res.error ?? 'Chart unavailable');
          return;
        }
        setChart(res.chart);
        setMeta({
          interval: res.interval,
          range: res.range,
          bar_count: res.bar_count,
          fetched_at: res.fetched_at,
        });
      } catch (err) {
        setChart(null);
        setMeta(null);
        setError(err instanceof Error ? err.message : 'Chart load failed');
      } finally {
        setLoading(false);
      }
    },
    [sym],
  );

  useEffect(() => {
    setActiveTf(defaultTimeframe);
  }, [sym, defaultTimeframe]);

  useEffect(() => {
    void loadChart(activeTf);
  }, [activeTf, loadChart]);

  if (!sym) return null;

  const heading = title ?? `Price chart — ${sym}`;

  return (
    <section className={`card swing-chart-card${loading && chart ? ' is-loading' : ''}`}>
      <h2 style={{ marginTop: 0 }}>{heading}</h2>
      {meta && (
        <p className="swing-chart-meta">
          {meta.interval} · {meta.range} · {meta.bar_count} bars
          {asOfDate ? ` · entry rules EOD ${asOfDate}` : ''}
          {meta.fetched_at ? ` · cached ${new Date(meta.fetched_at).toLocaleString()}` : ''}
        </p>
      )}
      <div className="swing-tf-tabs" role="tablist" aria-label="Chart timeframe">
        {TIMEFRAMES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTf === tab.id}
            className={activeTf === tab.id ? 'active' : undefined}
            disabled={loading && activeTf === tab.id}
            onClick={() => setActiveTf(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-xs swing-chart-refresh"
          disabled={loading}
          onClick={() => void loadChart(activeTf, true)}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {loading && !chart ? <div className="swing-chart-skeleton" aria-busy="true" /> : null}
      {error && !chart ? (
        <div className="swing-chart-error">
          <p className="error">{error}</p>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => void loadChart(activeTf, true)}>
            Retry with refresh
          </button>
        </div>
      ) : null}
      <div className="swing-chart-body">
        {loading && chart ? <div className="swing-chart-overlay" aria-hidden /> : null}
        <StockDailyChart chart={chart} />
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { StockDailyChart, type ChartPayload } from '../StockDailyChart';

type Interval = '5m' | '15m';

interface IntradayChartResponse {
  ok: boolean;
  instrument: string;
  instrument_label?: string;
  interval: Interval;
  range?: string;
  bar_count?: number;
  fetched_at?: string;
  chart: ChartPayload | null;
  error?: string;
}

interface Props {
  instrumentId: string;
  interval: Interval;
  label?: string;
}

export function IntradayPriceChart({ instrumentId, interval, label }: Props) {
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [meta, setMeta] = useState<{ range?: string; bar_count?: number; fetched_at?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadChart = useCallback(
    async (forceRefresh = false) => {
      if (!instrumentId) return;
      setLoading(true);
      setError('');
      try {
        const q = new URLSearchParams({ interval });
        if (forceRefresh) q.set('refresh', '1');
        const res = await api<IntradayChartResponse>(
          `/api/v1/intraday/chart/${encodeURIComponent(instrumentId)}?${q.toString()}`,
        );
        if (!res.ok || !res.chart) {
          setChart(null);
          setMeta(null);
          setError(res.error ?? 'Chart unavailable');
          return;
        }
        setChart(res.chart);
        setMeta({ range: res.range, bar_count: res.bar_count, fetched_at: res.fetched_at });
      } catch (err) {
        setChart(null);
        setMeta(null);
        setError(err instanceof Error ? err.message : 'Chart load failed');
      } finally {
        setLoading(false);
      }
    },
    [instrumentId, interval],
  );

  useEffect(() => {
    void loadChart();
  }, [loadChart]);

  const heading = `Price chart — ${label ?? instrumentId} · ${interval}`;

  return (
    <section className={`card swing-chart-card${loading && chart ? ' is-loading' : ''}`}>
      <div className="intraday-chart-head">
        <h2 style={{ margin: 0 }}>{heading}</h2>
        <button
          type="button"
          className="btn btn-secondary btn-xs"
          disabled={loading}
          onClick={() => void loadChart(true)}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {meta && (
        <p className="swing-chart-meta">
          {interval} · {meta.range ?? '5d'} · {meta.bar_count ?? 0} bars
          {meta.fetched_at ? ` · updated ${new Date(meta.fetched_at).toLocaleTimeString()}` : ''}
        </p>
      )}
      {loading && !chart ? <div className="swing-chart-skeleton" aria-busy="true" /> : null}
      {error && !chart ? (
        <div className="swing-chart-error">
          <p className="error">{error}</p>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => void loadChart(true)}>
            Retry with refresh
          </button>
        </div>
      ) : null}
      {chart ? (
        <div className="swing-chart-body">
          {loading && chart ? <div className="swing-chart-overlay" aria-hidden /> : null}
          <StockDailyChart chart={chart} height={360} />
        </div>
      ) : null}
    </section>
  );
}

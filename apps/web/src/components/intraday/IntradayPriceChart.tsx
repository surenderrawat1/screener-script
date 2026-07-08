import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { StockDailyChart, type ChartPayload, type ChartPriceLevel } from '../StockDailyChart';

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
  plan?: Record<string, unknown> | null;
}

export function IntradayPriceChart({ instrumentId, interval, label, plan }: Props) {
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
  const priceLevels = useMemo(() => intradayPlanPriceLevels(plan), [plan]);

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
          <StockDailyChart chart={chart} height={360} priceLevels={priceLevels} />
        </div>
      ) : null}
    </section>
  );
}

function intradayPlanPriceLevels(plan: Record<string, unknown> | null | undefined): ChartPriceLevel[] {
  if (!plan?.ok) return [];
  const entry = (plan.entry as Record<string, unknown> | undefined)?.price;
  const stop = (plan.stop_loss as Record<string, unknown> | undefined)?.price;
  const exits = (plan.exits as Array<Record<string, unknown>> | undefined) ?? [];
  const levels: ChartPriceLevel[] = [];
  if (typeof entry === 'number' && Number.isFinite(entry)) {
    levels.push({ price: entry, title: 'Entry', color: '#60a5fa', lineStyle: 'solid' });
  }
  if (typeof stop === 'number' && Number.isFinite(stop)) {
    levels.push({ price: stop, title: 'Stop', color: '#ef4444', lineStyle: 'dashed' });
  }
  for (const ex of exits) {
    const price = ex.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    levels.push({
      price,
      title: String(ex.tier ?? 'Target'),
      color: '#22c55e',
      lineStyle: 'dotted',
    });
  }
  return levels;
}

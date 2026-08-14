import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { StockDailyChart, type ChartPayload, type ChartPriceLevel } from '../StockDailyChart';
import type { SwingEntryPayload } from './types';

const TIMEFRAME_GROUPS = [
  {
    label: 'Intraday',
    frames: [
      { id: '5m', label: '5m (5d)' },
      { id: '15m', label: '15m (5d)' },
      { id: '1h', label: '1H (60d)' },
      { id: '4h', label: '4H (60d)' },
    ],
  },
  {
    label: 'Daily',
    frames: [
      { id: '6mo', label: '6M' },
      { id: '1y', label: '1Y' },
      { id: '2y', label: '2Y' },
      { id: '5y', label: '5Y' },
    ],
  },
  {
    label: 'Weekly',
    frames: [{ id: '1w', label: '1W (5y)' }],
  },
] as const;

type TimeframeId = (typeof TIMEFRAME_GROUPS)[number]['frames'][number]['id'];

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
  entry?: SwingEntryPayload | null;
}

export function SwingPriceChart({ symbol, defaultTimeframe = '1h', title, asOfDate, entry }: Props) {
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
  const priceLevels = useMemo(() => swingEntryPriceLevels(entry), [entry]);

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
        {TIMEFRAME_GROUPS.map((group) => (
          <div key={group.label} className="swing-tf-group" role="presentation">
            <span className="swing-tf-group-label">{group.label}</span>
            {group.frames.map((tab) => (
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
          </div>
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
        <StockDailyChart chart={chart} priceLevels={priceLevels} />
      </div>
    </section>
  );
}

function swingEntryPriceLevels(entry: SwingEntryPayload | null | undefined): ChartPriceLevel[] {
  if (!entry) return [];
  const levels: ChartPriceLevel[] = [];
  if (typeof entry.entry_price === 'number' && Number.isFinite(entry.entry_price)) {
    levels.push({ price: entry.entry_price, title: 'Entry', color: '#60a5fa', lineStyle: 'solid' });
  }
  if (typeof entry.stop_loss === 'number' && Number.isFinite(entry.stop_loss)) {
    levels.push({ price: entry.stop_loss, title: 'Stop', color: '#ef4444', lineStyle: 'dashed' });
  }
  if (typeof entry.profit_target === 'number' && Number.isFinite(entry.profit_target)) {
    levels.push({ price: entry.profit_target, title: 'Target', color: '#22c55e', lineStyle: 'dotted' });
  }
  return levels;
}

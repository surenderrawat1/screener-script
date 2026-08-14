import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api';
import {
  LedgerDateRangeFilter,
  rangeForPreset,
  type LedgerDatePreset,
} from '../components/LedgerDateRangeFilter';
import { Page, PageHeader } from '../components/PageLayout';
import {
  IntradayClosedPanel,
  IntradayOpenPanel,
  type IntradayPositionRow,
} from '../components/intraday/IntradayPositionsPanels';
import { IntradayPaperWalletPanel } from '../components/intraday/IntradayPaperWalletPanel';
import {
  IntradayLogEntryForm,
  type InstrumentsResponse,
  type LogEntryPrefill,
} from '../components/intraday/IntradayLogEntryForm';

interface PositionsResponse {
  positions: IntradayPositionRow[];
  summary: { open: number; closed: number };
  live?: {
    refreshed_at?: string;
    portfolio?: {
      exit_count?: number;
      urgent_count?: number;
      net_pnl_inr?: number | null;
    };
  } | null;
  closed_stats?: {
    with_pnl?: number;
    wins?: number;
    losses?: number;
    win_rate_pct?: number | null;
    avg_r?: number | null;
    total_net_pnl?: number;
    best?: { instrument: string; net_pnl: number; r_multiple: number | null } | null;
    worst?: { instrument: string; net_pnl: number; r_multiple: number | null } | null;
  } | null;
}

const REFRESH_MS = 60_000;
const DEFAULT_RANGE = rangeForPreset('today');

const FALLBACK_INSTRUMENTS: InstrumentsResponse = {
  indices: [
    { id: 'nifty50', label: 'Nifty 50', kind: 'index' },
    { id: 'banknifty', label: 'Bank Nifty', kind: 'index' },
    { id: 'sensex', label: 'Sensex', kind: 'index' },
    { id: 'finnifty', label: 'Fin Nifty', kind: 'index' },
  ],
  stocks: [
    { id: 'tcs', label: 'TCS', kind: 'stock' },
    { id: 'reliance', label: 'Reliance', kind: 'stock' },
  ],
};

function buildPrefill(searchParams: URLSearchParams): LogEntryPrefill {
  const productRaw = searchParams.get('product');
  return {
    instrument_id: searchParams.get('instrument') ?? 'nifty50',
    product_type:
      productRaw === 'futures' || productRaw === 'options' ? productRaw : 'spot',
    side: searchParams.get('side') === 'short' ? 'short' : 'long',
    timeframe: searchParams.get('timeframe') === '5m' ? '5m' : '15m',
    entry_price: searchParams.get('entry') ?? '',
    stop_loss: searchParams.get('stop') ?? '',
    target_t1: searchParams.get('t1') ?? '',
    target_t2: searchParams.get('t2') ?? '',
    target_t3: searchParams.get('t3') ?? '',
    quantity: searchParams.get('qty') ?? searchParams.get('quantity') ?? '',
    notes: searchParams.get('notes') ?? '',
    source: searchParams.get('source') ?? undefined,
  };
}

export default function IntradayPositionsPage() {
  const [searchParams] = useSearchParams();
  const fromRadar = Boolean(
    searchParams.get('entry') || searchParams.get('stop') || searchParams.get('instrument'),
  );

  const [data, setData] = useState<PositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [datePreset, setDatePreset] = useState<LedgerDatePreset>('today');
  const [customFrom, setCustomFrom] = useState(DEFAULT_RANGE.from);
  const [customTo, setCustomTo] = useState(DEFAULT_RANGE.to);
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [instruments, setInstruments] = useState<InstrumentsResponse>(FALLBACK_INSTRUMENTS);
  const [prefill, setPrefill] = useState<LogEntryPrefill>(() => buildPrefill(searchParams));

  useEffect(() => {
    setPrefill(buildPrefill(searchParams));
  }, [searchParams]);

  useEffect(() => {
    api<InstrumentsResponse>('/api/v1/intraday/instruments')
      .then((res) => {
        const next = { indices: res.indices ?? [], stocks: res.stocks ?? [] };
        if (!next.indices.length && !next.stocks.length) return;
        setInstruments({ ...next, etfs: res.etfs ?? [] });
      })
      .catch(() => undefined);
  }, []);

  const dateRange = useMemo(
    () => rangeForPreset(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const load = useCallback(
    async (statusOverride?: 'all' | 'open' | 'closed') => {
      setError('');
      setLoading(true);
      try {
        const status = statusOverride ?? filter;
        const params = new URLSearchParams();
        if (status !== 'all') params.set('status', status);
        if (live) params.set('live', '1');
        params.set('date_from', dateRange.from);
        params.set('date_to', dateRange.to);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await api<PositionsResponse>(`/api/v1/intraday/positions${qs}`);
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    },
    [dateRange.from, dateRange.to, filter, live],
  );

  useEffect(() => {
    void load();
    if (!live) return;
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, live]);

  async function exportCsv() {
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('date_from', dateRange.from);
      params.set('date_to', dateRange.to);
      const token = getToken();
      const res = await fetch(`/api/v1/intraday/positions/export?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `intraday-closed-${dateRange.from}_${dateRange.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  const openPositions = (data?.positions ?? []).filter((p) => p.status === 'open');
  const closedPositions = (data?.positions ?? []).filter((p) => p.status === 'closed');

  return (
    <Page>
      <PageHeader
        title="Intraday Positions"
        subtitle="Same-day ledger — log entries, live exits, paper wallet"
        actions={
          <>
            <label className="morning-live-toggle">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              Live · 60s
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void exportCsv()}>
              Export CSV
            </button>
            <Link to="/intraday" className="btn btn-secondary">
              Intraday radar
            </Link>
          </>
        }
      />
      <p className="disclaimer">
        Research ledger only. Distinct from <Link to="/positions">swing positions</Link>. Confirm on NSE before
        orders.
      </p>

      <div className="card segmented">
        <span>Filter:</span>
        {(['open', 'closed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn' : 'btn btn-secondary'}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        {data && (
          <span className="segmented-meta">
            {data.summary.open} open · {data.summary.closed} closed
          </span>
        )}
      </div>

      <div className="card">
        <LedgerDateRangeFilter
          preset={datePreset}
          customFrom={customFrom}
          customTo={customTo}
          onPresetChange={setDatePreset}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <IntradayPaperWalletPanel />

      <IntradayLogEntryForm
        instruments={instruments}
        openPositions={openPositions}
        prefill={prefill}
        fromRadar={fromRadar}
        onCreated={async () => {
          setFilter('open');
          await load('open');
        }}
      />

      {(filter === 'open' || filter === 'all') && (
        <IntradayOpenPanel
          positions={openPositions}
          portfolio={data?.live?.portfolio}
          refreshedAt={data?.live?.refreshed_at}
          onRefresh={load}
          onClosed={async () => {
            setFilter('closed');
            await load('closed');
          }}
        />
      )}

      {(filter === 'closed' || filter === 'all') && (
        <IntradayClosedPanel
          positions={closedPositions}
          stats={data?.closed_stats}
          onRefresh={async () => {
            setFilter('open');
            await load('open');
          }}
        />
      )}
    </Page>
  );
}

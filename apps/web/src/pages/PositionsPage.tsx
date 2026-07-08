import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api';
import {
  LedgerDateRangeFilter,
  rangeForPreset,
  type LedgerDatePreset,
} from '../components/LedgerDateRangeFilter';
import { NseSessionBanner, type NseSessionInfo } from '../components/NseSessionBanner';
import { Page, PageHeader } from '../components/PageLayout';
import { fetchSymbolPrice } from '../components/swing/fetchSymbolPrice';
import { OpenPositionsPanel, type PositionsBlock } from '../components/swing/OpenPositionsPanel';
import { SwingClosedPanel, type ClosedSwingRow } from '../components/swing/SwingClosedPanel';
import { useRefreshCountdown } from '../hooks/useRefreshCountdown';
interface PositionsResponse {
  positions: Array<ClosedSwingRow & { status: string }>;
  summary: { open: number; closed: number };
  live?: {
    refreshed_at?: string;
    portfolio?: PositionsBlock['portfolio'];
    exit_count?: number;
    urgent_count?: number;
    heat_pct?: number;
  } | null;
  session?: NseSessionInfo;
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

export default function PositionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<PositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [datePreset, setDatePreset] = useState<LedgerDatePreset>('today');
  const [customFrom, setCustomFrom] = useState(DEFAULT_RANGE.from);
  const [customTo, setCustomTo] = useState(DEFAULT_RANGE.to);
  const [live, setLive] = useState(searchParams.get('live') !== '0');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchPriceBusy, setFetchPriceBusy] = useState(false);
  const [form, setForm] = useState({    symbol: '',
    entry_price: '',
    entry_date: new Date().toISOString().slice(0, 10),
    shares: '',
    stop_loss: '',
    profit_target: '',
    notes: '',
  });

  const dateRange = useMemo(() => rangeForPreset(datePreset, customFrom, customTo), [datePreset, customFrom, customTo]);

  const load = useCallback(async (statusOverride?: 'all' | 'open' | 'closed') => {
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
      const res = await api<PositionsResponse>(`/api/v1/swing/positions${qs}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, filter, live]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (live) params.set('live', '1');
        else params.set('live', '0');
        return params;
      },
      { replace: true },
    );
  }, [live, setSearchParams]);

  useEffect(() => {
    void load();
    if (!live) return;
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, live]);

  const openPositions = (data?.positions ?? []).filter((p) => p.status === 'open');
  const closedPositions = (data?.positions ?? []).filter((p) => p.status === 'closed');
  const countdownSec = useRefreshCountdown(data?.live?.refreshed_at, REFRESH_MS, live);
  const updatedAt = data?.live?.refreshed_at
    ? new Date(data.live.refreshed_at).toLocaleTimeString()
    : null;

  const openBlock: PositionsBlock = {    open: openPositions,
    count: openPositions.length,
    exit_count: data?.live?.exit_count,
    urgent_count: data?.live?.urgent_count,
    refreshed_at: data?.live?.refreshed_at,
    summary: {
      open: data?.summary.open ?? openPositions.length,
      exit_signals: data?.live?.exit_count ?? 0,
    },
    portfolio: data?.live?.portfolio,
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/v1/swing/positions', {
        method: 'POST',
        body: JSON.stringify({
          symbol: form.symbol.trim().toUpperCase(),
          entry_price: Number(form.entry_price),
          entry_date: form.entry_date,
          shares: form.shares ? Number(form.shares) : undefined,
          stop_loss: form.stop_loss ? Number(form.stop_loss) : undefined,
          profit_target: form.profit_target ? Number(form.profit_target) : undefined,
          notes: form.notes || undefined,
          source: 'manual',
        }),
      });
      setForm({
        symbol: '',
        entry_price: '',
        entry_date: new Date().toISOString().slice(0, 10),
        shares: '',
        stop_loss: '',
        profit_target: '',
        notes: '',
      });
      setFilter('open');
      await load('open');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  async function exportCsv() {
    setError('');
    try {
      const token = getToken();
      const res = await fetch('/api/v1/swing/positions/export', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'swing-positions.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  async function fetchAddPrice() {
    if (!form.symbol.trim()) {
      setError('Enter a symbol first');
      return;
    }
    setFetchPriceBusy(true);
    setError('');
    try {
      const price = await fetchSymbolPrice(form.symbol);
      if (price == null) {
        setError(`Could not fetch price for ${form.symbol.trim().toUpperCase()}`);
        return;
      }
      setForm((f) => ({ ...f, entry_price: String(price) }));
    } finally {
      setFetchPriceBusy(false);
    }
  }

  return (    <Page>
      <PageHeader
        title="Swing Positions"
        subtitle="Multi-day swing ledger — live exit rules, stops, trail & targets"
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
            <Link to="/swing/auto" className="btn btn-secondary">
              Auto Radar
            </Link>
          </>
        }
      />
      <p className="disclaimer">
        Distinct from <Link to="/intraday/positions">Nifty intraday ledger</Link>. Net P&amp;L includes STT,
        stamp, exchange fees, GST &amp; DP when shares are set. Confirm on NSE before orders.
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
            {data.live?.heat_pct != null ? ` · heat ${data.live.heat_pct.toFixed(1)}%` : ''}
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
        <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
          Open positions always show the current open book; date range applies to closed trades.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      {data?.session && <NseSessionBanner session={data.session} />}

      {live && (filter === 'open' || filter === 'all') && (
        <div className="swing-live-bar card">
          <span className="swing-pill pill-live">Live · auto</span>
          {updatedAt ? (
            <span className="muted">
              Updated <strong>{updatedAt}</strong>
            </span>
          ) : null}
          <span className="muted">
            Next <strong>{countdownSec > 0 ? `${countdownSec}s` : 'due'}</strong>
          </span>
        </div>
      )}

      {(filter === 'open' || filter === 'all') && (        <OpenPositionsPanel
          positions={openBlock}
          sessionLive={Boolean(data?.session?.live_quotes)}
          onRefresh={load}
          onClosed={async () => {
            setFilter('closed');
            await load('closed');
          }}
          mode="ledger"
          showSessions
        />
      )}

      <div className="card">
        <h2>Add position</h2>
        <form className="form-grid" onSubmit={handleCreate}>
          <label>
            Symbol
            <input
              required
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
              placeholder="e.g. TCS"
            />
          </label>
          <label>
            Entry date
            <input
              type="date"
              required
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
            />
          </label>
          <label>
            Entry price
            <div className="swing-entry-price-wrap">
              <input
                type="number"
                step="0.05"
                required
                value={form.entry_price}
                onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))}
              />
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={fetchPriceBusy || !form.symbol.trim()}
                onClick={() => void fetchAddPrice()}
              >
                {fetchPriceBusy ? '…' : 'Fetch now'}
              </button>
            </div>
          </label>          <label>
            Shares
            <input
              type="number"
              value={form.shares}
              onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))}
            />
          </label>
          <label>
            Stop loss
            <input
              type="number"
              step="0.05"
              value={form.stop_loss}
              onChange={(e) => setForm((f) => ({ ...f, stop_loss: e.target.value }))}
            />
          </label>
          <label>
            Profit target
            <input
              type="number"
              step="0.05"
              value={form.profit_target}
              onChange={(e) => setForm((f) => ({ ...f, profit_target: e.target.value }))}
            />
          </label>
          <label>
            Notes
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Add position'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Or add from <Link to="/swing/auto">Swing Auto Radar</Link> when heat and regime allow.
        </p>
      </div>

      {(filter === 'closed' || filter === 'all') && (
        <SwingClosedPanel
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

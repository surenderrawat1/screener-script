import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { OpenPositionsPanel, type PositionsBlock } from '../components/swing/OpenPositionsPanel';
import { SwingClosedPanel, type ClosedSwingRow } from '../components/swing/SwingClosedPanel';

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

export default function PositionsPage() {
  const [data, setData] = useState<PositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    symbol: '',
    entry_price: '',
    entry_date: new Date().toISOString().slice(0, 10),
    shares: '',
    stop_loss: '',
    profit_target: '',
    notes: '',
  });

  const load = useCallback(async (statusOverride?: 'all' | 'open' | 'closed') => {
    setError('');
    setLoading(true);
    try {
      const status = statusOverride ?? filter;
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (live) params.set('live', '1');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await api<PositionsResponse>(`/api/v1/swing/positions${qs}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [filter, live]);

  useEffect(() => {
    void load();
    if (!live) return;
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, live]);

  const openPositions = (data?.positions ?? []).filter((p) => p.status === 'open');
  const closedPositions = (data?.positions ?? []).filter((p) => p.status === 'closed');

  const openBlock: PositionsBlock = {
    open: openPositions,
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
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
            <Link to="/swing/auto" className="btn btn-secondary">
              Auto Radar
            </Link>
          </>
        }
      />
      <p className="disclaimer">
        Distinct from <Link to="/intraday/positions">Nifty intraday ledger</Link>. P&amp;L is gross (no STT/charges
        yet). Confirm on NSE before orders.
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

      {error && <p className="error">{error}</p>}

      {(filter === 'open' || filter === 'all') && (
        <OpenPositionsPanel
          positions={openBlock}
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
            <input
              type="number"
              step="0.05"
              required
              value={form.entry_price}
              onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))}
            />
          </label>
          <label>
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

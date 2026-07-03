import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import {
  IntradayClosedPanel,
  IntradayOpenPanel,
  type IntradayPositionRow,
} from '../components/intraday/IntradayPositionsPanels';

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

export default function IntradayPositionsPage() {
  const [searchParams] = useSearchParams();
  const prefillInstrument = searchParams.get('instrument') ?? 'nifty50';
  const prefillSide = searchParams.get('side') === 'short' ? 'short' : 'long';
  const prefillTf = searchParams.get('timeframe') === '5m' ? '5m' : '15m';

  const [data, setData] = useState<PositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    instrument_id: prefillInstrument,
    product_type: 'spot' as 'spot' | 'futures' | 'options',
    side: prefillSide as 'long' | 'short',
    timeframe: prefillTf as '5m' | '15m',
    entry_price: searchParams.get('entry') ?? '',
    stop_loss: searchParams.get('stop') ?? '',
    target_t1: searchParams.get('t1') ?? '',
    target_t2: searchParams.get('t2') ?? '',
    target_t3: searchParams.get('t3') ?? '',
    quantity: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (statusOverride?: 'all' | 'open' | 'closed') => {
    setError('');
    setLoading(true);
    try {
      const status = statusOverride ?? filter;
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (live) params.set('live', '1');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await api<PositionsResponse>(`/api/v1/intraday/positions${qs}`);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/v1/intraday/positions', {
        method: 'POST',
        body: JSON.stringify({
          instrument_id: form.instrument_id,
          side: form.side,
          timeframe: form.timeframe,
          entry_price: Number(form.entry_price),
          stop_loss: form.stop_loss ? Number(form.stop_loss) : undefined,
          target_t1: form.target_t1 ? Number(form.target_t1) : undefined,
          target_t2: form.target_t2 ? Number(form.target_t2) : undefined,
          target_t3: form.target_t3 ? Number(form.target_t3) : undefined,
          quantity: form.quantity ? Number(form.quantity) : undefined,
          notes: [
            form.product_type !== 'spot' ? `[${form.product_type.toUpperCase()}]` : '',
            form.notes,
          ]
            .filter(Boolean)
            .join(' ')
            .trim() || undefined,
          source: form.product_type === 'spot' ? 'manual' : `fno_${form.product_type}`,
        }),
      });
      setForm((f) => ({
        ...f,
        entry_price: '',
        stop_loss: '',
        target_t1: '',
        target_t2: '',
        target_t3: '',
        quantity: '',
        notes: '',
      }));
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
        title="Nifty Positions"
        subtitle="Same-day intraday ledger — live exit actions, stops & targets"
        actions={
          <>
            <label className="morning-live-toggle">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              Live · 60s
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
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

      {error && <p className="error">{error}</p>}

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

      <div className="card">
        <h2>Log trade</h2>
        <form className="form-grid" onSubmit={handleCreate}>
          <label>
            Product
            <select
              value={form.product_type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  product_type: e.target.value as 'spot' | 'futures' | 'options',
                }))
              }
            >
              <option value="spot">Spot / index</option>
              <option value="futures">Futures</option>
              <option value="options">Options</option>
            </select>
          </label>
          <label>
            Instrument
            <select
              value={form.instrument_id}
              onChange={(e) => setForm((f) => ({ ...f, instrument_id: e.target.value }))}
            >
              <option value="nifty50">Nifty 50</option>
              <option value="banknifty">Bank Nifty</option>
              <option value="tcs">TCS</option>
              <option value="reliance">Reliance</option>
            </select>
          </label>
          <label>
            Side
            <select value={form.side} onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as 'long' | 'short' }))}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label>
            Timeframe
            <select
              value={form.timeframe}
              onChange={(e) => setForm((f) => ({ ...f, timeframe: e.target.value as '5m' | '15m' }))}
            >
              <option value="5m">5m</option>
              <option value="15m">15m</option>
            </select>
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
            Stop loss
            <input
              type="number"
              step="0.05"
              value={form.stop_loss}
              onChange={(e) => setForm((f) => ({ ...f, stop_loss: e.target.value }))}
            />
          </label>
          <label>
            Target T1
            <input
              type="number"
              step="0.05"
              value={form.target_t1}
              onChange={(e) => setForm((f) => ({ ...f, target_t1: e.target.value }))}
            />
          </label>
          <label>
            Target T2
            <input
              type="number"
              step="0.05"
              value={form.target_t2}
              onChange={(e) => setForm((f) => ({ ...f, target_t2: e.target.value }))}
            />
          </label>
          <label>
            Target T3
            <input
              type="number"
              step="0.05"
              value={form.target_t3}
              onChange={(e) => setForm((f) => ({ ...f, target_t3: e.target.value }))}
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder={form.product_type === 'futures' ? 'e.g. 75 = 1 Nifty lot' : ''}
            />
          </label>
          <label>
            Notes
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Log position'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Prefill from <Link to="/intraday">intraday radar</Link> trade plan · T1/T2/T3 = 1R/2R/3R partials · time
          stop 15:15 IST
        </p>
      </div>

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

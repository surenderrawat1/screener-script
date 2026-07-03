import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';

interface IntradayPositionRow {
  id?: string;
  instrument_id?: string;
  instrument_label?: string;
  symbol?: string;
  status?: string;
  entry_price?: number;
  entry_time?: string;
  gain_pct?: number | null;
  position_action?: string;
  action_label?: string;
  exit_verdict?: string;
  current_price?: number | null;
  pnl_inr?: number | null;
  position?: {
    id?: string;
    instrument_label?: string;
    symbol?: string;
    entry_price?: number;
    entry_time?: string;
    status?: string;
  };
}

interface IntradayPositionsResponse {
  positions: IntradayPositionRow[];
  summary: { open: number; closed: number };
}

function rowId(row: IntradayPositionRow): string {
  return String(row.id ?? row.position?.id ?? row.symbol ?? Math.random());
}

function rowLabel(row: IntradayPositionRow): string {
  return String(row.instrument_label ?? row.position?.instrument_label ?? row.symbol ?? '—');
}

export default function IntradayPositionsPage() {
  const [data, setData] = useState<IntradayPositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    instrument_id: 'nifty50',
    entry_price: '',
    stop_loss: '',
    target_t1: '',
    quantity: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (live && filter === 'open') params.set('live', '1');
    const qs = params.toString() ? `?${params.toString()}` : '';
    api<IntradayPositionsResponse>(`/api/v1/intraday/positions${qs}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [filter, live]);

  const positions = data?.positions ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/v1/intraday/positions', {
        method: 'POST',
        body: JSON.stringify({
          instrument_id: form.instrument_id,
          entry_price: Number(form.entry_price),
          stop_loss: form.stop_loss ? Number(form.stop_loss) : undefined,
          target_t1: form.target_t1 ? Number(form.target_t1) : undefined,
          quantity: form.quantity ? Number(form.quantity) : undefined,
          notes: form.notes || undefined,
          source: 'manual',
        }),
      });
      setForm({ instrument_id: 'nifty50', entry_price: '', stop_loss: '', target_t1: '', quantity: '', notes: '' });
      setFilter('open');
      const refreshed = await api<IntradayPositionsResponse>('/api/v1/intraday/positions?status=open&live=1');
      setData(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Nifty Intraday Positions"
        subtitle="Same-day index ledger — stops, targets, live action labels"
        actions={
          <label className="morning-live-toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live quotes
          </label>
        }
      />
      <p className="disclaimer">
        Research ledger only. Distinct from{' '}
        <Link to="/positions">swing positions</Link>. Confirm on NSE before orders.
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

      <div className="card">
        <h2>Log trade</h2>
        <form className="form-grid" onSubmit={handleCreate}>
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
            Quantity
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
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
      </div>

      <div className="card">
        {positions.length === 0 ? (
          <EmptyState>No intraday positions yet.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Entry</th>
                <th>Gain</th>
                <th>Action</th>
                <th>P&L</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((row) => (
                <tr key={rowId(row)}>
                  <td>{rowLabel(row)}</td>
                  <td>
                    ₹{row.entry_price ?? row.position?.entry_price ?? '—'}
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {row.entry_time ?? row.position?.entry_time ?? ''}
                    </div>
                  </td>
                  <td>
                    {row.gain_pct != null ? `${row.gain_pct > 0 ? '+' : ''}${row.gain_pct}%` : '—'}
                  </td>
                  <td>
                    <span
                      className={
                        row.exit_verdict === 'EXIT' || row.position_action?.startsWith('EXIT')
                          ? 'badge badge-sell'
                          : row.position_action === 'HOLD'
                            ? 'badge badge-buy'
                            : 'badge badge-muted'
                      }
                    >
                      {row.action_label ?? row.position_action ?? '—'}
                    </span>
                  </td>
                  <td>{row.pnl_inr != null ? `₹${row.pnl_inr}` : '—'}</td>
                  <td>{row.current_price != null ? `₹${row.current_price}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link to="/intraday" className="btn btn-secondary">
        Open intraday radar
      </Link>
    </Page>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';

interface WatchlistItem {
  id: string;
  symbol: string;
  notes: string | null;
  meta: Record<string, unknown> | null;
  addedAt: string;
}

interface WatchlistResponse {
  watchlist: { id: string; name: string; items: WatchlistItem[] };
  summary: { total: number; due: number; upcoming: number };
}

export default function WatchlistPage() {
  const [data, setData] = useState<WatchlistResponse | null>(null);
  const [symbol, setSymbol] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const res = await api<WatchlistResponse>('/api/v1/watchlist');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!symbol.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api('/api/v1/watchlist/items', {
        method: 'PUT',
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase() }),
      });
      setSymbol('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setLoading(false);
    }
  }

  async function onRemove(sym: string) {
    setError('');
    try {
      await api(`/api/v1/watchlist/items/${encodeURIComponent(sym)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    }
  }

  const items = data?.watchlist.items ?? [];
  const summary = data?.summary;

  return (
    <div>
      <h1>Watchlist</h1>
      <p className="disclaimer">
        Thesis and review dates from PHP watchlist — auto-updated on verify (last MOS, verdict).
      </p>

      {summary && (
        <div className="card">
          <p>
            <strong>{summary.total}</strong> stocks · <strong>{summary.due}</strong> reviews due ·{' '}
            <strong>{summary.upcoming}</strong> upcoming (90d)
          </p>
        </div>
      )}

      <form className="card" onSubmit={onAdd}>
        <div className="form-group" style={{ maxWidth: 280 }}>
          <label>Add symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="TCS"
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Add to watchlist
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Entries</h2>
        {items.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No symbols yet. Verify a stock or run PHP migration.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Review</th>
                <th>Last MOS</th>
                <th>Verdict</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const meta = item.meta ?? {};
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.symbol}</strong>
                      {meta.stock_name ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                          {String(meta.stock_name)}
                        </div>
                      ) : null}
                    </td>
                    <td>{String(meta.review_date ?? '—')}</td>
                    <td>{meta.last_mos != null ? `${meta.last_mos}%` : '—'}</td>
                    <td>{String(meta.last_verdict ?? '—')}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void onRemove(item.symbol)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

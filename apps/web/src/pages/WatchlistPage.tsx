import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';

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

function reviewStatus(reviewDate: string): 'overdue' | 'due' | 'upcoming' | 'ok' | 'none' {
  if (!reviewDate) return 'none';
  const rd = new Date(reviewDate);
  if (Number.isNaN(rd.getTime())) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  rd.setHours(0, 0, 0, 0);
  if (rd < today) return 'overdue';
  if (rd.getTime() === today.getTime()) return 'due';
  const days = Math.ceil((rd.getTime() - today.getTime()) / 86400000);
  if (days <= 90) return 'upcoming';
  return 'ok';
}

function reviewSortKey(item: WatchlistItem): number {
  const meta = item.meta ?? {};
  const status = reviewStatus(String(meta.review_date ?? ''));
  const order = { overdue: 0, due: 1, upcoming: 2, ok: 3, none: 4 };
  const base = order[status] * 1e12;
  const rd = String(meta.review_date ?? '');
  const t = rd ? new Date(rd).getTime() : Number.MAX_SAFE_INTEGER;
  return base + (Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t);
}

function ReviewBadge({ date }: { date: string }) {
  const status = reviewStatus(date);
  if (status === 'none') return <span className="muted">—</span>;
  const labels: Record<string, string> = {
    overdue: 'Overdue',
    due: 'Due today',
    upcoming: '≤90d',
    ok: 'Scheduled',
  };
  return (
    <span className={`review-badge review-${status}`}>
      {date} · {labels[status]}
    </span>
  );
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

  const items = [...(data?.watchlist.items ?? [])].sort((a, b) => reviewSortKey(a) - reviewSortKey(b));
  const summary = data?.summary;
  const dueItems = items.filter((i) => {
    const s = reviewStatus(String(i.meta?.review_date ?? ''));
    return s === 'overdue' || s === 'due';
  });

  return (
    <Page>
      <PageHeader title="Watchlist" subtitle="Thesis, review dates, and last verify snapshot" />
      <p className="disclaimer">Auto-updated on verify with last MOS and verdict.</p>

      {summary && summary.due > 0 && (
        <div className="watchlist-due-banner card">
          <strong>{summary.due}</strong> review{summary.due === 1 ? '' : 's'} due or overdue — re-run{' '}
          <Link to="/verify/full">Full Verify</Link> and update thesis.
        </div>
      )}

      {dueItems.length > 0 && (
        <div className="card">
          <h2>Reviews due</h2>
          <ul className="watchlist-due-list">
            {dueItems.map((item) => (
              <li key={item.id}>
                <Link to={`/verify/full?symbol=${encodeURIComponent(item.symbol)}`}>
                  {item.symbol}
                </Link>
                {' — '}
                <ReviewBadge date={String(item.meta?.review_date ?? '')} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <div className="card">
          <p>
            <strong>{summary.total}</strong> stocks · <strong>{summary.due}</strong> reviews due ·{' '}
            <strong>{summary.upcoming}</strong> upcoming (90d)
          </p>
        </div>
      )}

      <form className="card" onSubmit={onAdd}>
        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 280 }}>
            <label>Add symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="TCS"
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <button type="submit" className="btn" disabled={loading}>
          Add to watchlist
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Entries</h2>
        {items.length === 0 ? (
          <EmptyState>No symbols yet. Verify a stock or run PHP migration.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Review</th>
                <th>Score</th>
                <th>Last MOS</th>
                <th>Verdict</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const meta = item.meta ?? {};
                return (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/stock/${encodeURIComponent(item.symbol)}`}>
                        <strong>{item.symbol}</strong>
                      </Link>
                      {meta.stock_name ? (
                        <div className="muted">{String(meta.stock_name)}</div>
                      ) : null}
                    </td>
                    <td>
                      <ReviewBadge date={String(meta.review_date ?? '')} />
                    </td>
                    <td>{meta.last_score != null ? String(meta.last_score) : '—'}</td>
                    <td>{meta.last_mos != null ? `${meta.last_mos}%` : '—'}</td>
                    <td>{String(meta.last_verdict ?? '—')}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Link
                          className="btn btn-secondary"
                          to={`/verify/full?symbol=${encodeURIComponent(item.symbol)}`}
                          style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
                        >
                          Full Verify
                        </Link>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void onRemove(item.symbol)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}

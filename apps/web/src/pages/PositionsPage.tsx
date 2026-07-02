import { useEffect, useState } from 'react';
import { api } from '../api';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';

interface SwingPosition {
  id: string;
  symbol: string;
  status: string;
  entry_price: number;
  entry_date: string;
  shares: number | null;
  stop_loss: number | null;
  profit_target: number | null;
  notes: string | null;
  highest_since_entry: number | null;
  trailed_stop_loss: number | null;
  closed_at: string | null;
  closed_price: number | null;
  closed_reason: string | null;
}

interface PositionsResponse {
  positions: SwingPosition[];
  summary: { open: number; closed: number };
}

export default function PositionsPage() {
  const [data, setData] = useState<PositionsResponse | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [error, setError] = useState('');

  useEffect(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    api<PositionsResponse>(`/api/v1/swing/positions${q}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [filter]);

  const positions = data?.positions ?? [];

  return (
    <Page>
      <PageHeader title="Swing Positions" subtitle="Open and closed trades with stops and targets" />
      <p className="disclaimer">Use Auto Radar for live exit evaluation on open positions.</p>

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
        {positions.length === 0 ? (
          <EmptyState>No positions. Run pnpm migrate:php to import from PHP.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Status</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Target</th>
                <th>Exit</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.symbol}</strong>
                    {p.notes ? <div className="muted">{p.notes}</div> : null}
                  </td>
                  <td>{p.status}</td>
                  <td>
                    ₹{p.entry_price}
                    <div className="muted">{p.entry_date}</div>
                  </td>
                  <td>{p.trailed_stop_loss ?? p.stop_loss ?? '—'}</td>
                  <td>{p.profit_target ?? '—'}</td>
                  <td>
                    {p.closed_price != null ? (
                      <>
                        ₹{p.closed_price}
                        <div className="muted">{p.closed_at?.slice(0, 10)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{p.closed_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}

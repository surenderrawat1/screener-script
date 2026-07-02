import { useEffect, useState } from 'react';
import { api } from '../api';

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
    <div>
      <h1>Swing Positions</h1>
      <p className="disclaimer">
        Open/closed trades migrated from PHP <code>swing_positions.json</code>. Scanner logic comes in a
        later phase.
      </p>

      <div className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.85rem' }}>
            {data.summary.open} open · {data.summary.closed} closed
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {positions.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No positions. Run <code>pnpm migrate:php</code> to import from PHP.
          </p>
        ) : (
          <table>
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
                    {p.notes ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{p.notes}</div>
                    ) : null}
                  </td>
                  <td>{p.status}</td>
                  <td>
                    ₹{p.entry_price}
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{p.entry_date}</div>
                  </td>
                  <td>{p.trailed_stop_loss ?? p.stop_loss ?? '—'}</td>
                  <td>{p.profit_target ?? '—'}</td>
                  <td>
                    {p.closed_price != null ? (
                      <>
                        ₹{p.closed_price}
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {p.closed_at?.slice(0, 10)}
                        </div>
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
    </div>
  );
}

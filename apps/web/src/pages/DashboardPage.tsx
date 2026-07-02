import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DashboardPage() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>('/health').then(setHealth).catch(() => setHealth({ status: 'error' }));
    api<Record<string, unknown>>('/health/ready').then(setReady).catch(() => setReady(null));
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="disclaimer">
        Educational research tool only — not SEBI-registered investment advice.
      </p>

      <div className="card">
        <h2>System Health</h2>
        <p>
          API: <strong>{String(health?.status ?? '…')}</strong>
        </p>
        {ready && (
          <pre style={{ fontSize: '0.8rem', overflow: 'auto' }}>
            {JSON.stringify(ready, null, 2)}
          </pre>
        )}
      </div>

      <div className="card">
        <h2>Quick links</h2>
        <ul>
          <li>
            <a href="/screener">Run screener</a> — universe + preset filters
          </li>
          <li>
            <a href="/verify">CFA verify</a> — one-click symbol analysis
          </li>
          <li>
            <a href="/watchlist">Watchlist</a> — thesis & review dates
          </li>
          <li>
            <a href="/positions">Swing positions</a> — open/closed trades
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Stack</h2>
        <table>
          <tbody>
            <tr>
              <td>PostgreSQL</td>
              <td>
                <code>shared_postgres</code> on <code>shared_network</code>
              </td>
            </tr>
            <tr>
              <td>Redis</td>
              <td>
                <code>shared_redis</code> (DB 1)
              </td>
            </tr>
            <tr>
              <td>API</td>
              <td>Fastify + Prisma + BullMQ</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

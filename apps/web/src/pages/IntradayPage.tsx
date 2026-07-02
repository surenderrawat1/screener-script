import { useEffect, useState } from 'react';
import { api } from '../api';

export default function IntradayPage() {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Record<string, unknown>>('/api/v1/intraday/nifty/state')
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, []);

  if (error) return <div className="page error">{error}</div>;
  if (!state) return <div className="page">Loading Nifty intraday playbook…</div>;

  const playbook = state.playbook as Record<string, unknown>;
  const steps = (playbook.steps as Array<Record<string, unknown>>) ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Nifty Intraday</h1>
          <p className="muted">15m directional playbook (MVP)</p>
        </div>
      </header>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2>{String(playbook.headline ?? '—')}</h2>
        <p className="muted">
          Bias {String(playbook.bias_label ?? '')} · LTP{' '}
          {playbook.current_price != null ? `₹${Number(playbook.current_price).toFixed(2)}` : '—'} · actionable{' '}
          {playbook.actionable ? 'yes' : 'no'}
        </p>
        <p className="muted">{String(state.note ?? '')}</p>
      </section>

      <section className="card">
        <h3>Playbook steps</h3>
        <ol>
          {steps.map((s) => (
            <li key={String(s.step)} style={{ marginBottom: '0.75rem' }}>
              <strong>{String(s.title)}</strong> — {String(s.instruction)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

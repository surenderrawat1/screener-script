import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader, PageLoading } from '../components/PageLayout';

type Interval = '5m' | '15m';

export default function IntradayPage() {
  const [searchParams] = useSearchParams();
  const presetId = searchParams.get('preset');
  const initialInterval: Interval = searchParams.get('interval') === '5m' ? '5m' : '15m';
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const next = searchParams.get('interval') === '5m' ? '5m' : searchParams.get('interval') === '15m' ? '15m' : null;
    if (next) setInterval(next);
  }, [searchParams]);

  const load = useCallback(
    async (refresh = false) => {
      setError('');
      setLoading(true);
      try {
        const q = new URLSearchParams({ interval });
        if (refresh) q.set('refresh', '1');
        const data = await api<Record<string, unknown>>(`/api/v1/intraday/nifty/state?${q}`);
        setState(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    },
    [interval],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && !state) return <PageLoading label="Loading Nifty intraday playbook…" />;
  if (error && !state) {
    return (
      <Page>
        <p className="error">{error}</p>
      </Page>
    );
  }
  if (!state) return null;

  const playbook = state.playbook as Record<string, unknown>;
  const steps = (playbook.steps as Array<Record<string, unknown>>) ?? [];
  const analysis = state.analysis as Record<string, unknown> | undefined;
  const mtf = state.mtf as Record<string, unknown> | undefined;

  return (
    <Page>
      <PageHeader
        title="Nifty Intraday"
        subtitle="Live 5m/15m directional playbook"
        actions={
          <>
            <div className="segmented">
              {(['5m', '15m'] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={interval === tf ? 'btn' : 'btn btn-secondary'}
                  onClick={() => setInterval(tf)}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void load(true)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />
      <p className="disclaimer">Intraday signals for education — confirm with your risk plan before trading.</p>
      {presetId && (
        <p className="muted">
          Preset: <strong>{presetId.replace(/_/g, ' ')}</strong>
          {' · '}
          <Link to="/presets">All presets</Link>
          {' · '}
          <Link to="/intraday/positions">Intraday ledger</Link>
        </p>
      )}

      <section className="card">
        <h2>{String(playbook.headline ?? '—')}</h2>
        <p className="muted">
          Bias {String(playbook.bias_label ?? '')} · LTP{' '}
          {playbook.current_price != null ? `₹${Number(playbook.current_price).toFixed(2)}` : '—'} · actionable{' '}
          {playbook.actionable ? 'yes' : 'no'}
        </p>
        <p className="muted">
          Direction {String(analysis?.direction ?? '—')} · confidence {String(analysis?.confidence ?? '—')}% · MTF{' '}
          {String(mtf?.bias ?? mtf?.label ?? '—')}
        </p>
      </section>

      <section className="card">
        <h2>Playbook steps</h2>
        {steps.length === 0 ? (
          <p className="muted">No steps available for current session.</p>
        ) : (
          <ol>
            {steps.map((s) => (
              <li key={String(s.step)} style={{ marginBottom: '0.75rem' }}>
                <strong>{String(s.title)}</strong> — {String(s.instruction)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Page>
  );
}

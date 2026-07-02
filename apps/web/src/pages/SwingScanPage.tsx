import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface SwingHit {
  symbol: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  entry_score: number;
  rules_passed: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  swing_rank?: number;
}

export default function SwingScanPage() {
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [universe, setUniverse] = useState('nifty50');
  const [minVerdict, setMinVerdict] = useState('SETUP_PLUS');
  const [gc9Only, setGc9Only] = useState(false);
  const [hits, setHits] = useState<SwingHit[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes').then((r) => setUniverses(r.universes)).catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setHits([]);
    try {
      const res = await api<{
        jobId: string;
        background: boolean;
        status: string;
        result?: { hits: SwingHit[]; scanned: number; skipped: number };
      }>('/api/v1/swing/scan', {
        method: 'POST',
        body: JSON.stringify({
          universe,
          maxScan: 50,
          min_verdict: minVerdict,
          gc9_only: gc9Only,
          background: false,
        }),
      });

      if (res.status === 'done' && res.result) {
        setHits(res.result.hits);
        setMeta({ scanned: res.result.scanned, skipped: res.result.skipped });
      } else {
        const job = await api<{ job: { result?: { hits: SwingHit[]; scanned: number; skipped: number } } }>(
          `/api/v1/screener/jobs/${res.jobId}`,
        );
        const result = job.job.result as { hits: SwingHit[]; scanned: number; skipped: number } | undefined;
        if (result?.hits) {
          setHits(result.hits);
          setMeta({ scanned: result.scanned, skipped: result.skipped });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader title="Swing Scanner" subtitle="Daily E1–E11 rules, GC9 filter, Yahoo chart TA" />
      <p className="disclaimer">Swing engine v3.9-gc9 — research signals only.</p>

      <form className="card" onSubmit={onSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Universe</label>
            <select value={universe} onChange={(e) => setUniverse(e.target.value)} style={{ width: '100%' }}>
              {universes.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name} ({u.symbolCount})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Min verdict</label>
            <select value={minVerdict} onChange={(e) => setMinVerdict(e.target.value)} style={{ width: '100%' }}>
              <option value="ENTER">ENTER</option>
              <option value="SETUP_PLUS">SETUP+</option>
              <option value="WATCH">WATCH</option>
              <option value="ALL">ALL</option>
            </select>
          </div>
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={gc9Only} onChange={(e) => setGc9Only(e.target.checked)} />
          GC9 only
        </label>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Scanning…' : 'Run swing scan (max 50)'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {meta && (
        <p className="muted">
          Scanned {String(meta.scanned)} · Skipped {String(meta.skipped)} · Hits {hits.length}
        </p>
      )}

      {hits.length > 0 && (
        <div className="card">
          <h2>Hits ({hits.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Price</th>
                <th>Discovery</th>
                <th>Strict</th>
                <th>Score</th>
                <th>Rules</th>
                <th>R</th>
                <th>Rank</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.symbol}>
                  <td>
                    <strong>{h.symbol}</strong>
                  </td>
                  <td>₹{h.price}</td>
                  <td>{h.verdict}</td>
                  <td>{h.strict_verdict}</td>
                  <td>{h.entry_score}</td>
                  <td>{h.rules_passed}</td>
                  <td>{h.r_multiple ?? '—'}</td>
                  <td>{h.swing_rank ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

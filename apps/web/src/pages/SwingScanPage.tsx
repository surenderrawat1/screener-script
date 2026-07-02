import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';

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
    <div>
      <h1>Swing Scanner</h1>
      <p className="disclaimer">
        Daily swing rules engine v3.9-gc9 — Yahoo chart TA, E1–E11 entry rules, GC9 filter.
      </p>

      <form className="card" onSubmit={onSubmit}>
        <div className="form-group">
          <label>Universe</label>
          <select value={universe} onChange={(e) => setUniverse(e.target.value)} style={{ width: '100%', maxWidth: 320 }}>
            {universes.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name} ({u.symbolCount})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginTop: '0.75rem' }}>
          <label>Min verdict</label>
          <select value={minVerdict} onChange={(e) => setMinVerdict(e.target.value)} style={{ width: '100%', maxWidth: 200 }}>
            <option value="ENTER">ENTER</option>
            <option value="SETUP_PLUS">SETUP+</option>
            <option value="WATCH">WATCH</option>
            <option value="ALL">ALL</option>
          </select>
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <input type="checkbox" checked={gc9Only} onChange={(e) => setGc9Only(e.target.checked)} />
          GC9 only
        </label>
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          {loading ? 'Scanning…' : 'Run swing scan (max 50)'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {meta && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Scanned {String(meta.scanned)} · Skipped {String(meta.skipped)} · Hits {hits.length}
        </p>
      )}

      {hits.length > 0 && (
        <div className="card">
          <table>
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
    </div>
  );
}

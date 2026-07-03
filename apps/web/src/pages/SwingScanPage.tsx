import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

interface TradingPresetResponse {
  preset: {
    scan_params?: {
      universe: string;
      min_verdict: string;
      gc9_only?: boolean;
      maxScan?: number;
    };
  };
}

export default function SwingScanPage() {
  const [searchParams] = useSearchParams();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [universe, setUniverse] = useState(searchParams.get('universe') ?? 'nifty50');
  const [minVerdict, setMinVerdict] = useState('SETUP_PLUS');
  const [gc9Only, setGc9Only] = useState(false);
  const [maxScan, setMaxScan] = useState(50);
  const [hits, setHits] = useState<SwingHit[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [presetReady, setPresetReady] = useState(!searchParams.get('preset'));
  const autorunDone = useRef(false);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes').then((r) => setUniverses(r.universes)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const presetParam = searchParams.get('preset');
    const universeParam = searchParams.get('universe');

    if (!presetParam) {
      if (universeParam) setUniverse(universeParam);
      setPresetReady(true);
      return;
    }

    setPresetReady(false);
    api<TradingPresetResponse>(`/api/v1/trading/presets/${encodeURIComponent(presetParam)}`)
      .then(({ preset }) => {
        const scan = preset.scan_params;
        if (universeParam) {
          setUniverse(universeParam);
        } else if (scan?.universe) {
          setUniverse(scan.universe);
        }
        if (scan?.min_verdict) setMinVerdict(scan.min_verdict);
        if (scan?.gc9_only) setGc9Only(true);
        if (scan?.maxScan) setMaxScan(scan.maxScan);
      })
      .catch(() => undefined)
      .finally(() => setPresetReady(true));
  }, [searchParams]);

  const runScan = useCallback(async () => {
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
          maxScan,
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
  }, [universe, maxScan, minVerdict, gc9Only]);

  useEffect(() => {
    if (
      searchParams.get('autorun') !== '1' ||
      !presetReady ||
      universes.length === 0 ||
      autorunDone.current
    ) {
      return;
    }
    autorunDone.current = true;
    void runScan();
  }, [searchParams, presetReady, universes.length, runScan]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await runScan();
  }

  const activePreset = searchParams.get('preset');

  return (
    <Page>
      <PageHeader title="Swing Scanner" subtitle="Daily E1–E11 rules, GC9 filter, Yahoo chart TA" />
      <p className="disclaimer">Swing engine v3.9-gc9 — research signals only.</p>
      {activePreset && (
        <p className="muted">
          Preset: <strong>{activePreset.replace(/_/g, ' ')}</strong>
          {searchParams.get('autorun') === '1' ? ' · auto-scan' : ''}
        </p>
      )}

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
        <button type="submit" className="btn" disabled={loading || !presetReady}>
          {loading ? 'Scanning…' : 'Run swing scan'}
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

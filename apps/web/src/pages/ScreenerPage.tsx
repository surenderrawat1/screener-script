import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  mos: number | null;
  recommendation: string;
  zone: string;
}

export default function ScreenerPage() {
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [universe, setUniverse] = useState('nifty50');
  const [preset, setPreset] = useState('quality');
  const [maxScan, setMaxScan] = useState(200);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; passed: number } | null>(null);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => setUniverses(r.universes))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/jobs/${jobId}`);
    ws.onmessage = (ev) => {
      const p = JSON.parse(ev.data);
      setProgress(p);
      if (p.phase === 'done') {
        void pollJob(jobId);
      }
    };
    const interval = setInterval(() => void pollJob(jobId), 2000);
    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [jobId]);

  async function pollJob(id: string) {
    const res = await api<{ job: { status: string; result?: { rows: ScreenerRow[] }; progress?: typeof progress } }>(
      `/api/v1/screener/jobs/${id}`,
    );
    if (res.job.progress) setProgress(res.job.progress as typeof progress);
    if (res.job.status === 'done' && res.job.result?.rows) {
      setRows(res.job.result.rows);
      setLoading(false);
    }
    if (res.job.status === 'failed') {
      setError('Screener job failed');
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setRows([]);
    setJobId(null);
    setProgress(null);

    try {
      const res = await api<{
        jobId: string;
        background: boolean;
        status: string;
      }>('/api/v1/screener/run', {
        method: 'POST',
        body: JSON.stringify({ universe, preset, maxScan }),
      });

      if (res.background) {
        setJobId(res.jobId);
      } else {
        await pollJob(res.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screener failed');
      setLoading(false);
    }
  }

  function badgeClass(zone: string) {
    if (zone.includes('Buy')) return 'badge badge-buy';
    if (zone === 'Hold' || zone === 'Accumulate') return 'badge badge-hold';
    return 'badge badge-expensive';
  }

  return (
    <Page>
      <PageHeader title="Screener" subtitle="Universe scan with CFA preset filters" />
      <p className="disclaimer">Screening is research assistance — verify before allocating.</p>

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
            <label>Preset</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: '100%' }}>
              <option value="quality">Quality</option>
              <option value="strong_buy">Strong Buy</option>
              <option value="buy_picks">Buy Picks</option>
              <option value="fair_mos">Fair MOS</option>
              <option value="value">Value</option>
              <option value="growth">Growth</option>
              <option value="cfa_top">CFA Top</option>
            </select>
          </div>
          <div className="form-group">
            <label>Max scan</label>
            <input
              type="number"
              min={10}
              max={2000}
              value={maxScan}
              onChange={(e) => setMaxScan(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Running…' : 'Run screener'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {progress && (
        <div className="card">
          <p>
            Progress: {progress.processed}/{progress.total} · passed {progress.passed}
          </p>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <h2>Results ({rows.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Price</th>
                <th>P/E</th>
                <th>ROE</th>
                <th>MOS</th>
                <th>Zone</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <strong>{r.symbol}</strong>
                    <br />
                    <span className="muted">{r.name}</span>
                  </td>
                  <td>{r.price}</td>
                  <td>{r.pe}</td>
                  <td>{r.roe}%</td>
                  <td>{r.mos !== null ? `${r.mos}%` : '—'}</td>
                  <td>
                    <span className={badgeClass(r.zone)}>{r.zone}</span>
                  </td>
                  <td>{r.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

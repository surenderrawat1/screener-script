import { FormEvent, useEffect, useState } from 'react';
import { api, getToken } from '../api';

interface AdminStats {
  nse_equity_count: number;
  promoter_holding_count: number;
  universes: { key: string; name: string; symbolCount: number }[];
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [nseFile, setNseFile] = useState<File | null>(null);
  const [holdingFile, setHoldingFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadStats() {
    try {
      const data = await api<AdminStats>('/api/v1/admin/uploads/stats');
      setStats(data);
    } catch {
      setStats(null);
    }
  }

  useEffect(() => {
    void loadStats();
  }, []);

  async function upload(endpoint: string, file: File | null) {
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessage(`Imported ${data.imported} row(s) successfully`);
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  function onNseSubmit(e: FormEvent) {
    e.preventDefault();
    void upload('/api/v1/admin/uploads/nse-equity', nseFile);
  }

  function onHoldingSubmit(e: FormEvent) {
    e.preventDefault();
    void upload('/api/v1/admin/uploads/promoter-holding', holdingFile);
  }

  return (
    <div>
      <h1>Admin — Data Uploads</h1>
      <p className="disclaimer">
        Upload NSE EQUITY_L.csv for full market universe and promoter holding CSV for verified
        min-promoter filters (parity with PHP cache.php).
      </p>

      {stats && (
        <div className="card">
          <h2>Current data</h2>
          <table>
            <tbody>
              <tr>
                <td>NSE equity list</td>
                <td>{stats.nse_equity_count} symbols</td>
              </tr>
              <tr>
                <td>Promoter holdings</td>
                <td>{stats.promoter_holding_count} symbols</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <form className="card" onSubmit={onNseSubmit}>
        <h2>All NSE — EQUITY_L.csv</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          CSV with SYMBOL column. Updates <code>total_nse</code> universe.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setNseFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Upload NSE equity list
        </button>
      </form>

      <form className="card" onSubmit={onHoldingSubmit}>
        <h2>Promoter holding CSV</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Columns: symbol, promoter_holding_pct, as_of (optional)
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setHoldingFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Upload promoter holdings
        </button>
      </form>

      {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { api, getToken } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface AdminStats {
  nse_equity_count: number;
  promoter_holding_count: number;
  universes: { key: string; name: string; symbolCount: number }[];
}

interface IndexStatus {
  key: string;
  label: string;
  count: number;
  importedAt: string | null;
  ageDays: number | null;
  stale: boolean;
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [indices, setIndices] = useState<IndexStatus[]>([]);
  const [nseFile, setNseFile] = useState<File | null>(null);
  const [holdingFile, setHoldingFile] = useState<File | null>(null);
  const [indexFile, setIndexFile] = useState<File | null>(null);
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

  async function loadIndices() {
    try {
      const data = await api<{ indices: IndexStatus[] }>('/api/v1/admin/indices/status');
      setIndices(data.indices);
    } catch {
      setIndices([]);
    }
  }

  useEffect(() => {
    void loadStats();
    void loadIndices();
  }, []);

  async function upload(endpoint: string, file: File | null, successLabel = 'Imported') {
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
      const count = data.imported ?? data.count ?? 0;
      const key = data.indexKey ? ` (${data.indexKey})` : '';
      setMessage(`${successLabel} ${count} row(s)${key}`);
      await loadStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  async function syncIndicesFromDisk() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{ synced: number; total: number; indicesDir: string }>(
        '/api/v1/admin/indices/sync',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setMessage(`Synced ${data.synced}/${data.total} indices from ${data.indicesDir}`);
      await loadStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Index sync failed');
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

  function onIndexSubmit(e: FormEvent) {
    e.preventDefault();
    void upload('/api/v1/admin/indices/upload', indexFile, 'Synced');
  }

  return (
    <Page>
      <PageHeader
        title="Admin"
        subtitle="Index universes, NSE equity list, and promoter holding uploads"
      />

      <div className="card">
        <h2>Index universes</h2>
        <p className="muted">
          Sync Nifty index CSVs from the PHP data folder, or upload MW-NIFTY / ind_nifty CSV files.
        </p>
        {indices.length > 0 && (
          <table className="data-table" style={{ marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th>Index</th>
                <th>Symbols</th>
                <th>Last import</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {indices.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                  <td>
                    {row.importedAt
                      ? `${new Date(row.importedAt).toLocaleDateString()} (${row.ageDays ?? 0}d)`
                      : '—'}
                  </td>
                  <td>{row.count === 0 ? 'empty' : row.stale ? 'stale' : 'ok'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn" disabled={loading} onClick={() => void syncIndicesFromDisk()}>
          Sync indices from disk
        </button>
      </div>

      <form className="card" onSubmit={onIndexSubmit}>
        <h2>Upload index CSV</h2>
        <p className="muted">
          Filename should match NSE patterns (e.g. MW-NIFTY-50, ind_nifty50list.csv).
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setIndexFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Upload index CSV
        </button>
      </form>

      {stats && (
        <div className="card">
          <h2>Current data</h2>
          <table className="data-table">
            <tbody>
              <tr>
                <td>NSE equity list</td>
                <td>{stats.nse_equity_count} symbols</td>
              </tr>
              <tr>
                <td>Promoter holdings</td>
                <td>{stats.promoter_holding_count} symbols</td>
              </tr>
              {stats.universes.map((u) => (
                <tr key={u.key}>
                  <td>{u.name}</td>
                  <td>{u.symbolCount} symbols</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="card" onSubmit={onNseSubmit}>
        <h2>All NSE — EQUITY_L.csv</h2>
        <p className="muted">CSV with SYMBOL column. Updates total_nse universe.</p>
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
        <p className="muted">Columns: symbol, promoter_holding_pct, as_of (optional)</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setHoldingFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Upload promoter holdings
        </button>
      </form>

      {message && <p className="message-success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </Page>
  );
}

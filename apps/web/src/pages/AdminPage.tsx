import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

interface CachePrefixStat {
  prefix: string;
  count: number;
}

interface CacheStats {
  connected: boolean;
  db: number;
  keysEstimate: number;
  prefixes: CachePrefixStat[];
}

interface CacheScope {
  prefix: string;
  label: string;
  ttl: string;
  policy: string;
  clearable: boolean;
}

interface CacheKeyPreview {
  key: string;
  ttl: number;
}

interface CacheValuePreview {
  key: string;
  exists: boolean;
  ttl: number;
  type: string;
  bytes: number;
  truncated: boolean;
  value: unknown;
}

interface EffectiveSettings {
  effective: {
    dataPolicy: { timezone: string; cache_ttl: Record<string, number> };
    schedules: { daily_sync: { cron: string; timezone: string; enabled: boolean } };
  };
}

interface DailySyncStatus {
  enabled: boolean;
  cron: string;
  timezone: string;
  completed_today: boolean;
  due_now: boolean;
  active: boolean;
  last_job: {
    id: string;
    status: string;
    finished_at: string | null;
  } | null;
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [indices, setIndices] = useState<IndexStatus[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheScopes, setCacheScopes] = useState<CacheScope[]>([]);
  const [cacheKeys, setCacheKeys] = useState<CacheKeyPreview[]>([]);
  const [cacheValue, setCacheValue] = useState<CacheValuePreview | null>(null);
  const [settings, setSettings] = useState<EffectiveSettings | null>(null);
  const [syncStatus, setSyncStatus] = useState<DailySyncStatus | null>(null);
  const [cachePrefix, setCachePrefix] = useState('sv:stock');
  const [cacheConfirm, setCacheConfirm] = useState('');
  const [cachePreviewError, setCachePreviewError] = useState('');
  const [syncCron, setSyncCron] = useState('0 6 * * *');
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

  async function loadCacheStats() {
    try {
      const data = await api<{ stats: CacheStats; scopes?: CacheScope[] }>('/api/v1/admin/cache/stats');
      setCacheStats(data.stats);
      setCacheScopes(data.scopes ?? []);
    } catch {
      setCacheStats(null);
      setCacheScopes([]);
    }
  }

  async function loadCacheKeys(prefix = cachePrefix) {
    setCachePreviewError('');
    setCacheValue(null);
    try {
      const data = await api<{ keys: CacheKeyPreview[] }>(
        `/api/v1/admin/cache/keys?prefix=${encodeURIComponent(prefix)}&limit=25`,
      );
      setCacheKeys(data.keys);
    } catch (err) {
      setCacheKeys([]);
      setCachePreviewError(err instanceof Error ? err.message : 'Cache preview failed');
    }
  }

  async function loadCacheValue(key: string) {
    setCachePreviewError('');
    setCacheValue(null);
    try {
      const data = await api<{ preview: CacheValuePreview }>(
        `/api/v1/admin/cache/value?prefix=${encodeURIComponent(cachePrefix)}&key=${encodeURIComponent(key)}`,
      );
      setCacheValue(data.preview);
    } catch (err) {
      setCachePreviewError(err instanceof Error ? err.message : 'Cache data preview failed');
    }
  }

  async function loadSettings() {
    try {
      const data = await api<EffectiveSettings>('/api/v1/admin/settings');
      setSettings(data);
      setSyncCron(data.effective.schedules.daily_sync.cron);
    } catch {
      setSettings(null);
    }
  }

  async function loadSyncStatus() {
    try {
      const data = await api<DailySyncStatus>('/api/v1/admin/sync/status');
      setSyncStatus(data);
    } catch {
      setSyncStatus(null);
    }
  }

  useEffect(() => {
    void loadStats();
    void loadIndices();
    void loadCacheStats();
    void loadSettings();
    void loadSyncStatus();
  }, []);

  useEffect(() => {
    setCacheConfirm('');
    if (cachePrefix) void loadCacheKeys(cachePrefix);
  }, [cachePrefix]);

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

  async function clearCachePrefix() {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{ deleted: number; prefix: string }>(
        `/api/v1/admin/cache?prefix=${encodeURIComponent(cachePrefix)}&confirm=${encodeURIComponent(cacheConfirm)}`,
        { method: 'DELETE' },
      );
      setMessage(`Cleared ${data.deleted} key(s) under ${data.prefix}`);
      setCacheConfirm('');
      await loadCacheStats();
      await loadCacheKeys(data.prefix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cache clear failed');
    } finally {
      setLoading(false);
    }
  }

  async function saveSyncSchedule(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          schedules: {
            daily_sync: { cron: syncCron },
          },
        }),
      });
      setMessage('Daily sync schedule saved');
      await loadSettings();
      await loadSyncStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings save failed');
    } finally {
      setLoading(false);
    }
  }

  async function runDailySyncNow(force = false) {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const data = await api<{ ok: boolean; job_id: string; steps: { id: string; ok: boolean }[] }>(
        '/api/v1/admin/sync/daily',
        { method: 'POST', body: JSON.stringify({ force }) },
      );
      const failed = data.steps.filter((s) => !s.ok).length;
      setMessage(
        `Daily sync ${data.ok ? 'completed' : 'finished with errors'} — job ${data.job_id}${failed ? ` (${failed} step(s) failed)` : ''}`,
      );
      await loadSyncStatus();
      await loadCacheStats();
      await loadIndices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Daily sync failed');
    } finally {
      setLoading(false);
    }
  }

  const selectedCacheScope = cacheScopes.find((scope) => scope.prefix === cachePrefix);
  const selectedCacheCount =
    cacheStats?.prefixes.find((row) => row.prefix === cachePrefix)?.count ?? cacheKeys.length;
  const canClearCache =
    Boolean(selectedCacheScope?.clearable) && cacheConfirm === cachePrefix && !loading;
  const cacheValueText =
    cacheValue?.value == null
      ? ''
      : typeof cacheValue.value === 'string'
        ? cacheValue.value
        : JSON.stringify(cacheValue.value, null, 2);

  return (
    <Page>
      <PageHeader
        title="Admin"
        subtitle="Data uploads, cache, settings, and index sync"
      />

      <div className="card">
        <h2>CFA documentation</h2>
        <p className="muted">
          Glossary of valuation terms, formulas, and phase definitions used in Verify and Screener.
          Admins can edit definitions without redeploying the app.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link to="/admin/cfa-docs" className="btn">
            Manage CFA Docs
          </Link>
          <Link to="/cfa-reference" className="btn btn-secondary">
            View CFA Reference
          </Link>
        </div>
      </div>

      {settings && (
        <form className="card" onSubmit={saveSyncSchedule}>
          <h2>Settings — daily sync</h2>
          <p className="muted">
            Scheduled at 06:00 IST by default. Worker runs automatically when{' '}
            <code>pnpm dev:worker</code> is active.
          </p>
          {syncStatus && (
            <p className="muted" style={{ marginBottom: '0.75rem' }}>
              Status: {syncStatus.completed_today ? 'completed today' : 'not run today'}
              {syncStatus.active ? ' · running' : ''}
              {syncStatus.due_now ? ' · due now' : ''}
              {syncStatus.last_job?.finished_at
                ? ` · last: ${new Date(syncStatus.last_job.finished_at).toLocaleString()}`
                : ''}
            </p>
          )}
          <label>
            Cron expression
            <input
              type="text"
              value={syncCron}
              onChange={(e) => setSyncCron(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn" disabled={loading}>
              Save schedule
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || syncStatus?.active}
              onClick={() => void runDailySyncNow(false)}
            >
              Run daily sync now
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || syncStatus?.active}
              onClick={() => void runDailySyncNow(true)}
            >
              Force re-run
            </button>
          </div>
        </form>
      )}

      <div className="card">
        <h2>Redis cache/info</h2>
        <p className="muted">
          Redis is a hot cache only. Clear one approved scope at a time; use daily sync for reference
          data and avoid operational namespaces such as job progress, rate limits, and worker heartbeat.
        </p>
        {cacheStats && (
          <>
            <p className="muted">
              DB {cacheStats.db} · ~{cacheStats.keysEstimate} keys ·{' '}
              {cacheStats.connected ? 'connected' : 'disconnected'}
            </p>
            {cacheScopes.length > 0 && (
              <table className="data-table" style={{ marginBottom: '1rem' }}>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>TTL</th>
                    <th>Keys</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {cacheScopes.map((scope) => {
                    const count = cacheStats.prefixes.find((row) => row.prefix === scope.prefix)?.count ?? 0;
                    return (
                      <tr key={scope.prefix}>
                        <td>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => setCachePrefix(scope.prefix)}
                          >
                            {scope.label}
                          </button>
                          <br />
                          <code>{scope.prefix}</code>
                        </td>
                        <td>{scope.ttl}</td>
                        <td>{count}</td>
                        <td>{scope.clearable ? 'Clearable with confirmation' : 'Protected'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
        <div className="admin-cache-grid">
          <label>
            Cache scope
            <select
              value={cachePrefix}
              onChange={(e) => setCachePrefix(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
            >
              {cacheScopes.map((scope) => (
                <option key={scope.prefix} value={scope.prefix}>
                  {scope.label} ({scope.prefix})
                </option>
              ))}
            </select>
          </label>
          <div className="admin-cache-policy">
            <strong>{selectedCacheScope?.label ?? cachePrefix}</strong>
            <p>{selectedCacheScope?.policy ?? 'Select an approved cache scope.'}</p>
            <small>
              TTL: {selectedCacheScope?.ttl ?? 'unknown'} · Current keys: {selectedCacheCount} ·{' '}
              {selectedCacheScope?.clearable ? 'Manual clear allowed' : 'Protected scope'}
            </small>
          </div>
        </div>
        <div className="admin-cache-preview">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <strong>Key preview</strong>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || !cachePrefix}
              onClick={() => void loadCacheKeys(cachePrefix)}
            >
              Refresh preview
            </button>
          </div>
          {cachePreviewError && <p className="error">{cachePreviewError}</p>}
          {cacheKeys.length > 0 ? (
            <ul>
              {cacheKeys.slice(0, 10).map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => void loadCacheValue(row.key)}
                  >
                    <code>{row.key}</code>
                  </button>
                  <span className="muted"> · TTL {row.ttl < 0 ? 'none' : `${row.ttl}s`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No keys found for this scope.</p>
          )}
          {cacheValue && (
            <div className="admin-cache-value">
              <div className="admin-cache-value-meta">
                <strong>Data preview</strong>
                <span>
                  {cacheValue.type} · {cacheValue.bytes.toLocaleString()} bytes · TTL{' '}
                  {cacheValue.ttl < 0 ? 'none' : `${cacheValue.ttl}s`}
                  {cacheValue.truncated ? ' · truncated' : ''}
                </span>
              </div>
              <code>{cacheValue.key}</code>
              {cacheValue.exists ? (
                <pre>{cacheValueText}</pre>
              ) : (
                <p className="muted">This key no longer exists.</p>
              )}
            </div>
          )}
        </div>
        <label>
          Type <code>{cachePrefix}</code> to confirm clearing this scope
          <input
            type="text"
            value={cacheConfirm}
            onChange={(e) => setCacheConfirm(e.target.value)}
            placeholder={cachePrefix}
            style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
          />
        </label>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!canClearCache}
          style={{ marginTop: '0.75rem' }}
          onClick={() => void clearCachePrefix()}
        >
          Clear selected scope
        </button>
      </div>

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

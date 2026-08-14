import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

export interface IndexRegistryDef {
  label: string;
  csv: string;
  mwPatterns: string[];
  bounds?: { min: number; max: number } | null;
}

export interface IndexStatusRow {
  key: string;
  label: string;
  count: number;
  importedAt: string | null;
  ageDays: number | null;
  stale: boolean;
  csv?: string | null;
  mwPatterns?: string[];
  bounds?: { min: number; max: number } | null;
  registered?: boolean;
}

type Props = {
  indices: IndexStatusRow[];
  definitions: Record<string, IndexRegistryDef>;
  loading: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
  onSaved: () => Promise<void>;
  onSyncDisk: () => void;
};

type DraftRow = {
  key: string;
  label: string;
  csv: string;
  mwPatterns: string;
  boundsMin: string;
  boundsMax: string;
};

function toDraft(key: string, def: IndexRegistryDef): DraftRow {
  return {
    key,
    label: def.label,
    csv: def.csv,
    mwPatterns: (def.mwPatterns ?? []).join(', '),
    boundsMin: def.bounds?.min != null ? String(def.bounds.min) : '',
    boundsMax: def.bounds?.max != null ? String(def.bounds.max) : '',
  };
}

export function AdminIndicesPanel({
  indices,
  definitions,
  loading,
  onBusy,
  onMessage,
  onError,
  onSaved,
  onSyncDisk,
}: Props) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [uploadKey, setUploadKey] = useState('');
  const [indexFile, setIndexFile] = useState<File | null>(null);

  useEffect(() => {
    const draft = Object.entries(definitions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, def]) => toDraft(key, def));
    setRows(draft);
  }, [definitions]);

  const statusByKey = useMemo(() => new Map(indices.map((i) => [i.key, i])), [indices]);

  function updateRow(idx: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: '', label: '', csv: '', mwPatterns: '', boundsMin: '', boundsMax: '' },
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveRegistry(e: FormEvent) {
    e.preventDefault();
    const definitionsNext: Record<string, IndexRegistryDef> = {};
    for (const row of rows) {
      const key = row.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!key) {
        onError('Each index needs a key (e.g. nifty50)');
        return;
      }
      if (definitionsNext[key]) {
        onError(`Duplicate index key: ${key}`);
        return;
      }
      const label = row.label.trim() || key;
      const csv = row.csv.trim();
      if (!csv) {
        onError(`${key}: CSV filename required`);
        return;
      }
      const mwPatterns = row.mwPatterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const min = row.boundsMin.trim() ? Number(row.boundsMin) : NaN;
      const max = row.boundsMax.trim() ? Number(row.boundsMax) : NaN;
      const bounds =
        Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
          ? { min, max }
          : undefined;
      definitionsNext[key] = {
        label,
        csv,
        mwPatterns,
        ...(bounds ? { bounds } : {}),
      };
    }
    if (Object.keys(definitionsNext).length === 0) {
      onError('Keep at least one index definition');
      return;
    }

    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ indices: { version: 1, definitions: definitionsNext } }),
      });
      onMessage(`Index registry saved (${Object.keys(definitionsNext).length} indices)`);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save index registry');
    } finally {
      onBusy(false);
    }
  }

  async function resetRegistry() {
    if (!confirm('Reset index registry overrides to config/indices.yaml?')) return;
    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ indices: null }),
      });
      onMessage('Index registry reset to YAML defaults');
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      onBusy(false);
    }
  }

  async function uploadIndex(e: FormEvent) {
    e.preventDefault();
    if (!indexFile) {
      onError('Choose a CSV file first');
      return;
    }
    onBusy(true);
    onError('');
    onMessage('');
    try {
      const form = new FormData();
      form.append('file', indexFile);
      const qs = uploadKey ? `?indexKey=${encodeURIComponent(uploadKey)}` : '';
      const token = localStorage.getItem('sv_access_token');
      const res = await fetch(`/api/v1/admin/indices/upload${qs}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onMessage(`Synced ${data.count ?? data.imported ?? 0} symbol(s) → ${data.indexKey ?? uploadKey}`);
      setIndexFile(null);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      onBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="admin-card-head">
          <h2 style={{ margin: 0 }}>Index universes</h2>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={onSyncDisk}>
            Sync from disk
          </button>
        </div>
        <p className="muted">
          Registry is dynamic — edit keys below or in <code>config/indices.yaml</code>. Sync creates/updates
          builtin universes automatically.
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
                  <td>
                    {row.label}
                    <br />
                    <code>{row.key}</code>
                    {!row.registered && <span className="muted"> · unregistered</span>}
                  </td>
                  <td>{row.count}</td>
                  <td>
                    {row.importedAt
                      ? `${new Date(row.importedAt).toLocaleDateString()} (${row.ageDays ?? 0}d)`
                      : '—'}
                  </td>
                  <td>
                    {!row.registered
                      ? 'orphan'
                      : row.count === 0
                        ? 'empty'
                        : row.stale
                          ? 'stale'
                          : 'ok'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form className="card" onSubmit={saveRegistry}>
        <div className="admin-card-head">
          <h2 style={{ margin: 0 }}>Index registry</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={addRow}>
              Add index
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void resetRegistry()}>
              Reset to YAML
            </button>
          </div>
        </div>
        <p className="muted">
          Key · label · canonical CSV · MW patterns (comma-separated) · optional symbol bounds.
        </p>

        <div className="admin-index-registry">
          {rows.map((row, idx) => {
            const live = statusByKey.get(row.key.trim());
            return (
              <div key={`${row.key}-${idx}`} className="admin-index-row">
                <div className="admin-index-row-grid">
                  <label>
                    Key
                    <input
                      value={row.key}
                      onChange={(e) => updateRow(idx, { key: e.target.value })}
                      placeholder="nifty50"
                    />
                  </label>
                  <label>
                    Label
                    <input
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      placeholder="Nifty 50"
                    />
                  </label>
                  <label>
                    CSV file
                    <input
                      value={row.csv}
                      onChange={(e) => updateRow(idx, { csv: e.target.value })}
                      placeholder="ind_nifty50list.csv"
                    />
                  </label>
                  <label>
                    Bounds min
                    <input
                      type="number"
                      value={row.boundsMin}
                      onChange={(e) => updateRow(idx, { boundsMin: e.target.value })}
                      placeholder="45"
                    />
                  </label>
                  <label>
                    Bounds max
                    <input
                      type="number"
                      value={row.boundsMax}
                      onChange={(e) => updateRow(idx, { boundsMax: e.target.value })}
                      placeholder="55"
                    />
                  </label>
                </div>
                <label>
                  MW-NIFTY patterns
                  <input
                    value={row.mwPatterns}
                    onChange={(e) => updateRow(idx, { mwPatterns: e.target.value })}
                    placeholder="MW-NIFTY-50-, MW-NIFTY50-"
                  />
                </label>
                <div className="admin-index-row-foot">
                  <span className="muted">
                    {live
                      ? `${live.count} symbols in DB`
                      : row.key
                        ? 'not synced yet'
                        : 'new'}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => removeRow(idx)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.85rem' }}>
          Save index registry
        </button>
      </form>

      <form className="card" onSubmit={uploadIndex}>
        <h2 style={{ marginTop: 0 }}>Upload index CSV</h2>
        <p className="muted">
          Filename is auto-detected from registry patterns. Override key if the name is nonstandard.
        </p>
        <label>
          Index key (optional override)
          <select
            value={uploadKey}
            onChange={(e) => setUploadKey(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
          >
            <option value="">Auto-detect from filename</option>
            {rows
              .filter((r) => r.key.trim())
              .map((r) => (
                <option key={r.key} value={r.key.trim()}>
                  {r.label || r.key} ({r.key.trim()})
                </option>
              ))}
          </select>
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setIndexFile(e.target.files?.[0] ?? null)}
          style={{ display: 'block', marginTop: '0.75rem' }}
        />
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          Upload index CSV
        </button>
      </form>
    </>
  );
}

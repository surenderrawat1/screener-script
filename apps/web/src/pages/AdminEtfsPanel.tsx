import { FormEvent, useEffect, useState } from 'react';
import { api, getToken } from '../api';

export interface EtfDraft {
  symbol: string;
  name: string;
  category: string;
  underlying: string;
  ter_pct: string;
  liquidity: string;
  radar: boolean;
  note: string;
}

const CATEGORIES = [
  { id: 'index', label: 'Index' },
  { id: 'sector', label: 'Sector' },
  { id: 'thematic', label: 'Thematic' },
  { id: 'commodity', label: 'Commodity' },
  { id: 'global', label: 'Global' },
];

const LIQUIDITIES = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

type Props = {
  entries: Array<{
    symbol: string;
    name: string;
    category: string;
    underlying: string;
    ter_pct: number;
    liquidity: string;
    radar?: boolean;
    note?: string;
  }>;
  loading: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
  onSaved: () => Promise<void>;
};

function toDraft(row: Props['entries'][number]): EtfDraft {
  return {
    symbol: row.symbol,
    name: row.name,
    category: row.category || 'index',
    underlying: row.underlying ?? '',
    ter_pct: row.ter_pct != null ? String(row.ter_pct) : '0.05',
    liquidity: row.liquidity || 'medium',
    radar: row.radar ?? row.liquidity === 'high',
    note: row.note ?? '',
  };
}

const SAMPLE_CSV = `symbol,name,category,underlying,ter_pct,liquidity,radar,note
NIFTYBEES,Nifty 50 BeES,index,Nifty 50,0.05,high,true,
GOLDBEES,Gold BeES,commodity,Gold,0.80,high,true,
ITBEES,Nifty IT BeES,sector,Nifty IT,0.12,high,true,
`;

export function AdminEtfsPanel({ entries, loading, onBusy, onMessage, onError, onSaved }: Props) {
  const [rows, setRows] = useState<EtfDraft[]>([]);
  const [etfFile, setEtfFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'merge' | 'replace'>('merge');

  useEffect(() => {
    setRows(entries.map(toDraft));
  }, [entries]);

  function updateRow(idx: number, patch: Partial<EtfDraft>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        symbol: '',
        name: '',
        category: 'index',
        underlying: '',
        ter_pct: '0.05',
        liquidity: 'high',
        radar: true,
        note: '',
      },
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveList(e: FormEvent) {
    e.preventDefault();
    const next: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const symbol = row.symbol.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
      if (!symbol) {
        onError('Each ETF needs a Yahoo/NSE symbol (e.g. NIFTYBEES)');
        return;
      }
      if (seen.has(symbol)) {
        onError(`Duplicate ETF symbol: ${symbol}`);
        return;
      }
      seen.add(symbol);
      const ter = Number(row.ter_pct);
      next.push({
        symbol,
        name: row.name.trim() || symbol,
        category: row.category,
        underlying: row.underlying.trim(),
        ter_pct: Number.isFinite(ter) && ter >= 0 ? ter : 0,
        liquidity: row.liquidity,
        radar: Boolean(row.radar),
        note: row.note.trim() || undefined,
      });
    }
    if (next.length === 0) {
      onError('Keep at least one ETF');
      return;
    }
    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ etfs: { version: 1, entries: next } }),
      });
      onMessage(`ETF list saved (${next.length} names)`);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save ETF list');
    } finally {
      onBusy(false);
    }
  }

  async function resetList() {
    if (!confirm('Reset ETF list overrides to config/etfs.yaml?')) return;
    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ etfs: null }),
      });
      onMessage('ETF list reset to YAML defaults');
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      onBusy(false);
    }
  }

  const radarCount = rows.filter((r) => r.radar).length;

  async function uploadCsv(e: FormEvent) {
    e.preventDefault();
    if (!etfFile) {
      onError('Choose a CSV file first');
      return;
    }
    onBusy(true);
    onError('');
    onMessage('');
    try {
      const form = new FormData();
      form.append('file', etfFile);
      const token = getToken();
      const res = await fetch(`/api/v1/admin/uploads/etfs?mode=${uploadMode}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const imported = data.imported ?? 0;
      const total = data.total ?? imported;
      onMessage(
        uploadMode === 'replace'
          ? `Replaced ETF list with ${imported} CSV row(s)`
          : `Merged ${imported} CSV row(s) → ${total} ETF(s)`,
      );
      setEtfFile(null);
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'ETF CSV upload failed');
    } finally {
      onBusy(false);
    }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etfs-sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
    <form className="card" onSubmit={(e) => void saveList(e)}>
      <div className="admin-card-head">
        <h2 style={{ margin: 0 }}>ETF list</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={addRow}>
            Add ETF
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void resetList()}>
            Reset to YAML
          </button>
          <button type="submit" className="btn btn-sm" disabled={loading}>
            {loading ? 'Saving…' : 'Save ETF list'}
          </button>
        </div>
      </div>
      <p className="muted">
        Used by Morning ETF panel, swing <code>swing_etf</code> universe, and Intraday radar chips.
        Tick <strong>Radar</strong> to show a name on <code>/intraday</code> ({radarCount} selected). Defaults live in{' '}
        <code>config/etfs.yaml</code>.
      </p>

      <div className="admin-index-registry">
        {rows.map((row, idx) => (
          <div key={`${row.symbol}-${idx}`} className="admin-index-row">
            <div className="admin-index-row-grid">
              <label>
                Symbol
                <input
                  value={row.symbol}
                  onChange={(e) => updateRow(idx, { symbol: e.target.value.toUpperCase() })}
                  placeholder="NIFTYBEES"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
              <label>
                Name
                <input
                  value={row.name}
                  onChange={(e) => updateRow(idx, { name: e.target.value })}
                  placeholder="Nifty 50 BeES"
                />
              </label>
              <label>
                Category
                <select value={row.category} onChange={(e) => updateRow(idx, { category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Underlying
                <input
                  value={row.underlying}
                  onChange={(e) => updateRow(idx, { underlying: e.target.value })}
                  placeholder="Nifty 50"
                />
              </label>
              <label>
                TER %
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={row.ter_pct}
                  onChange={(e) => updateRow(idx, { ter_pct: e.target.value })}
                />
              </label>
              <label>
                Liquidity
                <select value={row.liquidity} onChange={(e) => updateRow(idx, { liquidity: e.target.value })}>
                  {LIQUIDITIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <input value={row.note} onChange={(e) => updateRow(idx, { note: e.target.value })} placeholder="Optional" />
              </label>
              <label className="admin-etf-radar">
                Radar
                <input
                  type="checkbox"
                  checked={row.radar}
                  onChange={(e) => updateRow(idx, { radar: e.target.checked })}
                />
              </label>
            </div>
            <div className="admin-index-row-foot">
              <span className="muted">{row.symbol || 'New ETF'}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => removeRow(idx)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </form>

      <form className="card" onSubmit={(e) => void uploadCsv(e)}>
        <h2 style={{ marginTop: 0 }}>Upload ETF CSV</h2>
        <p className="muted">
          Same pattern as NSE equity: a <code>symbol</code> (or <code>ticker</code>) column is enough.
          Optional columns: <code>name</code>, <code>category</code> (index/sector/thematic/commodity/global),{' '}
          <code>underlying</code>, <code>ter_pct</code>, <code>liquidity</code> (high/medium/low),{' '}
          <code>radar</code> (true/false), <code>note</code>. Merge keeps existing names and adds new symbols;
          replace overwrites the live list.
        </p>
        <label>
          Upload mode
          <select
            value={uploadMode}
            onChange={(e) => setUploadMode(e.target.value === 'replace' ? 'replace' : 'merge')}
            style={{ display: 'block', width: '100%', marginTop: '0.35rem' }}
          >
            <option value="merge">Merge into current list</option>
            <option value="replace">Replace entire list</option>
          </select>
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setEtfFile(e.target.files?.[0] ?? null)}
          style={{ display: 'block', marginTop: '0.75rem' }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <button type="submit" className="btn" disabled={loading}>
            Upload ETF CSV
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={downloadSample}>
            Download sample CSV
          </button>
        </div>
      </form>
    </>
  );
}

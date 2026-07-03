import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { ScreenerResults } from '../components/screener/ScreenerResults';
import type { ScreenerRow } from '../lib/screener-export';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface ScreenerPreset {
  id: string;
  label: string;
  filters: Record<string, number>;
  description?: string;
}

interface CustomFilters {
  min_roe: string;
  min_roce: string;
  min_mos: string;
  max_pe: string;
  min_promoter_holding: string;
}

const EMPTY_FILTERS: CustomFilters = {
  min_roe: '',
  min_roce: '',
  min_mos: '',
  max_pe: '',
  min_promoter_holding: '',
};

function parseFilterNum(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function filtersFromPreset(preset: ScreenerPreset | undefined): CustomFilters {
  if (!preset?.filters) return { ...EMPTY_FILTERS };
  const f = preset.filters;
  return {
    min_roe: f.min_roe != null ? String(f.min_roe) : '',
    min_roce: f.min_roce != null ? String(f.min_roce) : '',
    min_mos: f.min_mos != null ? String(f.min_mos) : '',
    max_pe: f.max_pe != null ? String(f.max_pe) : '',
    min_promoter_holding: f.min_promoter_holding != null ? String(f.min_promoter_holding) : '',
  };
}

function buildApiFilters(custom: CustomFilters): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  const minRoe = parseFilterNum(custom.min_roe);
  const minRoce = parseFilterNum(custom.min_roce);
  const minMos = parseFilterNum(custom.min_mos);
  const maxPe = parseFilterNum(custom.max_pe);
  const minProm = parseFilterNum(custom.min_promoter_holding);
  if (minRoe !== undefined) out.min_roe = minRoe;
  if (minRoce !== undefined) out.min_roce = minRoce;
  if (minMos !== undefined) out.min_mos = minMos;
  if (maxPe !== undefined) out.max_pe = maxPe;
  if (minProm !== undefined) out.min_promoter_holding = minProm;
  return Object.keys(out).length ? out : undefined;
}

export default function ScreenerPage() {
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [presets, setPresets] = useState<ScreenerPreset[]>([]);
  const [universe, setUniverse] = useState('nifty50');
  const [preset, setPreset] = useState('quality');
  const [maxScan, setMaxScan] = useState(200);
  const [background, setBackground] = useState(false);
  const [excludeRestricted, setExcludeRestricted] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState<{ as_of: string; total: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [customFilters, setCustomFilters] = useState<CustomFilters>({ ...EMPTY_FILTERS });
  const [filtersTouched, setFiltersTouched] = useState(false);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [scanMeta, setScanMeta] = useState<{
    total: number;
    scanned?: number;
    passed: number;
    restricted_skipped?: number;
    cache_hits?: number;
    exchange_list_as_of?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; passed: number; phase?: string } | null>(
    null,
  );

  const activePreset = useMemo(() => presets.find((p) => p.id === preset), [presets, preset]);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => setUniverses(r.universes))
      .catch(() => {});
    api<{ presets: ScreenerPreset[] }>('/api/v1/screener/presets')
      .then((r) => setPresets(r.presets))
      .catch(() => {});
    api<{ exchange_lists: { as_of: string; total: number } }>('/api/v1/screener/exchange-lists')
      .then((r) => setExchangeMeta(r.exchange_lists))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!filtersTouched && activePreset) {
      setCustomFilters(filtersFromPreset(activePreset));
    }
  }, [activePreset, filtersTouched]);

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
    try {
      const res = await api<{
        job: {
          status: string;
          result?: {
            rows: ScreenerRow[];
            total?: number;
            scanned?: number;
            passed?: number;
            restricted_skipped?: number;
            cache_hits?: number;
            exchange_list_as_of?: string;
          };
          progress?: typeof progress;
        };
      }>(`/api/v1/screener/jobs/${id}`);
      if (res.job.progress) setProgress(res.job.progress as typeof progress);
      if (res.job.status === 'done' && res.job.result?.rows) {
        setRows(res.job.result.rows);
        setScanMeta({
          total: res.job.result.total ?? res.job.progress?.total ?? res.job.result.rows.length,
          scanned: res.job.result.scanned,
          passed: res.job.result.passed ?? res.job.result.rows.length,
          restricted_skipped: res.job.result.restricted_skipped,
          cache_hits: res.job.result.cache_hits,
          exchange_list_as_of: res.job.result.exchange_list_as_of,
        });
        setLoading(false);
      }
      if (res.job.status === 'failed') {
        setError('Screener job failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Poll failed');
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setRows([]);
    setScanMeta(null);
    setJobId(null);
    setProgress(null);

    const filters = buildApiFilters(customFilters);

    try {
      const res = await api<{
        jobId: string;
        background: boolean;
        status: string;
      }>('/api/v1/screener/run', {
        method: 'POST',
        body: JSON.stringify({
          universe,
          preset,
          maxScan,
          background: background || undefined,
          exclude_restricted: excludeRestricted,
          refresh: refresh || undefined,
          filters,
        }),
      });

      setJobId(res.jobId);
      if (res.status === 'done') {
        await pollJob(res.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screener failed');
      setLoading(false);
    }
  }

  const progressPct = progress?.total ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <Page>
      <PageHeader
        title="CFA Screener"
        subtitle="Universe scan · live fundamentals · MOS & quality filters"
        actions={
          <Link to="/verify/full" className="btn btn-secondary">
            Full Verify
          </Link>
        }
      />
      <p className="disclaimer">
        Screening is research assistance — run <Link to="/verify">Quick Verify</Link> or{' '}
        <Link to="/verify/full">Full Verify</Link> before allocating.
      </p>

      <form className="card screener-form" onSubmit={onSubmit}>
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
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                setFiltersTouched(false);
              }}
              style={{ width: '100%' }}
            >
              {presets.length > 0 ? (
                presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))
              ) : (
                <option value="quality">Quality</option>
              )}
            </select>
            {activePreset?.description ? (
              <span className="muted screener-preset-hint">{activePreset.description}</span>
            ) : null}
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

        <div className="screener-form-options">
          <label className="morning-live-toggle">
            <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
            Force background job
          </label>
          <label className="morning-live-toggle" title="Skip NSE ASM, GSM, and T2T surveillance lists">
            <input
              type="checkbox"
              checked={excludeRestricted}
              onChange={(e) => setExcludeRestricted(e.target.checked)}
            />
            Exclude ASM/GSM/T2T
            {exchangeMeta?.total ? (
              <span className="muted"> ({exchangeMeta.total} symbols · as of {exchangeMeta.as_of || '—'})</span>
            ) : null}
          </label>
          <label className="morning-live-toggle">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
            Bypass cache
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            {showFilters ? 'Hide filters' : 'Custom filters'}
          </button>
        </div>

        {showFilters && (
          <div className="screener-filters card nested">
            <p className="muted" style={{ marginTop: 0 }}>
              Override preset thresholds. Empty fields are ignored.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label>Min ROE %</label>
                <input
                  type="number"
                  step="0.5"
                  value={customFilters.min_roe}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setCustomFilters((f) => ({ ...f, min_roe: e.target.value }));
                  }}
                />
              </div>
              <div className="form-group">
                <label>Min ROCE %</label>
                <input
                  type="number"
                  step="0.5"
                  value={customFilters.min_roce}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setCustomFilters((f) => ({ ...f, min_roce: e.target.value }));
                  }}
                />
              </div>
              <div className="form-group">
                <label>Min MOS %</label>
                <input
                  type="number"
                  step="1"
                  value={customFilters.min_mos}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setCustomFilters((f) => ({ ...f, min_mos: e.target.value }));
                  }}
                />
              </div>
              <div className="form-group">
                <label>Max P/E</label>
                <input
                  type="number"
                  step="0.5"
                  value={customFilters.max_pe}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setCustomFilters((f) => ({ ...f, max_pe: e.target.value }));
                  }}
                />
              </div>
              <div className="form-group">
                <label>Min promoter %</label>
                <input
                  type="number"
                  step="0.5"
                  value={customFilters.min_promoter_holding}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setCustomFilters((f) => ({ ...f, min_promoter_holding: e.target.value }));
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setFiltersTouched(false);
                setCustomFilters(filtersFromPreset(activePreset));
              }}
            >
              Reset to preset
            </button>
          </div>
        )}

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Running…' : 'Run screener'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {progress && loading && (
        <div className="card screener-progress">
          <div className="screener-progress-header">
            <span>
              {progress.phase === 'done' ? 'Complete' : 'Scanning'} — {progress.processed}/{progress.total} symbols
            </span>
            <span className="muted">
              {progress.passed} passed · {progressPct}%
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <ScreenerResults
          rows={rows}
          scanned={scanMeta?.scanned ?? scanMeta?.total}
          passed={scanMeta?.passed}
          restrictedSkipped={scanMeta?.restricted_skipped}
          cacheHits={scanMeta?.cache_hits}
          exchangeListAsOf={scanMeta?.exchange_list_as_of}
        />
      )}
    </Page>
  );
}

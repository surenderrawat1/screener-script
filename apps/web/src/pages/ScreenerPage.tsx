import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { ScreenerResults } from '../components/screener/ScreenerResults';
import { sortConfigFromPreset, type ScreenerRow } from '../lib/screener-export';
import { screenerDeepLink } from '../lib/screener-deep-link';
import {
  EMPTY_TA_PRESET,
  buildTaPresetApiFilters,
  emaColumnsRelevant,
  hourlyEmaColumnsRelevant,
  taPresetFiltersActive,
  taPresetFromRecord,
  RECOMMENDATION_FILTER_OPTIONS,
  recommendationFilterFromPreset,
  type ScreenerTaPresetFilters,
} from '../lib/screener-filters';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface ScreenerPreset {
  id: string;
  label: string;
  filters: Record<string, unknown>;
  description?: string;
  ta_preset?: boolean;
  custom?: boolean;
}

const USER_PRESET_PREFIX = 'user_screener_preset:';

function isUserPreset(id: string): boolean {
  return id.startsWith(USER_PRESET_PREFIX);
}

function userPresetDbId(id: string): string {
  return id.slice(USER_PRESET_PREFIX.length);
}

interface CustomFilters {
  min_roe: string;
  min_roce: string;
  min_mos: string;
  max_pe: string;
  min_promoter_holding: string;
}

interface TechFilters {
  fresh_cross_bars: string;
  cross_above_sma20: boolean;
  cross_below_sma20: boolean;
  cross_above_sma50: boolean;
  cross_below_sma50: boolean;
  cross_above_ema20: boolean;
  cross_below_ema20: boolean;
  cross_above_ema50: boolean;
  cross_below_ema50: boolean;
  hourly_cross_above_sma20: boolean;
  hourly_cross_below_sma20: boolean;
  hourly_cross_above_sma50: boolean;
  hourly_cross_below_sma50: boolean;
  hourly_cross_above_ema20: boolean;
  hourly_cross_below_ema20: boolean;
  hourly_cross_above_ema50: boolean;
  hourly_cross_below_ema50: boolean;
}

const EMPTY_FILTERS: CustomFilters = {
  min_roe: '',
  min_roce: '',
  min_mos: '',
  max_pe: '',
  min_promoter_holding: '',
};

const EMPTY_TECH: TechFilters = {
  fresh_cross_bars: '3',
  cross_above_sma20: false,
  cross_below_sma20: false,
  cross_above_sma50: false,
  cross_below_sma50: false,
  cross_above_ema20: false,
  cross_below_ema20: false,
  cross_above_ema50: false,
  cross_below_ema50: false,
  hourly_cross_above_sma20: false,
  hourly_cross_below_sma20: false,
  hourly_cross_above_sma50: false,
  hourly_cross_below_sma50: false,
  hourly_cross_above_ema20: false,
  hourly_cross_below_ema20: false,
  hourly_cross_above_ema50: false,
  hourly_cross_below_ema50: false,
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

function techFromPreset(preset: ScreenerPreset | undefined): TechFilters {
  const out = { ...EMPTY_TECH };
  if (!preset?.filters) return out;
  for (const key of Object.keys(out) as Array<keyof TechFilters>) {
    if (key === 'fresh_cross_bars') continue;
    if (preset.filters[key] === true) out[key] = true;
  }
  if (preset.filters.fresh_cross_bars != null) {
    out.fresh_cross_bars = String(preset.filters.fresh_cross_bars);
  }
  return out;
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

function recommendationTiersForSave(filter: string): string[] | undefined {
  switch (filter) {
    case 'strong_buy':
      return ['strong_buy'];
    case 'buy':
      return ['buy'];
    case 'buy_staggered':
      return ['buy_staggered'];
    case 'buy_eligible':
      return ['strong_buy', 'buy', 'buy_staggered'];
    case 'watchlist':
      return ['watchlist'];
    case 'hold':
      return ['hold'];
    case 'avoid':
      return ['avoid'];
    default:
      return undefined;
  }
}

function buildFiltersSnapshot(
  activePreset: ScreenerPreset | undefined,
  customFilters: CustomFilters,
  techFilters: TechFilters,
  taPresetFilters: ScreenerTaPresetFilters,
  showTa: boolean,
  recommendationFilter: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(activePreset?.filters ?? {}) };
  Object.assign(out, buildApiFilters(customFilters) ?? {});
  const tech = buildTechApiFilters(techFilters);
  if (tech) Object.assign(out, tech);
  const taPreset = buildTaPresetApiFilters(taPresetFilters);
  if (taPreset) Object.assign(out, taPreset);
  if (showTa || tech || taPreset) out.show_ta = true;
  else delete out.show_ta;

  const tiers = recommendationTiersForSave(recommendationFilter);
  if (tiers) out.recommendation_tiers = tiers;
  else if (recommendationFilter) delete out.recommendation_tiers;

  return out;
}

function buildTechApiFilters(tech: TechFilters): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let anyCross = false;
  for (const [key, value] of Object.entries(tech)) {
    if (key === 'fresh_cross_bars') continue;
    if (value === true) {
      out[key] = true;
      anyCross = true;
    }
  }
  if (!anyCross) return undefined;
  const fresh = parseFilterNum(tech.fresh_cross_bars);
  out.fresh_cross_bars = fresh !== undefined ? Math.min(5, Math.max(1, fresh)) : 3;
  return out;
}

const TECH_CROSS_OPTIONS: Array<{ key: keyof TechFilters; label: string }> = [
  { key: 'cross_above_sma20', label: 'Daily · Cross ↑ SMA-20' },
  { key: 'cross_below_sma20', label: 'Daily · Cross ↓ SMA-20' },
  { key: 'cross_above_sma50', label: 'Daily · Cross ↑ SMA-50' },
  { key: 'cross_below_sma50', label: 'Daily · Cross ↓ SMA-50' },
  { key: 'cross_above_ema20', label: 'Daily · Cross ↑ EMA-20' },
  { key: 'cross_below_ema20', label: 'Daily · Cross ↓ EMA-20' },
  { key: 'cross_above_ema50', label: 'Daily · Cross ↑ EMA-50' },
  { key: 'cross_below_ema50', label: 'Daily · Cross ↓ EMA-50' },
  { key: 'hourly_cross_above_sma20', label: 'Hourly · Cross ↑ SMA-20' },
  { key: 'hourly_cross_below_sma20', label: 'Hourly · Cross ↓ SMA-20' },
  { key: 'hourly_cross_above_sma50', label: 'Hourly · Cross ↑ SMA-50' },
  { key: 'hourly_cross_below_sma50', label: 'Hourly · Cross ↓ SMA-50' },
  { key: 'hourly_cross_above_ema20', label: 'Hourly · Cross ↑ EMA-20' },
  { key: 'hourly_cross_below_ema20', label: 'Hourly · Cross ↓ EMA-20' },
  { key: 'hourly_cross_above_ema50', label: 'Hourly · Cross ↑ EMA-50' },
  { key: 'hourly_cross_below_ema50', label: 'Hourly · Cross ↓ EMA-50' },
];

export default function ScreenerPage() {
  const routeLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const autorunDone = useRef(false);
  const initialParams = useMemo(() => new URLSearchParams(routeLocation.search), [routeLocation.search]);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [presets, setPresets] = useState<ScreenerPreset[]>([]);
  const [customPresets, setCustomPresets] = useState<ScreenerPreset[]>([]);
  const [customPresetName, setCustomPresetName] = useState('');
  const [customPresetSaving, setCustomPresetSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [universe, setUniverse] = useState(initialParams.get('universe') ?? 'nifty50');
  const [preset, setPreset] = useState(initialParams.get('preset') ?? 'quality');
  const [maxScan, setMaxScan] = useState(Number(initialParams.get('maxScan') ?? 200) || 200);
  const [background, setBackground] = useState(initialParams.get('background') === '1');
  const [excludeRestricted, setExcludeRestricted] = useState(initialParams.get('exclude_restricted') !== '0');
  const [showTa, setShowTa] = useState(initialParams.get('show_ta') === '1');
  const [refresh, setRefresh] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState<{ as_of: string; total: number } | null>(null);
  const [screenerHealth, setScreenerHealth] = useState<{
    healthy: boolean;
    pages: number;
    failures: number;
    empty_pages: number;
    failure_rate: number;
    empty_rate: number;
    last_at: string;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [customFilters, setCustomFilters] = useState<CustomFilters>({ ...EMPTY_FILTERS });
  const [techFilters, setTechFilters] = useState<TechFilters>({ ...EMPTY_TECH });
  const [taPresetFilters, setTaPresetFilters] = useState<ScreenerTaPresetFilters>({ ...EMPTY_TA_PRESET });
  const [recommendationFilter, setRecommendationFilter] = useState('');
  const [filtersTouched, setFiltersTouched] = useState(false);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [scanMeta, setScanMeta] = useState<{
    total: number;
    scanned?: number;
    passed: number;
    restricted_skipped?: number;
    cache_hits?: number;
    table_prefilter_skipped?: number;
    stock_cache_hits?: number;
    full_analyzed?: number;
    exchange_list_as_of?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<
    | {
        processed: number;
        total: number;
        passed: number;
        phase?: string;
        recent_symbols?: string[];
        recent_passed_symbols?: string[];
      }
    | null
  >(null);

  const allPresets = useMemo(() => [...presets, ...customPresets], [presets, customPresets]);
  const activePreset = useMemo(() => allPresets.find((p) => p.id === preset), [allPresets, preset]);
  const presetSort = useMemo(() => sortConfigFromPreset(preset), [preset]);
  const activeUniverse = useMemo(() => universes.find((u) => u.key === universe), [universes, universe]);
  const showEmaCols = emaColumnsRelevant(techFilters, showTa);
  const showHourlyEmaCols = hourlyEmaColumnsRelevant(techFilters);


  useEffect(() => {
    if (searchParams.get('autorun') !== '1') return;
    if (autorunDone.current) return;
    if (loading) return;
    if (presets.length === 0 && customPresets.length === 0) return;
    if (!allPresets.some((p) => p.id === preset)) return;
    autorunDone.current = true;
    const form = document.querySelector('form.screener-form') as HTMLFormElement | null;
    form?.requestSubmit();
    const next = new URLSearchParams(searchParams);
    next.delete('autorun');
    setSearchParams(next, { replace: true });
  }, [loading, presets.length, customPresets.length, allPresets, preset, searchParams, setSearchParams]);

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const u = params.get('universe');
    const p = params.get('preset');
    if (u) setUniverse(u);
    if (p) setPreset(p);
    if (params.get('show_ta') === '1') setShowTa(true);
    if (params.get('exclude_restricted') === '0') setExcludeRestricted(false);
    const max = Number(params.get('maxScan') ?? '');
    if (Number.isFinite(max) && max > 0) setMaxScan(max);
  }, [routeLocation.search]);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => setUniverses(r.universes))
      .catch(() => {});
    api<{ presets: ScreenerPreset[] }>('/api/v1/screener/presets')
      .then((r) => setPresets(r.presets))
      .catch(() => {});
    api<{ count: number; presets: ScreenerPreset[] }>('/api/v1/screener/custom-presets')
      .then((r) => setCustomPresets(r.presets.map((p) => ({ ...p, custom: true }))))
      .catch(() => {});

    api<{ exchange_lists: { as_of: string; total: number } }>('/api/v1/screener/exchange-lists')
      .then((r) => setExchangeMeta(r.exchange_lists))
      .catch(() => {});
    api<{
      health: {
        healthy: boolean;
        pages: number;
        failures: number;
        empty_pages: number;
        failure_rate: number;
        empty_rate: number;
        last_at: string;
      };
    }>('/api/v1/screener/health')
      .then((r) => setScreenerHealth(r.health))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activePreset?.custom) {
      setCustomPresetName(activePreset.label);
    } else if (!isUserPreset(preset)) {
      setCustomPresetName('');
    }
  }, [activePreset, preset]);

  async function reloadCustomPresets() {
    try {
      const r = await api<{ presets: ScreenerPreset[] }>('/api/v1/screener/custom-presets');
      setCustomPresets(r.presets.map((p) => ({ ...p, custom: true })));
    } catch {
      /* optional */
    }
  }

  async function saveCustomPreset() {
    if (!customPresetName.trim()) {
      setError('Enter a name for the custom preset.');
      return;
    }
    setCustomPresetSaving(true);
    setError('');
    try {
      const filters = buildFiltersSnapshot(
        activePreset,
        customFilters,
        techFilters,
        taPresetFilters,
        showTa,
        recommendationFilter,
      );
      const res = await api<{ id: string; key: string; name: string }>('/api/v1/strategies', {
        method: 'POST',
        body: JSON.stringify({ name: customPresetName.trim(), filters }),
      });
      await reloadCustomPresets();
      setPreset(res.key);
      setFiltersTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save preset failed');
    } finally {
      setCustomPresetSaving(false);
    }
  }

  async function updateCustomPreset() {
    if (!isUserPreset(preset)) return;
    if (!customPresetName.trim()) {
      setError('Enter a name for the custom preset.');
      return;
    }
    setCustomPresetSaving(true);
    setError('');
    try {
      const filters = buildFiltersSnapshot(
        activePreset,
        customFilters,
        techFilters,
        taPresetFilters,
        showTa,
        recommendationFilter,
      );
      const id = userPresetDbId(preset);
      await api(`/api/v1/strategies/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: customPresetName.trim(), filters }),
      });
      await reloadCustomPresets();
      setFiltersTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update preset failed');
    } finally {
      setCustomPresetSaving(false);
    }
  }

  async function deleteCustomPreset() {
    if (!isUserPreset(preset)) return;
    setCustomPresetSaving(true);
    setError('');
    try {
      await api(`/api/v1/strategies/${encodeURIComponent(userPresetDbId(preset))}`, { method: 'DELETE' });
      await reloadCustomPresets();
      setPreset('quality');
      setCustomPresetName('');
      setFiltersTouched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete preset failed');
    } finally {
      setCustomPresetSaving(false);
    }
  }

  useEffect(() => {
    if (!filtersTouched && activePreset) {
      setCustomFilters(filtersFromPreset(activePreset));
      setTaPresetFilters(taPresetFromRecord(activePreset.filters));
      if (activePreset.ta_preset || activePreset.id.startsWith('ta_') || activePreset.filters?.show_ta) {
        setTechFilters(techFromPreset(activePreset));
        setShowTa(true);
      } else {
        setTechFilters({ ...EMPTY_TECH });
      }
      setRecommendationFilter(
        recommendationFilterFromPreset(activePreset.id, activePreset.filters),
      );
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
            table_prefilter_skipped?: number;
            stock_cache_hits?: number;
            full_analyzed?: number;
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
          table_prefilter_skipped: res.job.result.table_prefilter_skipped,
          stock_cache_hits: res.job.result.stock_cache_hits,
          full_analyzed: res.job.result.full_analyzed,
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

    const filters: Record<string, unknown> = { ...(buildApiFilters(customFilters) ?? {}) };
    const tech = buildTechApiFilters(techFilters);
    const taPreset = buildTaPresetApiFilters(taPresetFilters);
    if (tech) Object.assign(filters, tech);
    if (taPreset) Object.assign(filters, taPreset);
    if (showTa || tech || taPreset) filters.show_ta = true;
    const filtersPayload = Object.keys(filters).length ? filters : undefined;

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
          recommendation_filter: recommendationFilter || undefined,
          filters: filtersPayload,
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/verify/full" className="btn btn-secondary">
              Full Verify
            </Link>
            <Link to="/screener/pit-backtest" className="btn btn-secondary">
              PIT backtest
            </Link>
          </div>
        }
      />
      {screenerHealth && !screenerHealth.healthy && screenerHealth.pages > 0 ? (
        <div className="data-quality-banner data-quality-limited" role="alert">
          <strong>Screener.in fetch stress</strong>
          <span>
            {screenerHealth.failures} fetch failures, {screenerHealth.empty_pages} empty pages (
            {(screenerHealth.failure_rate * 100).toFixed(1)}% fail rate). Fundamentals may be incomplete — try
            bypass cache or check Screener.in availability
            {screenerHealth.last_at ? ` · last sample ${screenerHealth.last_at.slice(0, 19).replace('T', ' ')} UTC` : ''}.
          </span>
        </div>
      ) : null}

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
                <>
                  <optgroup label="System presets">
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                  {customPresets.length > 0 ? (
                    <optgroup label="My presets">
                      {customPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </>
              ) : (
                <option value="quality">Quality</option>
              )}
            </select>
            {activePreset?.description ? (
              <span className="muted screener-preset-hint">{activePreset.description}</span>
            ) : null}
          </div>
          <div className="form-group">
            <label>Recommendation</label>
            <select
              value={recommendationFilter}
              onChange={(e) => {
                setFiltersTouched(true);
                setRecommendationFilter(e.target.value);
              }}
              style={{ width: '100%' }}
            >
              {Object.entries(RECOMMENDATION_FILTER_OPTIONS).map(([value, label]) => (
                <option key={value || 'all'} value={value}>
                  {label}
                </option>
              ))}
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
          <label className="morning-live-toggle" title="Attach daily TA metrics to each row">
            <input type="checkbox" checked={showTa} onChange={(e) => setShowTa(e.target.checked)} />
            Show TA columns
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
                setTechFilters(techFromPreset(activePreset));
                setTaPresetFilters(taPresetFromRecord(activePreset?.filters));
              }}
            >
              Reset to preset
            </button>
          </div>
        )}

        <details
          className="screener-filters card nested"
          style={{ marginTop: '0.75rem' }}
          open={taPresetFiltersActive(taPresetFilters) || showTa}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            TA timing filters
            <span className="muted" style={{ fontWeight: 400 }}>
              {' '}
              — RSI, 52w zone, SMA stack, MACD, Bollinger (not in CFA score)
            </span>
          </summary>
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            Loaded from TA presets (e.g. Quality Pullback, Momentum). Override here or combine with cross filters
            below.
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>Min RSI</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={taPresetFilters.min_rsi}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, min_rsi: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>Max RSI</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={taPresetFilters.max_rsi}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, max_rsi: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>Min 52w %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                title="Price position in 52-week range (0 = near low)"
                value={taPresetFilters.min_pct_52w}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, min_pct_52w: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>Max 52w %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={taPresetFilters.max_pct_52w}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, max_pct_52w: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>Min BB %B</label>
              <input
                type="number"
                step={1}
                title="Bollinger %B: 0 = lower band, 100 = upper"
                value={taPresetFilters.min_bb_pct_b}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, min_bb_pct_b: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>Max BB %B</label>
              <input
                type="number"
                step={1}
                value={taPresetFilters.max_bb_pct_b}
                onChange={(e) => {
                  setFiltersTouched(true);
                  setTaPresetFilters((f) => ({ ...f, max_bb_pct_b: e.target.value }));
                }}
              />
            </div>
            <div className="form-group">
              <label>52w chart zone</label>
              <select
                value={taPresetFilters.zone_52w || 'any'}
                onChange={(e) => {
                  setFiltersTouched(true);
                  const v = e.target.value;
                  setTaPresetFilters((f) => ({ ...f, zone_52w: v === 'any' ? '' : v }));
                }}
              >
                <option value="any">Any position</option>
                <option value="green">Green — pullback phase</option>
                <option value="mid">Mid range (35–65%)</option>
                <option value="red">Red — rally phase</option>
              </select>
            </div>
          </div>
          <div
            className="screener-tech-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.35rem 1rem',
              marginTop: '0.5rem',
            }}
          >
            {(
              [
                ['above_sma20', 'Above SMA-20'],
                ['above_sma50', 'Above SMA-50'],
                ['above_sma200', 'Above SMA-200'],
                ['macd_bullish', 'MACD histogram > 0'],
                ['below_bb_lower', 'Below lower Bollinger'],
                ['bottom_out_hint', 'Bottom-out hint (≥3/5)'],
                ['golden_cross_50_200', 'Golden cross SMA-50/200'],
                ['death_cross_50_200', 'Death cross SMA-50/200'],
                ['golden_cross_9_50', 'Golden cross SMA-9/50'],
                ['death_cross_9_50', 'Death cross SMA-9/50'],
                ['bull_ma_stack', 'Bull MA stack (9>50>200)'],
                ['bear_ma_stack', 'Bear MA stack (9<50<200)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="morning-live-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(taPresetFilters[key])}
                  onChange={(e) => {
                    setFiltersTouched(true);
                    setTaPresetFilters((f) => ({ ...f, [key]: e.target.checked }));
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </details>

        <div className="screener-filters card nested" style={{ marginTop: '0.75rem' }}>
          <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>
            <strong>Technical filters</strong>
            <span className="muted"> — fresh price cross of SMA/EMA 20 or 50 (daily or hourly)</span>
          </p>
          <div className="form-row" style={{ alignItems: 'end' }}>
            <div className="form-group">
              <label>Fresh within (bars)</label>
              <select
                value={techFilters.fresh_cross_bars}
                onChange={(e) => setTechFilters((f) => ({ ...f, fresh_cross_bars: e.target.value }))}
                style={{ width: '100%' }}
              >
                <option value="1">1 bar (latest close only)</option>
                <option value="2">2 bars</option>
                <option value="3">3 bars (default)</option>
                <option value="5">5 bars</option>
              </select>
            </div>
          </div>
          <div
            className="screener-tech-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.35rem 1rem',
              marginTop: '0.5rem',
            }}
          >
            {TECH_CROSS_OPTIONS.map((opt) => (
              <label key={opt.key} className="morning-live-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(techFilters[opt.key])}
                  onChange={(e) =>
                    setTechFilters((f) => ({ ...f, [opt.key]: e.target.checked }))
                  }
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
            Hourly filters fetch 60m bars (slower). Combine with a fundamental preset or use TA presets like
            Fresh SMA-20 Cross.
          </p>
        </div>


        <div className="card screener-filters nested" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Save custom preset</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Save the current universe filters, TA gates, and recommendation tier as a reusable preset.
          </p>
          <div className="form-row" style={{ alignItems: 'end' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Preset name</label>
              <input
                type="text"
                value={customPresetName}
                onChange={(e) => setCustomPresetName(e.target.value)}
                placeholder="e.g. Quality + TA pullback"
                style={{ width: '100%' }}
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={customPresetSaving}
              onClick={() => void (isUserPreset(preset) ? updateCustomPreset() : saveCustomPreset())}
            >
              {customPresetSaving ? 'Saving…' : isUserPreset(preset) ? 'Update preset' : 'Save preset'}
            </button>
            {isUserPreset(preset) ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={customPresetSaving}
                onClick={() => void deleteCustomPreset()}
              >
                Delete
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const url = `${window.location.origin}${screenerDeepLink({
                  preset,
                  universe,
                  maxScan,
                  showTa,
                  excludeRestricted,
                  background,
                })}`;
                void navigator.clipboard.writeText(url).then(() => {
                  setCopiedLink(true);
                  window.setTimeout(() => setCopiedLink(false), 2000);
                }).catch(() => {});
              }}
            >
              {copiedLink ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>

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
          {progress.recent_symbols?.length ? (
            <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
              Recent scanned: {progress.recent_symbols.slice(0, 10).join(', ')}
              {progress.recent_passed_symbols?.length ? (
                <> · Passed: {progress.recent_passed_symbols.slice(0, 10).join(', ')}</>
              ) : null}
            </p>
          ) : null}
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
          tablePrefilterSkipped={scanMeta?.table_prefilter_skipped}
          stockCacheHits={scanMeta?.stock_cache_hits}
          fullAnalyzed={scanMeta?.full_analyzed}
          exchangeListAsOf={scanMeta?.exchange_list_as_of}
          jobId={jobId}
          presetSort={presetSort}
          resultsKey={jobId ?? String(rows.length)}
          showEmaColumns={showEmaCols}
          showHourlyEmaColumns={showHourlyEmaCols}
          filterStrip={{
            universeName: activeUniverse?.name ?? universe,
            presetLabel: activePreset?.label ?? preset,
            custom: customFilters,
            tech: techFilters,
            taPreset: taPresetFilters,
            showTa,
            excludeRestricted,
            recommendationFilter,
            presetHasRecommendationTiers:
              !recommendationFilter &&
              Array.isArray(activePreset?.filters?.recommendation_tiers) &&
              (activePreset?.filters?.recommendation_tiers?.length ?? 0) > 0,
          }}
        />
      )}
    </Page>
  );
}

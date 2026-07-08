import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { SwingSymbolEvaluatePanel } from '../components/swing/SwingSymbolEvaluatePanel';
import { SwingPriceChart } from '../components/swing/SwingPriceChart';
import {
  SwingUniverseHitsTable,
  type UniverseScanHit,
} from '../components/swing/SwingUniverseHitsTable';
import {
  SwingUniverseScanSummary,
  type SwingScanSummaryData,
} from '../components/swing/SwingUniverseScanSummary';
import type { SwingEvaluateResponse } from '../components/swing/types';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface ScanResultPayload {
  hits: UniverseScanHit[];
  scanned: number;
  skipped: number;
  symbols_requested?: number;
  regime?: Record<string, unknown>;
  filter_stats?: Record<string, number>;
  scan_summary?: SwingScanSummaryData;
  engine_version?: string;
  duration_ms?: number;
  source?: string;
  prefetch?: { cached: number; fetched: number };
}

interface TradingPresetResponse {
  preset: {
    scan_params?: {
      universe: string;
      min_verdict: string;
      gc9_only?: boolean;
      maxScan?: number;
      zone_52w?: string;
    };
  };
}

const RULE_OPTIONS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11'] as const;
const BACKGROUND_SCAN_THRESHOLD = 25;

export default function SwingScanPage() {
  const [searchParams] = useSearchParams();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [mode, setMode] = useState<'universe' | 'symbol'>(() =>
    searchParams.get('mode') === 'symbol' || searchParams.get('symbol') ? 'symbol' : 'universe',
  );
  const [universe, setUniverse] = useState(searchParams.get('universe') ?? 'nifty500');
  const [singleSymbol, setSingleSymbol] = useState(searchParams.get('symbol') ?? '');
  const [minVerdict, setMinVerdict] = useState('SETUP_PLUS');
  const [zone52w, setZone52w] = useState('any');
  const [gc9Only, setGc9Only] = useState(false);
  const [breakoutVolume, setBreakoutVolume] = useState(false);
  const [minRulesPassed, setMinRulesPassed] = useState('');
  const [requireRules, setRequireRules] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('swing_rank');
  const [maxScan, setMaxScan] = useState(0);
  const [backgroundScan, setBackgroundScan] = useState(true);
  const [refreshData, setRefreshData] = useState(false);
  const [hits, setHits] = useState<UniverseScanHit[]>([]);
  const [singleEval, setSingleEval] = useState<SwingEvaluateResponse | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [scanSummary, setScanSummary] = useState<SwingScanSummaryData | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [filterStats, setFilterStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [error, setError] = useState('');
  const [presetReady, setPresetReady] = useState(!searchParams.get('preset'));
  const autorunDone = useRef(false);

  const universeLabel = universes.find((u) => u.key === universe)?.name ?? universe;

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes').then((r) => setUniverses(r.universes)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const presetParam = searchParams.get('preset');
    const universeParam = searchParams.get('universe');
    const symbolParam = searchParams.get('symbol');

    if (symbolParam) {
      setMode('symbol');
      setSingleSymbol(symbolParam);
    }

    if (!presetParam) {
      if (universeParam) setUniverse(universeParam);
      setPresetReady(true);
      return;
    }

    setPresetReady(false);
    api<TradingPresetResponse>(`/api/v1/trading/presets/${encodeURIComponent(presetParam)}`)
      .then(({ preset }) => {
        const scan = preset.scan_params;
        if (universeParam) setUniverse(universeParam);
        else if (scan?.universe) setUniverse(scan.universe);
        if (scan?.min_verdict) setMinVerdict(scan.min_verdict);
        if (scan?.gc9_only) setGc9Only(true);
        if (scan?.maxScan != null) setMaxScan(scan.maxScan);
        if (scan?.zone_52w) setZone52w(scan.zone_52w);
      })
      .catch(() => undefined)
      .finally(() => setPresetReady(true));
  }, [searchParams]);

  function scanPayload() {
    const base = {
      min_verdict: minVerdict,
      zone_52w: zone52w,
      gc9_only: gc9Only,
      breakout_volume: breakoutVolume,
      sort_by: sortBy,
      min_rules_passed: minRulesPassed ? Number(minRulesPassed) : undefined,
      require_rules: requireRules.length ? requireRules : undefined,
      refresh: refreshData || undefined,
    };
    if (mode === 'symbol') {
      const sym = singleSymbol.trim().toUpperCase();
      if (!sym) throw new Error('Enter a symbol');
      return { symbols: [sym], maxScan: 1, ...base };
    }
    return { universe, ...(maxScan > 0 ? { maxScan } : {}), ...base };
  }

  function applyScanResult(result: ScanResultPayload) {
    setHits(result.hits);
    setScanSummary(result.scan_summary ?? null);
    setFilterStats(result.filter_stats ?? null);
    setMeta({
      scanned: result.scanned,
      skipped: result.skipped,
      symbols_requested: result.symbols_requested,
      regime: result.regime,
      engine_version: result.engine_version,
      duration_ms: result.duration_ms,
      source: result.source,
      prefetch: result.prefetch,
      mode: 'scan',
    });
  }

  async function pollScanJob(jobId: string): Promise<ScanResultPayload | null> {
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const res = await api<{
          job: {
            status: string;
            progress?: { processed: number; total: number; passed?: number };
            result?: ScanResultPayload;
          };
        }>(`/api/v1/screener/jobs/${jobId}`);
        const prog = res.job.progress;
        if (prog?.total) {
          setScanMessage(`Scanning ${prog.processed}/${prog.total} symbols…`);
        }
        if (res.job.status === 'done' && res.job.result) {
          return res.job.result;
        }
        if (res.job.status === 'failed') {
          throw new Error('Background scan failed');
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Background scan failed') throw err;
        break;
      }
    }
    return null;
  }

  const runScan = useCallback(async () => {
    setError('');
    setScanMessage('');
    setLoading(true);
    if (mode !== 'symbol') {
      setHits([]);
      setSingleEval(null);
      setScanSummary(null);
    }
    setFilterStats(null);
    if (mode === 'symbol') setEvalLoading(true);
    try {
      const body = scanPayload();
      if (mode === 'symbol') {
        const sym = singleSymbol.trim().toUpperCase();
        const evalRes = await api<SwingEvaluateResponse>('/api/v1/swing/evaluate', {
          method: 'POST',
          body: JSON.stringify({
            symbol: sym,
            refresh: refreshData || undefined,
            min_verdict: minVerdict,
            zone_52w: zone52w,
            gc9_only: gc9Only,
            breakout_volume: breakoutVolume,
            min_rules_passed: minRulesPassed ? Number(minRulesPassed) : undefined,
            require_rules: requireRules.length ? requireRules : undefined,
          }),
        });
        setSingleEval(evalRes);
        const entry = evalRes.entry;
        setMeta({ regime: evalRes.regime, mode: 'evaluate', as_of_date: evalRes.as_of_date });
        if (entry) {
          setHits([
            {
              symbol: String(evalRes.symbol),
              price: Number(evalRes.price),
              verdict: String(entry.discovery_verdict ?? 'AVOID'),
              strict_verdict: String(entry.strict_verdict ?? 'AVOID'),
              entry_score: Number(entry.entry_score ?? 0),
              rules_passed: Number(entry.rules_passed ?? 0),
              stop_loss: (entry.stop_loss as number | null) ?? null,
              profit_target: (entry.profit_target as number | null) ?? null,
              r_multiple: (entry.r_multiple as number | null) ?? null,
              entry_rules: entry.rules ?? [],
            },
          ]);
        }
        return;
      }

      const selectedUniverse = universes.find((u) => u.key === universe);
      const symbolEstimate = maxScan > 0 ? maxScan : selectedUniverse?.symbolCount ?? BACKGROUND_SCAN_THRESHOLD;
      const useBackground = backgroundScan && symbolEstimate >= BACKGROUND_SCAN_THRESHOLD;

      const res = await api<{
        jobId: string;
        background: boolean;
        status: string;
        result?: ScanResultPayload;
      }>('/api/v1/swing/scan', {
        method: 'POST',
        body: JSON.stringify({ ...body, background: useBackground }),
      });

      if (res.status === 'done' && res.result) {
        applyScanResult(res.result);
        const hitCount = res.result.hits.length;
        const scanned = res.result.symbols_requested ?? res.result.scanned;
        const sec = res.result.duration_ms ? (res.result.duration_ms / 1000).toFixed(1) : null;
        setScanMessage(
          sec ? `Scan done: ${hitCount} hits from ${scanned} scanned in ${sec}s.` : `Scan done: ${hitCount} hits.`,
        );
        return;
      }

      if (res.background && res.jobId) {
        setScanMessage(`Background scan queued (${symbolEstimate} symbols)…`);
        const result = await pollScanJob(res.jobId);
        if (result) {
          applyScanResult(result);
          const hitCount = result.hits.length;
          const scanned = result.symbols_requested ?? result.scanned;
          setScanMessage(`Background scan done: ${hitCount} hits from ${scanned} scanned.`);
        } else {
          setError('Scan timed out — check job status or retry with a smaller universe.');
        }
        return;
      }

      if (res.jobId) {
        const job = await api<{ job: { result?: ScanResultPayload } }>(`/api/v1/screener/jobs/${res.jobId}`);
        if (job.job.result) applyScanResult(job.job.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
      setEvalLoading(false);
    }
  }, [
    mode,
    universe,
    universes,
    singleSymbol,
    maxScan,
    minVerdict,
    zone52w,
    gc9Only,
    breakoutVolume,
    minRulesPassed,
    requireRules,
    sortBy,
    backgroundScan,
    refreshData,
  ]);

  useEffect(() => {
    if (searchParams.get('autorun') !== '1' || !presetReady || universes.length === 0 || autorunDone.current) return;
    autorunDone.current = true;
    void runScan();
  }, [searchParams, presetReady, universes.length, runScan]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await runScan();
  }

  function toggleRequireRule(id: string) {
    setRequireRules((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const activePreset = searchParams.get('preset');
  const engineLabel =
    (meta?.engine_version as string | undefined) ??
    singleEval?.engine_meta?.engine_version ??
    'v3.9-gc9';
  const evaluatedSymbol =
    singleEval?.symbol && String(singleEval.symbol).toUpperCase() === singleSymbol.trim().toUpperCase()
      ? singleSymbol.trim().toUpperCase()
      : null;

  return (
    <Page>
      <PageHeader
        title="Swing Scanner"
        subtitle="E1–E11 entry rules · universe scan · ETF · single symbol · backtest"
        actions={
          <>
            <Link to="/positions" className="btn btn-secondary">
              Positions
            </Link>
            <Link to="/swing/backtest" className="btn btn-secondary">
              Backtest
            </Link>
          </>
        }
      />
      <p className="disclaimer">
        Swing engine {engineLabel} — research signals only. Uses live NIFTYBEES regime for E4 band.
      </p>
      {activePreset && (
        <p className="muted">
          Preset: <strong>{activePreset.replace(/_/g, ' ')}</strong>
          {searchParams.get('autorun') === '1' ? ' · auto-scan' : ''}
        </p>
      )}

      <form className="card" onSubmit={onSubmit}>
        <div className="segmented" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className={mode === 'universe' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('universe')}>
            Universe
          </button>
          <button type="button" className={mode === 'symbol' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('symbol')}>
            Single symbol
          </button>
        </div>

        {mode === 'universe' ? (
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
        ) : (
          <div className="form-group">
            <label>Symbol</label>
            <input value={singleSymbol} onChange={(e) => setSingleSymbol(e.target.value.toUpperCase())} placeholder="e.g. TCS" />
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Min verdict</label>
            <select value={minVerdict} onChange={(e) => setMinVerdict(e.target.value)} style={{ width: '100%' }}>
              <option value="SETUP_PLUS">SETUP+ (discovery ENTER or SETUP)</option>
              <option value="ENTER">Strict ENTER only</option>
              <option value="WATCH">WATCH+ (all forming setups)</option>
              <option value="ALL">All scored (incl. AVOID)</option>
            </select>
          </div>
          <div className="form-group">
            <label>52w zone</label>
            <select value={zone52w} onChange={(e) => setZone52w(e.target.value)} style={{ width: '100%' }}>
              <option value="any">Any zone</option>
              <option value="green">Green (near 52w low — value / reversal)</option>
              <option value="mid">Mid (25–75% of range)</option>
              <option value="red">Red (near 52w high — breakout / momentum)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Sort by</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: '100%' }}>
              <option value="swing_rank">CFA swing rank</option>
              <option value="rules_passed">Rules passed</option>
              <option value="r_multiple">R-multiple</option>
              <option value="rsi">RSI (low first)</option>
              <option value="pct_52w">52w % (low first)</option>
              <option value="volume_ratio">Volume surge (high first)</option>
              <option value="symbol">Symbol A–Z</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Min rules passed (1–11)</label>
            <input
              type="number"
              min={1}
              max={11}
              value={minRulesPassed}
              onChange={(e) => setMinRulesPassed(e.target.value)}
              placeholder="optional"
            />
          </div>
          {mode === 'universe' && (
            <div className="form-group">
              <label>Max stocks to scan</label>
              <input
                type="number"
                min={0}
                max={2000}
                value={maxScan || ''}
                placeholder="0 = entire universe"
                onChange={(e) => setMaxScan(e.target.value === '' ? 0 : Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <fieldset className="swing-rule-checks">
          <legend className="muted">Require rules (all must pass)</legend>
          <div className="swing-rule-check-grid">
            {RULE_OPTIONS.map((id) => (
              <label key={id}>
                <input type="checkbox" checked={requireRules.includes(id)} onChange={() => toggleRequireRule(id)} />
                {id}
              </label>
            ))}
          </div>
        </fieldset>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
          <input type="checkbox" checked={gc9Only} onChange={(e) => setGc9Only(e.target.checked)} />
          GC9 entry only (E11)
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
          <input type="checkbox" checked={breakoutVolume} onChange={(e) => setBreakoutVolume(e.target.checked)} />
          Breakout + volume surge
        </label>
        {mode === 'universe' ? (
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
            <input type="checkbox" checked={backgroundScan} onChange={(e) => setBackgroundScan(e.target.checked)} />
            Background scan for large universes (recommended 25+ symbols)
          </label>
        ) : null}
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={refreshData} onChange={(e) => setRefreshData(e.target.checked)} />
          Refresh daily closes (bypass cache)
        </label>

        <button type="submit" className="btn" disabled={loading || !presetReady}>
          {loading ? 'Running…' : mode === 'symbol' ? 'Evaluate symbol' : 'Run swing scan'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {meta?.mode === 'evaluate' ? (
        <p className="muted">
          Regime {String((meta.regime as Record<string, unknown>)?.label ?? '—')}
          {meta.as_of_date ? ` · EOD ${String(meta.as_of_date)}` : ''}
          {' · '}
          <Link to={`/swing/backtest?symbol=${singleSymbol}`}>Backtest this symbol →</Link>
        </p>
      ) : null}

      {mode !== 'symbol' && meta?.mode === 'scan' ? (
        <SwingUniverseScanSummary
          universeName={universeLabel}
          scanned={Number(meta.scanned ?? 0)}
          symbolsRequested={meta.symbols_requested as number | undefined}
          durationMs={meta.duration_ms as number | undefined}
          engineVersion={engineLabel}
          regime={(meta.regime as Record<string, unknown> | null) ?? null}
          summary={scanSummary}
          filterStats={filterStats}
          scanMessage={scanMessage}
          source={meta.source as string | undefined}
          prefetch={meta.prefetch as { cached: number; fetched: number } | undefined}
        />
      ) : null}

      {filterStats && hits.length === 0 && mode !== 'symbol' && meta?.mode === 'scan' && !scanSummary ? (
        <section className="card swing-filter-stats">
          <h3 style={{ marginTop: 0 }}>No hits — filter breakdown</h3>
          <p className="muted">
            Symbols were evaluated but filtered out. Loosen min verdict, disable GC9-only, or try SETUP+ / WATCH.
          </p>
          <ul className="swing-filter-list">
            {filterStats.min_verdict > 0 && <li>Min verdict: {filterStats.min_verdict}</li>}
            {filterStats.gc9_only > 0 && <li>GC9 only (E11): {filterStats.gc9_only}</li>}
            {filterStats.entry_rules > 0 && <li>Required rules: {filterStats.entry_rules}</li>}
            {filterStats.zone_52w > 0 && <li>52w zone: {filterStats.zone_52w}</li>}
            {filterStats.breakout_volume > 0 && <li>Breakout + volume: {filterStats.breakout_volume}</li>}
            {filterStats.no_ta > 0 && <li>Insufficient TA data: {filterStats.no_ta}</li>}
            {filterStats.no_price > 0 && <li>No price: {filterStats.no_price}</li>}
          </ul>
        </section>
      ) : null}

      {hits.length === 0 && !loading && !error && meta?.mode === 'scan' && !scanMessage ? (
        <p className="muted">Run a universe scan to see SETUP+ hits ranked by swing score.</p>
      ) : null}

      {mode === 'symbol' && evaluatedSymbol ? (
        <SwingPriceChart
          symbol={evaluatedSymbol}
          defaultTimeframe="1h"
          asOfDate={singleEval?.as_of_date}
          entry={singleEval?.entry}
        />
      ) : null}

      {singleEval?.entry ? (
        <SwingSymbolEvaluatePanel evalData={singleEval} loading={evalLoading} />
      ) : evalLoading ? (
        <section className="card swing-symbol-skeleton" aria-busy="true">
          <p className="muted">Loading swing evaluation…</p>
        </section>
      ) : null}

      {hits.length > 0 && mode !== 'symbol' ? <SwingUniverseHitsTable hits={hits} /> : null}
    </Page>
  );
}

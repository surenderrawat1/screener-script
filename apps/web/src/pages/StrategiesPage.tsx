import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { canOpenStrategyInScreener, screenerDeepLinkFromStrategy } from '../lib/screener-deep-link';
import { Page, PageHeader } from '../components/PageLayout';
import { ResearchRowActions } from '../components/ResearchRowActions';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface StrategyDef {
  key: string;
  label: string;
  description: string;
  style: string;
  engine: string;
  horizon: string;
  universe_default: string;
  max_scan_default: number;
  icon: string;
  ready: boolean;
  blocked_reason?: string;
  preset?: string;
  screener_preset?: string;
}

interface ScreenerPresetInfo {
  id: string;
  label: string;
  filters: Record<string, unknown>;
  description?: string;
}

interface SwingRuleProfileInfo {
  id: string;
  name: string;
  options: Record<string, unknown>;
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

interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  pe: number;
  roe: number;
  mos: number | null;
  zone: string;
  recommendation: string;
  composite_score: number;
  ta_ready?: boolean;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_bottom_out_hint?: boolean | null;
}

type StrategyResult =
  | { engine: 'swing'; scanned: number; hits: SwingHit[]; skipped: number; label: string; universe: string }
  | {
      engine: 'screener';
      scanned: number;
      passed: number;
      rows: ScreenerRow[];
      label: string;
      universe: string;
      cache_hits?: number;
      restricted_skipped?: number;
    }
  | {
      engine: 'hybrid';
      screener_passed: number;
      scanned: number;
      hits: SwingHit[];
      skipped: number;
      label: string;
      universe: string;
    };

const STYLE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'swing', label: 'Swing' },
  { key: 'positional', label: 'Positional' },
  { key: 'hybrid', label: 'Hybrid' },
] as const;

function verdictClass(v: string): string {
  const u = v.toUpperCase();
  if (u === 'ENTER') return 'badge badge-buy';
  if (u.includes('SETUP')) return 'badge badge-hold';
  return 'badge badge-expensive';
}

function zoneClass(zone: string): string {
  if (zone.includes('Buy')) return 'badge badge-buy';
  if (zone === 'Hold' || zone === 'Accumulate') return 'badge badge-hold';
  return 'badge badge-expensive';
}

export default function StrategiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [styleTab, setStyleTab] = useState(searchParams.get('style') ?? 'all');
  const [strategies, setStrategies] = useState<StrategyDef[]>([]);
  const [styleLabels, setStyleLabels] = useState<Record<string, string>>({});
  const [readyCount, setReadyCount] = useState(0);
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [selected, setSelected] = useState(searchParams.get('strategy') ?? 'swing_strict_enter');
  const [universe, setUniverse] = useState(searchParams.get('universe') ?? '');
  const initialMax = Number(searchParams.get('max_scan') ?? searchParams.get('maxScan') ?? 0);
  const [maxScan, setMaxScan] = useState(Number.isFinite(initialMax) && initialMax > 0 ? initialMax : 0);
  const [background, setBackground] = useState(searchParams.get('background') === '1');
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const autorunDone = useRef(false);
  const urlUniverseLock = useRef(Boolean(searchParams.get('universe')));
  const urlMaxScanLock = useRef(
    Boolean(searchParams.get('max_scan') || searchParams.get('maxScan')),
  );
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
    passed: number;
    phase?: string;
    stage_label?: string;
  } | null>(null);

  const USER_PRESET_PREFIX = 'user_screener_preset:';
  const [screenerPresets, setScreenerPresets] = useState<ScreenerPresetInfo[]>([]);
  const [customName, setCustomName] = useState('');
  const [basePresetId, setBasePresetId] = useState('');
  const [customSaving, setCustomSaving] = useState(false);

  const USER_SWING_RULE_PROFILE_PREFIX = 'user_swing_rule_profile:';
  const [swingRuleProfiles, setSwingRuleProfiles] = useState<SwingRuleProfileInfo[]>([]);
  const [swingProfileName, setSwingProfileName] = useState('');
  const [swingMinVerdict, setSwingMinVerdict] = useState<'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL'>('SETUP_PLUS');
  const [swingZone52w, setSwingZone52w] = useState<string>('any');
  const [swingBreakoutVolume, setSwingBreakoutVolume] = useState(false);
  const [swingRequireRulesText, setSwingRequireRulesText] = useState(''); // comma-separated
  const [swingMinRulesPassed, setSwingMinRulesPassed] = useState<number>(0);
  const [swingRegimeJsonText, setSwingRegimeJsonText] = useState(''); // optional JSON
  const [swingProfileSaving, setSwingProfileSaving] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofRunning, setProofRunning] = useState(false);
  const [proof, setProof] = useState<{
    days: number;
    scoreboard: Array<{
      strategy_key: string;
      label: string;
      days: number;
      ok_days: number;
      avg_hits: number;
      last_hits: number;
      last_date: string;
    }>;
    runs: Array<{
      run_date: string;
      strategy_key: string;
      label: string;
      status: string;
      hit_count: number;
      scanned: number;
      top_symbols: unknown;
    }>;
  } | null>(null);

  const loadDailyProof = useCallback(async () => {
    setProofLoading(true);
    try {
      const res = await api<{
        days: number;
        scoreboard: Array<{
          strategy_key: string;
          label: string;
          days: number;
          ok_days: number;
          avg_hits: number;
          last_hits: number;
          last_date: string;
        }>;
        runs: Array<{
          run_date: string;
          strategy_key: string;
          label: string;
          status: string;
          hit_count: number;
          scanned: number;
          top_symbols: unknown;
        }>;
      }>('/api/v1/strategies/daily-proof?days=14');
      setProof(res);
    } catch {
      setProof(null);
    } finally {
      setProofLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDailyProof();
  }, [loadDailyProof]);

  function isUserPresetKey(key: string): boolean {
    return key.startsWith(USER_PRESET_PREFIX);
  }

  function isSystemStrategyKey(key: string): boolean {
    return !isUserPresetKey(key) && !isUserSwingRuleProfileKey(key);
  }

  function userPresetIdFromKey(key: string): string | null {
    if (!key.startsWith(USER_PRESET_PREFIX)) return null;
    return key.slice(USER_PRESET_PREFIX.length);
  }

  function isUserSwingRuleProfileKey(key: string): boolean {
    return key.startsWith(USER_SWING_RULE_PROFILE_PREFIX);
  }

  function userSwingRuleProfileIdFromKey(key: string): string | null {
    if (!key.startsWith(USER_SWING_RULE_PROFILE_PREFIX)) return null;
    return key.slice(USER_SWING_RULE_PROFILE_PREFIX.length);
  }

  const active = useMemo(() => strategies.find((s) => s.key === selected), [strategies, selected]);

  const loadStrategies = useCallback((style: string) => {
    const qs = style && style !== 'all' ? `?style=${encodeURIComponent(style)}` : '';
    return api<{
      strategies: StrategyDef[];
      style_labels: Record<string, string>;
      ready_count: number;
    }>(`/api/v1/strategies${qs}`).then((r) => {
      setStrategies(r.strategies);
      setStyleLabels(r.style_labels);
      setReadyCount(r.ready_count);
    });
  }, []);

  useEffect(() => {
    void loadStrategies(styleTab);
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => setUniverses(r.universes))
      .catch(() => {});

    api<{ presets: ScreenerPresetInfo[] }>('/api/v1/screener/presets')
      .then((r) => {
        setScreenerPresets(r.presets);
        if (!basePresetId && r.presets[0]?.id) setBasePresetId(r.presets[0].id);
      })
      .catch(() => {});

    api<{ profiles: SwingRuleProfileInfo[] }>('/api/v1/swing/rule-profiles')
      .then((r) => setSwingRuleProfiles(r.profiles))
      .catch(() => {});
  }, [styleTab, loadStrategies]);

  useEffect(() => {
    if (!active) return;
    if (!urlUniverseLock.current) setUniverse(active.universe_default);
    if (!urlMaxScanLock.current) setMaxScan(active.max_scan_default);

    // When switching to a user preset, prefill the name so update feels natural.
    if (isUserPresetKey(active.key)) setCustomName(active.label);
  }, [active?.key]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (styleTab !== 'all') params.set('style', styleTab);
    if (selected) params.set('strategy', selected);
    if (universe) params.set('universe', universe);
    if (maxScan > 0) params.set('max_scan', String(maxScan));
    if (background) params.set('background', '1');
    if (searchParams.get('autorun') === '1') params.set('autorun', '1');
    setSearchParams(params, { replace: true });
  }, [styleTab, selected, universe, maxScan, background, setSearchParams]);

  useEffect(() => {
    if (!active) return;
    if (!isUserSwingRuleProfileKey(active.key)) return;

    const id = userSwingRuleProfileIdFromKey(active.key);
    if (!id) return;

    const profile = swingRuleProfiles.find((p) => p.id === id);
    if (!profile) return;

    setSwingProfileName(profile.name);
    const opts = profile.options ?? {};
    setSwingMinVerdict(
      (String(opts.min_verdict ?? 'SETUP_PLUS').toUpperCase() as 'ENTER' | 'SETUP_PLUS' | 'WATCH' | 'ALL') ??
        'SETUP_PLUS',
    );
    setSwingZone52w(String(opts.zone_52w ?? 'any'));
    setSwingBreakoutVolume(Boolean(opts.breakout_volume));
    const req = Array.isArray(opts.require_rules) ? (opts.require_rules as unknown[]).map(String).join(', ') : '';
    setSwingRequireRulesText(req);
    setSwingMinRulesPassed(Number(opts.min_rules_passed ?? 0) || 0);
    setSwingRegimeJsonText(opts.regime != null ? JSON.stringify(opts.regime, null, 2) : '');
  }, [active, swingRuleProfiles]);

  useEffect(() => {
    // If a custom preset was deleted, keep selection valid.
    if (selected && !strategies.some((s) => s.key === selected)) {
      setSelected(strategies[0]?.key ?? '');
    }
  }, [strategies, selected]);

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
          result?: StrategyResult;
          error?: string;
          progress?: typeof progress;
        };
      }>(`/api/v1/strategies/jobs/${id}`);
      if (res.job.progress) setProgress(res.job.progress as typeof progress);
      if (res.job.status === 'done' && res.job.result) {
        setResult(res.job.result);
        setLoading(false);
      }
      if (res.job.status === 'failed') {
        setError(res.job.error ?? 'Strategy job failed');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Poll failed');
      setLoading(false);
    }
  }

  async function runSelectedStrategy() {
    if (!active?.ready) return;
    setError('');
    setActionMsg('');
    setLoading(true);
    setResult(null);
    setJobId(null);
    setProgress(null);
    try {
      const res = await api<StrategyResult | { jobId: string; background: boolean; status: string }>(
        '/api/v1/strategies/run',
        {
          method: 'POST',
          body: JSON.stringify({
            strategy: selected,
            universe: universe || undefined,
            maxScan: maxScan > 0 ? maxScan : undefined,
            background: background || undefined,
          }),
        },
      );
      if ('jobId' in res && res.background) {
        setJobId(res.jobId);
        await pollJob(res.jobId);
        return;
      }
      setResult(res as StrategyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Strategy run failed');
    } finally {
      setLoading(false);
    }
  }

  async function onRun(e: FormEvent) {
    e.preventDefault();
    await runSelectedStrategy();
  }

  async function copyRunLink() {
    const params = new URLSearchParams();
    if (styleTab !== 'all') params.set('style', styleTab);
    if (selected) params.set('strategy', selected);
    if (universe) params.set('universe', universe);
    if (maxScan > 0) params.set('max_scan', String(maxScan));
    if (background) params.set('background', '1');
    params.set('autorun', '1');
    const url = `${window.location.origin}/strategies?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  }

  useEffect(() => {
    if (searchParams.get('autorun') !== '1') return;
    if (autorunDone.current) return;
    if (!active?.ready || loading || universes.length === 0 || !strategies.length) return;
    if (urlUniverseLock.current && !universe) return;
    autorunDone.current = true;
    void runSelectedStrategy();
    // Strip autorun so refresh does not re-fire.
    const next = new URLSearchParams(searchParams);
    next.delete('autorun');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep-link autorun
  }, [active?.ready, strategies.length, universes.length, universe, loading]);

  async function saveCustomPreset() {
    if (!customName.trim()) {
      setError('Enter a name for the custom preset.');
      return;
    }
    const base = screenerPresets.find((p) => p.id === basePresetId);
    if (!base) {
      setError('Pick a base screener preset.');
      return;
    }

    setCustomSaving(true);
    setError('');
    try {
      await api('/api/v1/strategies', {
        method: 'POST',
        body: JSON.stringify({ name: customName.trim(), filters: base.filters }),
      });
      setCustomName('');
      await loadStrategies(styleTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setCustomSaving(false);
    }
  }

  async function deleteActiveCustomPreset() {
    const id = active ? userPresetIdFromKey(active.key) : null;
    if (!id) return;
    setCustomSaving(true);
    setError('');
    try {
      await api(`/api/v1/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSelected('');
      await loadStrategies(styleTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setCustomSaving(false);
    }
  }

  async function updateActiveCustomPreset() {
    if (!active) return;
    const id = userPresetIdFromKey(active.key);
    if (!id) return;

    const base = screenerPresets.find((p) => p.id === basePresetId);
    if (!base) {
      setError('Pick a base screener preset.');
      return;
    }
    if (!customName.trim()) {
      setError('Enter a custom name.');
      return;
    }

    setCustomSaving(true);
    setError('');
    try {
      await api(`/api/v1/strategies/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: customName.trim(), filters: base.filters }),
      });
      await loadStrategies(styleTab);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setCustomSaving(false);
    }
  }

  function parseRequireRules(text: string): string[] {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveOrUpdateSwingRuleProfile() {
    if (swingProfileName.trim().length === 0) {
      setError('Enter a name for the swing rule profile.');
      return;
    }

    let regime: Record<string, unknown> | undefined;
    const regimeText = swingRegimeJsonText.trim();
    if (regimeText) {
      try {
        regime = JSON.parse(regimeText);
      } catch {
        setError('Regime override must be valid JSON.');
        return;
      }
    }

    const options: Record<string, unknown> = {
      min_verdict: swingMinVerdict,
      zone_52w: swingZone52w,
    };
    if (swingBreakoutVolume) options.breakout_volume = true;

    const require_rules = parseRequireRules(swingRequireRulesText);
    if (require_rules.length) options.require_rules = require_rules;

    if (swingMinRulesPassed > 0) options.min_rules_passed = swingMinRulesPassed;
    if (regime !== undefined) options.regime = regime;

    setSwingProfileSaving(true);
    setError('');
    try {
      const activeId =
        active && isUserSwingRuleProfileKey(active.key) ? userSwingRuleProfileIdFromKey(active.key) : null;
      if (activeId) {
        await api(`/api/v1/swing/rule-profiles/${encodeURIComponent(activeId)}`, {
          method: 'PUT',
          body: JSON.stringify({ name: swingProfileName.trim(), options }),
        });
      } else {
        await api('/api/v1/swing/rule-profiles', {
          method: 'POST',
          body: JSON.stringify({ name: swingProfileName.trim(), options }),
        });
      }

      await loadStrategies(styleTab);
      const r = await api<{ profiles: SwingRuleProfileInfo[] }>('/api/v1/swing/rule-profiles');
      setSwingRuleProfiles(r.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSwingProfileSaving(false);
    }
  }

  async function deleteActiveSwingRuleProfile() {
    if (!active || !isUserSwingRuleProfileKey(active.key)) return;
    const id = userSwingRuleProfileIdFromKey(active.key);
    if (!id) return;

    setSwingProfileSaving(true);
    setError('');
    try {
      await api(`/api/v1/swing/rule-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSelected('');
      await loadStrategies(styleTab);
      const r = await api<{ profiles: SwingRuleProfileInfo[] }>('/api/v1/swing/rule-profiles');
      setSwingRuleProfiles(r.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSwingProfileSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Trading Strategies"
        subtitle={`${readyCount} ready · 22 curated swing, positional & hybrid filters`}
        actions={
          <Link to="/presets" className="btn btn-secondary">
            Daily presets
          </Link>
        }
      />
      <p className="disclaimer">
        Routes to swing scanner or CFA screener engines — verify on NSE before orders.
      </p>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Daily live proof</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void loadDailyProof()} disabled={proofLoading}>
              {proofLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={proofRunning}
              onClick={() => {
                setProofRunning(true);
                void api('/api/v1/strategies/daily-proof/run', {
                  method: 'POST',
                  body: JSON.stringify({ force: true }),
                })
                  .then(() => loadDailyProof())
                  .catch((err) => setError(err instanceof Error ? err.message : 'Daily proof run failed'))
                  .finally(() => setProofRunning(false));
              }}
            >
              {proofRunning ? 'Running…' : 'Run now'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Worker runs a curated strategy allowlist at 16:15 IST and stores hit counts for trend analysis (not broker orders).
        </p>
        {proof?.scoreboard?.length ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Days</th>
                  <th>Avg hits</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {proof.scoreboard.map((row) => (
                  <tr key={row.strategy_key}>
                    <td>
                      <strong>{row.label}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {row.strategy_key}
                      </div>
                    </td>
                    <td>
                      {row.ok_days}/{row.days}
                    </td>
                    <td>{row.avg_hits}</td>
                    <td>
                      {row.last_hits} · {row.last_date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            No daily runs stored yet — wait for 16:15 IST or click Run now.
          </p>
        )}
      </section>

      <div className="card segmented strategies-tabs">
        {STYLE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={styleTab === tab.key ? 'btn' : 'btn btn-secondary'}
            onClick={() => setStyleTab(tab.key)}
          >
            {styleLabels[tab.key] ?? tab.label}
          </button>
        ))}
      </div>

      <div className="strategies-layout">
        <aside className="card strategies-list">
          <h2 style={{ marginTop: 0 }}>Strategies</h2>
          <ul className="strategies-picker">
            {strategies.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`strategy-pick ${selected === s.key ? 'active' : ''} ${s.ready ? '' : 'disabled'}`}
                  onClick={() => {
                    urlUniverseLock.current = false;
                    urlMaxScanLock.current = false;
                    setSelected(s.key);
                  }}
                >
                  <span className="strategy-icon">{s.icon}</span>
                  <span>
                    <strong>{s.label}</strong>
                    <span className="muted block">{s.horizon}</span>
                    {!s.ready ? (
                      <span className="strategy-blocked muted">Not ready</span>
                    ) : isSystemStrategyKey(s.key) ? (
                      <span className="strategy-engine muted">System · read-only</span>
                    ) : (
                      <span className="strategy-engine muted">{s.engine} · custom</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Save custom preset</h3>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Base screener preset</label>
              <select value={basePresetId} onChange={(e) => setBasePresetId(e.target.value)} style={{ width: '100%' }}>
                {screenerPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Custom name</label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Quality + TA gate"
                style={{ width: '100%' }}
              />
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => void saveCustomPreset()} disabled={customSaving}>
              {customSaving ? 'Saving…' : 'Save preset'}
            </button>
          </div>

          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Save custom swing rule profile</h3>

            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Profile name</label>
              <input
                value={swingProfileName}
                onChange={(e) => setSwingProfileName(e.target.value)}
                placeholder="e.g. Strict ENTER + Red-zone breakout"
                style={{ width: '100%' }}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Min verdict</label>
                <select value={swingMinVerdict} onChange={(e) => setSwingMinVerdict(e.target.value as any)} style={{ width: '100%' }}>
                  <option value="ENTER">ENTER</option>
                  <option value="SETUP_PLUS">SETUP_PLUS</option>
                  <option value="WATCH">WATCH</option>
                  <option value="ALL">ALL</option>
                </select>
              </div>
              <div className="form-group">
                <label>Zone 52w</label>
                <select value={swingZone52w} onChange={(e) => setSwingZone52w(e.target.value)} style={{ width: '100%' }}>
                  <option value="any">any</option>
                  <option value="green">green (near 52w low)</option>
                  <option value="mid">mid</option>
                  <option value="red">red (near 52w high)</option>
                  <option value="low">low (alias)</option>
                  <option value="high">high (alias)</option>
                </select>
              </div>
            </div>

            <label className="checkbox-inline" style={{ display: 'block', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={swingBreakoutVolume}
                onChange={(e) => setSwingBreakoutVolume(e.target.checked)}
              />
              Breakout volume required
            </label>

            <div className="form-group" style={{ marginTop: 10, marginBottom: 8 }}>
              <label>Require rules (comma-separated)</label>
              <input
                value={swingRequireRulesText}
                onChange={(e) => setSwingRequireRulesText(e.target.value)}
                placeholder="e.g. E12, E7"
                style={{ width: '100%' }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Min rules passed (optional)</label>
              <input
                type="number"
                min={0}
                max={20}
                value={swingMinRulesPassed}
                onChange={(e) => setSwingMinRulesPassed(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 8 }}>
              <label>Regime override (optional JSON)</label>
              <textarea
                value={swingRegimeJsonText}
                onChange={(e) => setSwingRegimeJsonText(e.target.value)}
                placeholder='e.g. { "bull": true, "blocks_strict_enter": false }'
                style={{ width: '100%', minHeight: 72 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void saveOrUpdateSwingRuleProfile()}
                disabled={swingProfileSaving}
              >
                {swingProfileSaving
                  ? 'Saving…'
                  : active && isUserSwingRuleProfileKey(active.key)
                    ? 'Update profile'
                    : 'Save profile'}
              </button>

              {active && isUserSwingRuleProfileKey(active.key) && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void deleteActiveSwingRuleProfile()}
                  disabled={swingProfileSaving}
                >
                  {swingProfileSaving ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </aside>

        <div className="strategies-main">
          {active && (
            <form className="card" onSubmit={onRun}>
              <h2 style={{ marginTop: 0 }}>
                {active.icon} {active.label}
              </h2>
              <p className="muted">{active.description}</p>
              {canOpenStrategyInScreener(active) && (
                <p style={{ marginTop: 0 }}>
                  <Link
                    className="btn btn-secondary btn-sm"
                    to={screenerDeepLinkFromStrategy(active, {
                      universe: universe || active.universe_default,
                      maxScan: maxScan > 0 ? maxScan : active.max_scan_default,
                      background,
                    })}
                  >
                    {active.engine === 'hybrid' ? 'Open screener leg' : 'Open in Screener'}
                  </Link>
                  {' '}
                  <Link
                    className="btn btn-secondary btn-sm"
                    to={screenerDeepLinkFromStrategy(active, {
                      universe: universe || active.universe_default,
                      maxScan: maxScan > 0 ? maxScan : active.max_scan_default,
                      background,
                      autorun: true,
                    })}
                  >
                    {active.engine === 'hybrid' ? 'Open screener leg & run' : 'Open & run'}
                  </Link>
                </p>
              )}


              {isSystemStrategyKey(active.key) ? (
                <p className="muted" style={{ marginTop: 0 }}>
                  System strategy — read-only. Save a custom preset or swing profile to edit filters.
                </p>
              ) : null}
              {!active.ready && active.blocked_reason ? (
                <p className="error">{active.blocked_reason}</p>
              ) : null}

              {isUserPresetKey(active.key) && (
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void deleteActiveCustomPreset()}
                    disabled={customSaving}
                  >
                    Delete this preset
                  </button>

                  <div style={{ height: 8 }} />

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void updateActiveCustomPreset()}
                    disabled={customSaving}
                  >
                    {customSaving ? 'Updating…' : 'Update this preset'}
                  </button>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Universe</label>
                  <select
                    value={universe}
                    onChange={(e) => {
                      urlUniverseLock.current = true;
                      setUniverse(e.target.value);
                    }}
                    style={{ width: '100%' }}
                  >
                    {universes.map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.name} ({u.symbolCount})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Max scan (0 = strategy default)</label>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={maxScan}
                    onChange={(e) => setMaxScan(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                />
                Run in background (auto for large universes)
              </label>

              {progress && loading ? (
                <p className="muted">
                  {progress.stage_label ??
                    (progress.phase === 'screener'
                      ? 'Stage 1 · CFA screener'
                      : progress.phase === 'swing'
                        ? 'Stage 2 · swing scan'
                        : progress.phase === 'done'
                          ? 'Done'
                          : progress.phase ?? 'running')}{' '}
                  — {progress.processed}/{progress.total}
                  {progress.passed ? ` · ${progress.passed} passed` : ''}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="submit" className="btn" disabled={loading || !active.ready}>
                  {loading ? 'Running…' : 'Run strategy'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!active.ready}
                  onClick={() => void copyRunLink()}
                >
                  {copiedLink ? 'Link copied' : 'Copy autorun link'}
                </button>
              </div>
            </form>
          )}

          {error && <p className="error">{error}</p>}
          {actionMsg && <p className="flash success">{actionMsg}</p>}

          {result?.engine === 'swing' && (
            <div className="card">
              <h2>Swing hits ({result.hits.length})</h2>
              <p className="muted">
                {result.label} · {result.universe} · scanned {result.scanned}
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Price</th>
                      <th>Verdict</th>
                      <th>Strict</th>
                      <th>Score</th>
                      <th>R</th>
                      <th>Stop</th>
                      <th>Target</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((h) => (
                      <tr key={h.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(h.symbol)}`}>
                            <strong>{h.symbol}</strong>
                          </Link>
                        </td>
                        <td>{h.price}</td>
                        <td>
                          <span className={verdictClass(h.verdict)}>{h.verdict}</span>
                        </td>
                        <td>{h.strict_verdict}</td>
                        <td>{h.entry_score}</td>
                        <td>{h.r_multiple ?? '—'}</td>
                        <td>{h.stop_loss ?? '—'}</td>
                        <td>{h.profit_target ?? '—'}</td>
                        <td>
                          <ResearchRowActions
                            symbol={h.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            swing={{
                              symbol: h.symbol,
                              price: h.price,
                              stop_loss: h.stop_loss,
                              profit_target: h.profit_target,
                            }}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.engine === 'screener' && (
            <div className="card">
              <h2>Screener passes ({result.rows.length})</h2>
              <p className="muted">
                {result.label} · {result.universe} · scanned {result.scanned}
                {result.cache_hits ? ` · ${result.cache_hits} cache hits` : ''}
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>P/E</th>
                      <th>ROE</th>
                      <th>MOS</th>
                      {result.rows.some((r) => r.ta_ready) ? (
                        <>
                          <th>RSI</th>
                          <th>52w%</th>
                          <th>Bottom</th>
                        </>
                      ) : null}
                      <th>Score</th>
                      <th>Zone</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(r.symbol)}`}>
                            <strong>{r.symbol}</strong>
                          </Link>
                        </td>
                        <td>{r.pe}</td>
                        <td>{r.roe}%</td>
                        <td>{r.mos != null ? `${r.mos}%` : '—'}</td>
                        {result.rows.some((row) => row.ta_ready) ? (
                          <>
                            <td>{r.ta_ready && r.ta_rsi14 != null ? r.ta_rsi14.toFixed(1) : '—'}</td>
                            <td>{r.ta_ready && r.ta_pct_52w != null ? `${r.ta_pct_52w}%` : '—'}</td>
                            <td>{r.ta_bottom_out_hint ? '✓' : '—'}</td>
                          </>
                        ) : null}
                        <td>{r.composite_score}</td>
                        <td>
                          <span className={zoneClass(r.zone)}>{r.zone}</span>
                        </td>
                        <td>
                          <ResearchRowActions
                            symbol={r.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result?.engine === 'hybrid' && (
            <div className="card">
              <h2>Hybrid — swing hits ({result.hits.length})</h2>
              <p className="muted">
                Stage 1: {result.screener_passed} passed CFA screen · Stage 2: {result.hits.length} swing hits
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Price</th>
                      <th>Verdict</th>
                      <th>Rank</th>
                      <th>R</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((h) => (
                      <tr key={h.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(h.symbol)}`}>
                            <strong>{h.symbol}</strong>
                          </Link>
                        </td>
                        <td>{h.price}</td>
                        <td>
                          <span className={verdictClass(h.verdict)}>{h.verdict}</span>
                        </td>
                        <td>{h.swing_rank ?? '—'}</td>
                        <td>{h.r_multiple ?? '—'}</td>
                        <td>
                          <ResearchRowActions
                            symbol={h.symbol}
                            source={`strategy:${selected}`}
                            sourceLabel={result.label}
                            swing={{
                              symbol: h.symbol,
                              price: h.price,
                              stop_loss: h.stop_loss,
                              profit_target: h.profit_target,
                            }}
                            onMessage={setActionMsg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

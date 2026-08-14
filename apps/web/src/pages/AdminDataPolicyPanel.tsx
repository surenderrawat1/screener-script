import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AdminEffectiveSettings } from './AdminFeaturesPanel';

const TTL_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'stock', label: 'Stock OHLC', hint: 'Yahoo daily blob' },
  { key: 'verify', label: 'Verify memo', hint: 'Derived verification cache' },
  { key: 'yahoo_raw', label: 'Yahoo raw', hint: 'Raw quote payload' },
  { key: 'screener_row', label: 'Screener row', hint: 'Per-symbol Screener.in' },
  { key: 'screener_table', label: 'Screener table', hint: 'Universe table snapshot' },
  { key: 'ta', label: 'TA cache', hint: 'Indicators' },
  { key: 'universe', label: 'Universe list', hint: 'Symbol lists' },
  { key: 'index_meta', label: 'Index metadata', hint: 'Sync timestamps' },
  { key: 'regime', label: 'Market regime', hint: 'NIFTYBEES band' },
  { key: 'swing_auto', label: 'Swing Auto snapshot', hint: 'Radar snapshot' },
  { key: 'intraday_chart', label: 'Intraday chart', hint: 'Session candles' },
  { key: 'morning_etf', label: 'Morning ETF', hint: 'ETF setup panel' },
  { key: 'morning_bundle', label: 'Morning bundle', hint: 'Assembled briefing' },
];

const DEFAULT_TTL: Record<string, number> = {
  stock: 604800,
  verify: 604800,
  yahoo_raw: 604800,
  screener_row: 3600,
  screener_table: 86400,
  ta: 86400,
  universe: 86400,
  index_meta: 2592000,
  regime: 900,
  swing_auto: 7200,
  intraday_chart: 300,
  morning_etf: 600,
  morning_bundle: 60,
};

function formatTtl(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

type Props = {
  settings: AdminEffectiveSettings;
  loading: boolean;
  onBusy: (busy: boolean) => void;
  onMessage: (msg: string) => void;
  onError: (msg: string) => void;
  onSaved: () => Promise<void>;
};

export function AdminDataPolicyPanel({
  settings,
  loading,
  onBusy,
  onMessage,
  onError,
  onSaved,
}: Props) {
  const policy = settings.effective.dataPolicy ?? {};
  const indexKeys = Object.keys(settings.effective.indices?.definitions ?? {});

  const [timezone, setTimezone] = useState(policy.timezone ?? 'Asia/Kolkata');
  const [ttl, setTtl] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of TTL_FIELDS) {
      out[f.key] = String(policy.cache_ttl?.[f.key] ?? DEFAULT_TTL[f.key] ?? 3600);
    }
    return out;
  });
  const [indexAge, setIndexAge] = useState(String(policy.staleness?.index_max_age_days ?? 90));
  const [nseAge, setNseAge] = useState(String(policy.staleness?.nse_equity_max_age_days ?? 30));
  const [holdingsAge, setHoldingsAge] = useState(String(policy.staleness?.holdings_max_age_days ?? 90));
  const [prefetchOn, setPrefetchOn] = useState(policy.prefetch?.enabled !== false);
  const [prefetchUniverses, setPrefetchUniverses] = useState<string[]>(
    policy.prefetch?.universes?.length ? [...policy.prefetch.universes] : ['nifty50', 'nifty500'],
  );
  const [includeOpen, setIncludeOpen] = useState(policy.prefetch?.include_open_positions !== false);
  const [batchSize, setBatchSize] = useState(String(policy.prefetch?.max_symbols_per_batch ?? 50));
  const [delayMs, setDelayMs] = useState(String(policy.prefetch?.delay_ms_between_batches ?? 200));
  const [allowRefresh, setAllowRefresh] = useState(policy.on_demand?.allow_refresh_param !== false);
  const [rateLimit, setRateLimit] = useState(String(policy.on_demand?.rate_limit_per_user_per_hour ?? 30));

  useEffect(() => {
    const p = settings.effective.dataPolicy ?? {};
    setTimezone(p.timezone ?? 'Asia/Kolkata');
    const next: Record<string, string> = {};
    for (const f of TTL_FIELDS) {
      next[f.key] = String(p.cache_ttl?.[f.key] ?? DEFAULT_TTL[f.key] ?? 3600);
    }
    setTtl(next);
    setIndexAge(String(p.staleness?.index_max_age_days ?? 90));
    setNseAge(String(p.staleness?.nse_equity_max_age_days ?? 30));
    setHoldingsAge(String(p.staleness?.holdings_max_age_days ?? 90));
    setPrefetchOn(p.prefetch?.enabled !== false);
    setPrefetchUniverses(p.prefetch?.universes?.length ? [...p.prefetch.universes] : ['nifty50', 'nifty500']);
    setIncludeOpen(p.prefetch?.include_open_positions !== false);
    setBatchSize(String(p.prefetch?.max_symbols_per_batch ?? 50));
    setDelayMs(String(p.prefetch?.delay_ms_between_batches ?? 200));
    setAllowRefresh(p.on_demand?.allow_refresh_param !== false);
    setRateLimit(String(p.on_demand?.rate_limit_per_user_per_hour ?? 30));
  }, [settings]);

  const universeChoices = useMemo(() => {
    const set = new Set([...indexKeys, ...prefetchUniverses, 'total_nse']);
    return [...set].sort();
  }, [indexKeys, prefetchUniverses]);

  function toggleUniverse(key: string) {
    setPrefetchUniverses((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const cache_ttl: Record<string, number> = {};
    for (const f of TTL_FIELDS) {
      const n = Number(ttl[f.key]);
      if (!Number.isFinite(n) || n < 30) {
        onError(`${f.label}: TTL must be at least 30 seconds`);
        return;
      }
      cache_ttl[f.key] = Math.round(n);
    }
    if (prefetchUniverses.length === 0) {
      onError('Select at least one prefetch universe');
      return;
    }

    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          dataPolicy: {
            timezone: timezone.trim() || 'Asia/Kolkata',
            cache_ttl,
            staleness: {
              index_max_age_days: Math.max(1, Number(indexAge) || 90),
              nse_equity_max_age_days: Math.max(1, Number(nseAge) || 30),
              holdings_max_age_days: Math.max(1, Number(holdingsAge) || 90),
            },
            prefetch: {
              enabled: prefetchOn,
              universes: prefetchUniverses,
              include_open_positions: includeOpen,
              max_symbols_per_batch: Math.max(5, Number(batchSize) || 50),
              delay_ms_between_batches: Math.max(0, Number(delayMs) || 200),
            },
            on_demand: {
              allow_refresh_param: allowRefresh,
              rate_limit_per_user_per_hour: Math.max(1, Number(rateLimit) || 30),
            },
          },
        }),
      });
      onMessage('Data policy saved — worker / API pick up within ~60s');
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save data policy');
    } finally {
      onBusy(false);
    }
  }

  async function reset() {
    if (!confirm('Reset data policy overrides to config/data-policy.yaml?')) return;
    onBusy(true);
    onError('');
    onMessage('');
    try {
      await api('/api/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ dataPolicy: null }),
      });
      onMessage('Data policy reset to YAML defaults');
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      onBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="admin-card-head">
        <h2 style={{ margin: 0 }}>Data policy</h2>
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void reset()}>
          Reset to YAML
        </button>
      </div>
      <p className="muted">
        Cache TTLs, daily prefetch universes, and staleness — no <code>data-policy.yaml</code> edit needed.
      </p>

      <label className="admin-field">
        <span className="admin-field-label">Timezone</span>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </label>

      <h3 className="admin-subhead">Daily prefetch</h3>
      <div className="admin-feature-grid">
        <div className="admin-feature-block">
          <div className="admin-feature-block-head">
            <strong>Prefetch enabled</strong>
            <button
              type="button"
              className={`btn btn-sm ${prefetchOn ? '' : 'btn-secondary'}`}
              disabled={loading}
              onClick={() => setPrefetchOn((v) => !v)}
            >
              {prefetchOn ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        <div className="admin-feature-block">
          <div className="admin-feature-block-head">
            <strong>Include open positions</strong>
            <button
              type="button"
              className={`btn btn-sm ${includeOpen ? '' : 'btn-secondary'}`}
              disabled={loading}
              onClick={() => setIncludeOpen((v) => !v)}
            >
              {includeOpen ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">Max symbols / batch</span>
          <input type="number" min={5} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field-label">Delay between batches (ms)</span>
          <input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
        </label>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        Warm these universes after daily sync (from index registry).
      </p>
      <div className="admin-chip-row">
        {universeChoices.map((key) => {
          const on = prefetchUniverses.includes(key);
          return (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${on ? '' : 'btn-secondary'}`}
              disabled={loading}
              onClick={() => toggleUniverse(key)}
            >
              {key}
            </button>
          );
        })}
      </div>

      <h3 className="admin-subhead">Staleness warnings (days)</h3>
      <div className="admin-feature-grid">
        <label className="admin-field">
          <span className="admin-field-label">Index max age</span>
          <input type="number" min={1} value={indexAge} onChange={(e) => setIndexAge(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field-label">NSE equity max age</span>
          <input type="number" min={1} value={nseAge} onChange={(e) => setNseAge(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field-label">Holdings max age</span>
          <input type="number" min={1} value={holdingsAge} onChange={(e) => setHoldingsAge(e.target.value)} />
        </label>
      </div>

      <h3 className="admin-subhead">On-demand refresh</h3>
      <div className="admin-feature-grid">
        <div className="admin-feature-block">
          <div className="admin-feature-block-head">
            <strong>Allow ?refresh=true</strong>
            <button
              type="button"
              className={`btn btn-sm ${allowRefresh ? '' : 'btn-secondary'}`}
              disabled={loading}
              onClick={() => setAllowRefresh((v) => !v)}
            >
              {allowRefresh ? 'On' : 'Off'}
            </button>
          </div>
        </div>
        <label className="admin-field">
          <span className="admin-field-label">Rate limit / user / hour</span>
          <input type="number" min={1} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
        </label>
      </div>

      <h3 className="admin-subhead">Redis TTLs (seconds)</h3>
      <div className="admin-ttl-grid">
        {TTL_FIELDS.map((f) => (
          <label key={f.key} className="admin-field">
            <span className="admin-field-label">
              {f.label} <span className="muted">({formatTtl(Number(ttl[f.key]))})</span>
            </span>
            <input
              type="number"
              min={30}
              value={ttl[f.key] ?? ''}
              onChange={(e) => setTtl((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
            <small className="muted">{f.hint}</small>
          </label>
        ))}
      </div>

      <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.85rem' }}>
        Save data policy
      </button>
    </form>
  );
}

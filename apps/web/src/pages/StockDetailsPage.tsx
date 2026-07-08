import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';
import { StockDailyChart, type ChartPayload } from '../components/StockDailyChart';
import { SwingEntryRulesTable, SwingVerdictBanner } from '../components/swing/SwingEntryRulesTable';

interface StockSummary {
  symbol: string;
  name: string;
  success: boolean;
  metrics: Record<string, unknown>;
  valuation: {
    intrinsic: number;
    mos: number | null;
    zone: string;
    fair_pe: number;
    quality_score: number;
    recommendation: string;
    final_rating: string;
    graham: number;
    method: string;
    verify_score: number;
  };
  sources?: string[];
  from_cache?: boolean;
  iv_drift?: {
    screener_iv: number;
    full_iv: number;
    drift_pct: number;
    iv_drift_warn: boolean;
  } | null;
  disclaimer: string;
}

interface PhaseCard {
  number: number;
  title: string;
  label: string;
  detail: string;
  signal: string;
}

interface ChartResponse {
  symbol: string;
  chart: ChartPayload | null;
  ta: Record<string, unknown>;
  phases: {
    ready: boolean;
    headline: string;
    bias: string;
    phases: PhaseCard[];
    observations: string[];
    timing_note: string;
  };
}

interface ScreenerProfile {
  about: string;
  key_points: string;
  website: string;
  concalls: Array<{
    period: string;
    transcript_url: string;
    ppt_url: string;
    has_ai_summary: boolean;
    ai_summary_url: string;
  }>;
  expenditures: {
    unit: string;
    items: Array<{ label: string; latest_period: string; latest_cr: number | null }>;
  };
  business_plans: {
    highlights: string[];
    key_points_excerpt: string;
    recent_concalls: string[];
  };
}

function fmtNum(v: unknown, suffix = ''): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return `${n}${suffix}`;
}

function fmtText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  return s || '—';
}

const SECTOR_LABELS: Record<string, string> = {
  general: 'General / Other',
  banking: 'Banking / NBFC',
  it: 'IT Services',
  defence: 'Defence / Aerospace',
  infra: 'Infrastructure / NBFC',
  fmcg: 'FMCG',
  pharma: 'Pharma & Healthcare',
  auto: 'Auto & Ancillary',
  metal: 'Metals & Mining',
  cement: 'Cement',
  telecom: 'Telecom',
  utility: 'Power / Utilities',
  reit: 'REIT / InvIT',
};

function fmtSector(v: unknown): string {
  const key = String(v ?? '').trim().toLowerCase();
  if (!key || key === 'general') return '—';
  return SECTOR_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtMacd(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 1000) / 1000);
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function verdictClass(rec: string): string {
  const r = rec.toLowerCase();
  if (r.includes('strong') || r.includes('buy')) return 'badge badge-buy';
  if (r.includes('hold') || r.includes('accumulate')) return 'badge badge-hold';
  return 'badge badge-expensive';
}

function signalClass(signal: string): string {
  if (signal === 'bullish') return 'signal-bull';
  if (signal === 'bearish') return 'signal-bear';
  if (signal === 'watch') return 'signal-watch';
  return '';
}

function boolHint(v: unknown, yes: string, no: string): string {
  if (v === true) return yes;
  if (v === false) return no;
  return 'No signal';
}

function MetricTile({
  label,
  value,
  hint,
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`sd-metric ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

const FUNDAMENTAL_TILES: Array<{ label: string; key: string; fmt?: (v: unknown) => string; hint?: string }> = [
  { label: 'Price', key: 'price', fmt: fmtMoney },
  { label: 'Market cap (₹ Cr)', key: 'market_cap_cr' },
  { label: 'P/E', key: 'pe' },
  { label: 'P/B', key: 'pb_ratio' },
  { label: 'PEG', key: 'peg_ratio' },
  { label: 'EPS', key: 'eps', fmt: fmtMoney },
  { label: 'Book value', key: 'book_value', fmt: fmtMoney },
  { label: 'ROE', key: 'roe', fmt: (v) => fmtNum(v, '%') },
  { label: 'ROA', key: 'roa', fmt: (v) => fmtNum(v, '%') },
  { label: 'ROCE', key: 'roce', fmt: (v) => fmtNum(v, '%') },
  { label: 'Debt / equity', key: 'debt_to_equity' },
  { label: 'Div yield', key: 'div_yield', fmt: (v) => fmtNum(v, '%') },
  { label: 'Sales YoY', key: 'sales_yoy', fmt: (v) => fmtNum(v, '%') },
  { label: 'Profit YoY', key: 'profit_yoy', fmt: (v) => fmtNum(v, '%') },
  { label: '52w High', key: 'high_52w', fmt: fmtMoney },
  { label: '52w Low', key: 'low_52w', fmt: fmtMoney },
  { label: 'Gross margin', key: 'gross_margin', fmt: (v) => fmtNum(v, '%') },
  { label: 'EBITDA margin', key: 'ebitda_margin', fmt: (v) => fmtNum(v, '%') },
  { label: 'Operating margin', key: 'operating_margin', fmt: (v) => fmtNum(v, '%') },
  { label: 'FCF (₹ Cr)', key: 'fcf_cr' },
  { label: 'CFO (₹ Cr)', key: 'cfo_cr' },
  { label: 'Est. Capex (₹ Cr)', key: 'capex_cr', hint: 'CFO − FCF proxy' },
  { label: 'Interest coverage', key: 'interest_coverage' },
  { label: 'Total debt (₹ Cr)', key: 'total_debt_cr' },
  { label: 'Total cash (₹ Cr)', key: 'total_cash_cr' },
  { label: 'Sector', key: 'sector', fmt: fmtSector },
  { label: 'Industry', key: 'industry', fmt: fmtText },
];

export default function StockDetailsPage() {
  const { user } = useAuth();
  const { symbol: routeSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState(routeSymbol?.toUpperCase() ?? 'TCS');
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [chartData, setChartData] = useState<ChartResponse | null>(null);
  const [profile, setProfile] = useState<ScreenerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [error, setError] = useState('');
  const [swingEval, setSwingEval] = useState<Record<string, unknown> | null>(null);
  const [swingLoading, setSwingLoading] = useState(false);

  const canRefreshLive = user?.role === 'admin' || user?.role === 'analyst';

  const loadChart = useCallback(async (sym: string, refresh = false) => {
    const normalized = sym.trim().toUpperCase();
    if (!normalized) return;
    setChartLoading(true);
    try {
      const q = refresh ? '?refresh=true' : '';
      const data = await api<ChartResponse>(
        `/api/v1/stock/${encodeURIComponent(normalized)}/chart${q}`,
      );
      setChartData(data);
    } catch {
      setChartData(null);
    } finally {
      setChartLoading(false);
    }
  }, []);

  const loadSwing = useCallback(async (sym: string, refresh = false) => {
    const normalized = sym.trim().toUpperCase();
    if (!normalized) return;
    setSwingLoading(true);
    try {
      const data = await api<Record<string, unknown>>('/api/v1/swing/evaluate', {
        method: 'POST',
        body: JSON.stringify({ symbol: normalized, refresh }),
      });
      setSwingEval(data);
    } catch {
      setSwingEval(null);
    } finally {
      setSwingLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async (sym: string, refresh = false) => {
    const normalized = sym.trim().toUpperCase();
    if (!normalized) return;
    setProfileLoading(true);
    try {
      const q = refresh ? '?refresh=true' : '';
      const data = await api<{ profile: ScreenerProfile | null }>(
        `/api/v1/stock/${encodeURIComponent(normalized)}/profile${q}`,
      );
      setProfile(data.profile);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const load = useCallback(
    async (sym: string, refresh = false) => {
      const normalized = sym.trim().toUpperCase();
      if (!normalized) return;
      setError('');
      setLoading(true);
      setChartData(null);
      setProfile(null);
      setSwingEval(null);
      try {
        const q = refresh ? '?refresh=true' : '';
        const data = await api<StockSummary>(
          `/api/v1/stock/${encodeURIComponent(normalized)}${q}`,
        );
        setSummary(data);
        void loadChart(normalized, refresh);
        void loadProfile(normalized, refresh);
        void loadSwing(normalized, refresh);
      } catch (err) {
        setSummary(null);
        setError(err instanceof Error ? err.message : 'Failed to load stock');
      } finally {
        setLoading(false);
      }
    },
    [loadChart, loadProfile, loadSwing],
  );

  const refreshLive = useCallback(async (sym: string) => {
    const normalized = sym.trim().toUpperCase();
    if (!normalized) return;
    setRefreshMsg('');
    setError('');
    setRefreshing(true);
    try {
      const data = await api<{
        deleted_keys: number;
        summary: StockSummary;
      }>(`/api/v1/stock/${encodeURIComponent(normalized)}/refresh`, { method: 'POST' });
      setSummary(data.summary);
      setRefreshMsg(`Cleared ${data.deleted_keys} cache key(s) and reloaded live data.`);
      void loadChart(normalized, true);
      void loadProfile(normalized, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cache refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [loadChart, loadProfile]);

  useEffect(() => {
    if (routeSymbol) {
      setQuery(routeSymbol.toUpperCase());
      void load(routeSymbol, false);
    }
  }, [routeSymbol, load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (!sym) return;
    navigate(`/stock/${encodeURIComponent(sym)}`);
  }

  const m = summary?.metrics ?? {};
  const v = summary?.valuation;
  const ta = chartData?.ta ?? {};
  const phases = chartData?.phases;

  return (
    <Page>
      <PageHeader
        title="Stock Details"
        subtitle="Fundamentals, CFA valuation, daily chart, and technical context"
      />
      <p className="disclaimer">
        Timing context only — valuation is not blended with technical signals.
      </p>

      <form className="card" onSubmit={onSearch}>
        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 280 }}>
            <label>Symbol</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="TCS"
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
          {routeSymbol && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || refreshing}
              onClick={() => void load(routeSymbol, true)}
            >
              Refresh data
            </button>
          )}
          {routeSymbol && canRefreshLive && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || refreshing}
              onClick={() => void refreshLive(routeSymbol)}
            >
              {refreshing ? 'Clearing cache…' : 'Clear cache & reload'}
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {refreshMsg && <p className="message-success">{refreshMsg}</p>}

      {!summary && !loading && !error && !routeSymbol && (
        <EmptyState>Enter a symbol to view fundamentals and valuation.</EmptyState>
      )}

      {summary && v && (
        <>
          <div className="card">
            <h2 style={{ marginBottom: '0.25rem' }}>
              {summary.symbol}
              <span className="muted" style={{ fontWeight: 400, marginLeft: '0.5rem' }}>
                {summary.name}
              </span>
            </h2>
            <p style={{ margin: '0.25rem 0 0.75rem' }}>
              <span className={verdictClass(v.final_rating)}>{v.final_rating}</span>
              <span className="muted" style={{ marginLeft: '0.75rem' }}>
                {fmtMoney(m.price)} · MOS {v.mos !== null ? `${v.mos}%` : '—'} · {v.zone}
              </span>
            </p>
            {summary.sources && summary.sources.length > 0 && (
              <p className="muted">
                Sources: {summary.sources.join(' · ')}
                {summary.from_cache ? ' (cached)' : ''}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
              <Link className="btn btn-secondary" to={`/verify/full?symbol=${encodeURIComponent(summary.symbol)}`}>
                Full verify
              </Link>
              <Link className="btn btn-secondary" to={`/verify?symbol=${encodeURIComponent(summary.symbol)}`}>
                CFA verify
              </Link>
              <Link className="btn btn-secondary" to={`/swing?symbol=${encodeURIComponent(summary.symbol)}`}>
                Swing scan
              </Link>
              <Link className="btn btn-secondary" to={`/strategies`}>
                Strategies
              </Link>
              <Link className="btn btn-secondary" to={`/watchlist`}>
                Watchlist
              </Link>
            </div>
          </div>

          {summary.iv_drift?.iv_drift_warn ? (
            <div className="card iv-drift-card" role="alert">
              <strong>IV drift warning</strong>
              <p className="iv-drift-warn" style={{ margin: '0.35rem 0' }}>
                Screener fast-path IV {fmtMoney(summary.iv_drift.screener_iv)} differs from Full Verify IV{' '}
                {fmtMoney(summary.iv_drift.full_iv)} by {fmtNum(summary.iv_drift.drift_pct, '%')}. MOS and zone on
                screener rows may be stale — re-run Full Verify before sizing.
              </p>
              <Link to={`/verify/full?symbol=${encodeURIComponent(summary.symbol)}`}>Open Full Verify →</Link>
            </div>
          ) : null}

          <div className="card">
            <h2>CFA valuation</h2>
            {summary.iv_drift &&
              !summary.iv_drift.iv_drift_warn &&
              summary.iv_drift.drift_pct > 0.5 &&
              Math.abs(summary.iv_drift.screener_iv - summary.iv_drift.full_iv) > 0.5 && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Screener fast-path IV: {fmtMoney(summary.iv_drift.screener_iv)}
                  {' · '}
                  drift {fmtNum(summary.iv_drift.drift_pct, '%')} vs verify IV — within tolerance
                </p>
              )}
            <div className="sd-metric-grid">
              <MetricTile label="Intrinsic value" value={fmtMoney(v.intrinsic)} />
              <MetricTile label="Margin of safety" value={v.mos !== null ? `${v.mos}%` : '—'} />
              <MetricTile label="Fair P/E" value={`${v.fair_pe}×`} />
              <MetricTile label="Graham number" value={fmtMoney(v.graham)} />
              <MetricTile label="Quality score" value={`${v.quality_score}/100`} />
              <MetricTile label="Verify score" value={`${v.verify_score}/56`} />
              <MetricTile label="Method" value={v.method || '—'} />
              <MetricTile label="Verdict" value={v.recommendation || '—'} />
            </div>
          </div>

          <div className="card">
            <h2>Fundamentals</h2>
            <div className="sd-metric-grid">
              {FUNDAMENTAL_TILES.map((tile) => (
                <MetricTile
                  key={tile.key}
                  label={tile.label}
                  value={(tile.fmt ?? fmtNum)(m[tile.key])}
                  hint={tile.hint}
                />
              ))}
              <MetricTile
                label="Promoter holding"
                value={
                  m.promoter_holding != null
                    ? `${fmtNum(m.promoter_holding, '%')}`
                    : '—'
                }
                hint={
                  m.promoter_holding_as_of
                    ? `As of ${String(m.promoter_holding_as_of)}`
                    : undefined
                }
              />
            </div>
          </div>

          <div className="card">
            <h2>Daily chart (2y)</h2>
            {chartLoading && <p className="muted">Loading chart…</p>}
            {!chartLoading && <StockDailyChart chart={chartData?.chart ?? null} />}
          </div>

          {phases?.ready && (
            <div className="card">
              <h2>Chart phase analysis</h2>
              <p className={`phase-headline phase-bias-${phases.bias}`}>{phases.headline}</p>
              <div className="phase-grid">
                {phases.phases.map((p) => (
                  <div key={p.number} className={`phase-card ${signalClass(p.signal)}`}>
                    <div className="phase-num">{p.number}</div>
                    <div>
                      <div className="phase-title">{p.title}</div>
                      <div className="phase-label">{p.label}</div>
                      <div className="phase-detail">{p.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              {phases.observations.length > 0 && (
                <ul className="phase-obs">
                  {phases.observations.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              )}
              <p className="muted">{phases.timing_note}</p>
            </div>
          )}

          <div className="card">
            <h2>Technical indicators</h2>
            {chartLoading ? (
              <p className="muted">Loading TA metrics…</p>
            ) : (
              <div className="sd-metric-grid">
                <MetricTile label="RSI-14" value={fmtNum(ta.ta_rsi14)} hint="14-day RSI" />
                <MetricTile
                  label="52w Position"
                  value={fmtNum(ta.ta_pct_52w, '%')}
                  hint="0=low, 100=high"
                />
                <MetricTile
                  label="SMA-20"
                  value={fmtMoney(ta.ta_sma20)}
                  hint={boolHint(ta.ta_above_sma20, 'Price above 20 DMA', 'Price below 20 DMA')}
                  className={signalClass(
                    ta.ta_above_sma20 === true ? 'bullish' : ta.ta_above_sma20 === false ? 'bearish' : '',
                  )}
                />
                <MetricTile
                  label="SMA-50"
                  value={fmtMoney(ta.ta_sma50)}
                  hint={boolHint(ta.ta_above_sma50, 'Price above SMA-50', 'Price below SMA-50')}
                  className={signalClass(
                    ta.ta_above_sma50 === true ? 'bullish' : ta.ta_above_sma50 === false ? 'bearish' : '',
                  )}
                />
                <MetricTile
                  label="SMA-200"
                  value={fmtMoney(ta.ta_sma200)}
                  hint={boolHint(ta.ta_above_sma200, 'Price above SMA-200', 'Price below SMA-200')}
                  className={signalClass(
                    ta.ta_above_sma200 === true ? 'bullish' : ta.ta_above_sma200 === false ? 'bearish' : '',
                  )}
                />
                <MetricTile label="MACD Line" value={fmtMacd(ta.ta_macd)} hint="12/26 EMA spread" />
                <MetricTile label="MACD Signal" value={fmtMacd(ta.ta_macd_signal)} hint="9 EMA signal" />
                <MetricTile
                  label="MACD Hist"
                  value={fmtMacd(ta.ta_macd_hist)}
                  hint={boolHint(ta.ta_macd_bullish, 'Bullish momentum', 'Bearish momentum')}
                  className={signalClass(
                    ta.ta_macd_bullish === true ? 'bullish' : ta.ta_macd_bullish === false ? 'bearish' : '',
                  )}
                />
                <MetricTile label="BB Middle" value={fmtMoney(ta.ta_bb_mid)} hint="20-day SMA" />
                <MetricTile label="BB Upper" value={fmtMoney(ta.ta_bb_upper)} hint="+2 sigma" />
                <MetricTile label="BB Lower" value={fmtMoney(ta.ta_bb_lower)} hint="-2 sigma" />
                <MetricTile label="BB %B" value={fmtNum(ta.ta_bb_pct_b, '%')} hint="0=lower band, 100=upper" />
                <MetricTile
                  label="Bottom-out Hint"
                  value={
                    ta.ta_bottom_out_score != null
                      ? `${ta.ta_bottom_out_score}/5${ta.ta_bottom_out_hint ? ' · yes' : ''}`
                      : '—'
                  }
                  hint={
                    Array.isArray(ta.ta_bottom_out_reasons) && ta.ta_bottom_out_reasons.length
                      ? (ta.ta_bottom_out_reasons as string[]).join(' · ')
                      : 'Composite timing hint only'
                  }
                />
                <MetricTile
                  label="TA Source"
                  value={String(ta.ta_source ?? '—')}
                  hint="Cached 24h when Yahoo chart works"
                />
              </div>
            )}
          </div>

          <div className="card">
            <div className="sd-section-head">
              <h2>Swing entry rules (E1–E11)</h2>
              <Link to={`/swing?symbol=${summary.symbol}&mode=symbol`} className="btn btn-secondary btn-xs">
                Full swing analysis →
              </Link>
            </div>
            {swingLoading && <p className="muted">Evaluating swing rules…</p>}
            {!swingLoading && swingEval?.entry ? (
              <>
                <SwingVerdictBanner
                  discovery={String((swingEval.entry as Record<string, unknown>).discovery_verdict ?? 'AVOID')}
                  strict={String((swingEval.entry as Record<string, unknown>).strict_verdict ?? 'AVOID')}
                  rulesPassed={Number((swingEval.entry as Record<string, unknown>).rules_passed ?? 0)}
                  entryScore={Number((swingEval.entry as Record<string, unknown>).entry_score ?? 0)}
                />
                <p className="muted">
                  Stop {fmtMoney((swingEval.entry as Record<string, unknown>).stop_loss)} · Target{' '}
                  {fmtMoney((swingEval.entry as Record<string, unknown>).profit_target)} · R{' '}
                  {fmtNum((swingEval.entry as Record<string, unknown>).r_multiple)}
                  {' · '}
                  <Link to={`/swing/backtest?symbol=${summary.symbol}&autorun=1`}>Backtest</Link>
                </p>
                <SwingEntryRulesTable
                  rules={((swingEval.entry as Record<string, unknown>).rules as Array<{
                    id: string;
                    name: string;
                    criterion: string;
                    passed: boolean | null;
                    detail: string;
                  }>) ?? []}
                />
              </>
            ) : !swingLoading ? (
              <p className="muted">Swing evaluation unavailable.</p>
            ) : null}
          </div>

          <div className="card">
            <h2>Business profile</h2>
            {profileLoading && <p className="muted">Loading Screener.in profile…</p>}
            {!profileLoading && !profile && (
              <p className="muted">Company profile unavailable for this symbol.</p>
            )}
            {profile && (
              <>
                {profile.website && (
                  <p>
                    <a href={profile.website} target="_blank" rel="noreferrer">
                      {profile.website}
                    </a>
                  </p>
                )}
                {profile.about && (
                  <>
                    <h3>About</h3>
                    <p>{profile.about}</p>
                  </>
                )}
                {profile.key_points && (
                  <>
                    <h3>Key points</h3>
                    <p>{profile.key_points}</p>
                  </>
                )}
                {profile.business_plans.highlights.length > 0 && (
                  <>
                    <h3>Business plans &amp; guidance</h3>
                    <ul>
                      {profile.business_plans.highlights.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </>
                )}
                {profile.concalls.length > 0 && (
                  <>
                    <h3>Concalls</h3>
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th>Links</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.concalls.map((c) => (
                          <tr key={c.period}>
                            <td>{c.period}</td>
                            <td>
                              {c.transcript_url && (
                                <a href={c.transcript_url} target="_blank" rel="noreferrer">
                                  Transcript
                                </a>
                              )}
                              {c.ppt_url && (
                                <>
                                  {' · '}
                                  <a href={c.ppt_url} target="_blank" rel="noreferrer">
                                    PPT
                                  </a>
                                </>
                              )}
                              {c.has_ai_summary && c.ai_summary_url && (
                                <>
                                  {' · '}
                                  <a href={c.ai_summary_url} target="_blank" rel="noreferrer">
                                    AI summary
                                  </a>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {profile.expenditures.items.length > 0 && (
                  <>
                    <h3>Expenditures ({profile.expenditures.unit})</h3>
                    <div className="sd-metric-grid">
                      {profile.expenditures.items.map((item) => (
                        <MetricTile
                          key={item.label}
                          label={item.label}
                          value={item.latest_cr != null ? fmtNum(item.latest_cr) : '—'}
                          hint={item.latest_period || undefined}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <p className="disclaimer">{summary.disclaimer}</p>
        </>
      )}
    </Page>
  );
}

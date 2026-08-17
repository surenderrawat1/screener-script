import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';
import { EvidenceStrip } from '../components/research/EvidenceStrip';
import { StockMemoLayout } from '../components/research/StockMemoLayout';
import { printResearchMemo } from '../lib/memo-export';
import { buildStockMemoView, normalizeSymbolInput } from '../lib/stock-memo-view';
import { patternChartPriceLevels } from '../lib/pattern-chart-levels';
import { mergePatternOverlays } from '../lib/pattern-chart-overlays';
import { StockDailyChart, type ChartPayload, type ChartPriceLevel } from '../components/StockDailyChart';
import { SwingRulesTable, SwingVerdictBanner } from '../components/swing/SwingRulesTable';

function trendHint(trend?: string, changePp?: number | null, period?: string): string | undefined {
  if (!trend || trend === 'unknown') return period ? `As of ${period}` : undefined;
  const arrow = trend === 'increasing' ? '↑' : trend === 'declining' ? '↓' : '→';
  const delta = changePp != null ? `${changePp >= 0 ? '+' : ''}${changePp} pp QoQ` : '';
  return [arrow, delta, period ? `· ${period}` : ''].filter(Boolean).join(' ');
}

function trendMetricClass(trend?: string, bearishWhenDeclining = true): string {
  if (bearishWhenDeclining && trend === 'declining') return 'signal-bear';
  if (!bearishWhenDeclining && trend === 'increasing') return 'signal-bull';
  if (trend === 'increasing' && bearishWhenDeclining) return 'signal-watch';
  return '';
}

interface ShareholdingCategoryView {
  latest_pct: number;
  change_pp: number | null;
  trend: string;
}

interface ShareholdingView {
  latest_period: string;
  promoter: ShareholdingCategoryView | null;
  fii: ShareholdingCategoryView | null;
  dii: ShareholdingCategoryView | null;
  source: string;
}

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
    score_basis?: 'quality_proxy' | 'full_scorecard';
    recommendation_basis?: 'screening_matrix' | 'full_verify_matrix';
    moat_tier?: string;
    moat_count?: number;
  };
  last_verify?: {
    id: string;
    mode: string;
    created_at: string;
    recommendation: string;
    mos: number | null;
    quality_score: number | null;
    recommendation_basis?: string;
    score_basis?: string;
    memo?: {
      headline?: string;
      strengths?: string[];
      risks?: string[];
      investment_case?: string;
    } | null;
  } | null;
  sources?: string[];
  from_cache?: boolean;
  data_quality?: {
    level: 'reported' | 'limited' | 'estimated';
    label: string;
    message: string;
  };
  screener_insights?: {
    pros: string[];
    cons: string[];
    warnings: Array<{
      text: string;
      severity: 'critical' | 'watch' | 'info';
      category: string;
      label: string;
    }>;
    has_critical: boolean;
    has_watch: boolean;
    source: string;
  } | null;
  shareholding?: ShareholdingView | null;
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
  patterns?: {
    ready: boolean;
    timeframe: string;
    patterns: Array<{
      id: string;
      pattern: string;
      kind: string;
      type: string;
      status: string;
      confidence: number;
      start_date: string;
      end_date: string;
      support: number | null;
      resistance: number | null;
      breakout: number | null;
      target: number | null;
      stop_loss: number | null;
      volume_confirmed: boolean;
      rsi_confirmed?: boolean;
      macd_confirmed?: boolean;
      detail: string;
      points?: Record<string, number | string>;
    }>;
    swing_count: { highs: number; lows: number };
    disclaimer: string;
    mtf?: {
      overall_signal: string;
      overall_confidence: number;
      strength_label: string;
      detail: string;
      frames: Array<{
        timeframe: string;
        label: string;
        pattern: string | null;
        type: string;
        status: string;
        confidence: number;
      }>;
    };
    backtest?: Array<{
      kind: string;
      label: string;
      timeframe: string;
      occurrences: number;
      confirmed_breakouts: number;
      target_hits: number;
      stop_hits: number;
      unresolved: number;
      success_rate_pct: number | null;
      avg_return_pct: number | null;
      avg_mfe_pct: number | null;
      avg_mae_pct: number | null;
      avg_bars_to_outcome: number | null;
      lookback_bars: number;
      forward_horizon_bars: number;
      disclaimer: string;
    }>;
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

function metricValue(metrics: Record<string, unknown>, keys: string | string[]): unknown {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const value = metrics[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

function isBankingSector(metrics: Record<string, unknown>): boolean {
  const sector = String(metrics.sector ?? '').toLowerCase();
  const industry = String(metrics.industry ?? '').toLowerCase();
  return sector.includes('bank') || sector === 'nbfc' || industry.includes('bank');
}

type FundamentalTile = {
  label: string;
  key: string | string[];
  fmt?: (v: unknown) => string;
  hint?: string;
  bankingNa?: boolean;
};

function fundamentalDisplayValue(tile: FundamentalTile, metrics: Record<string, unknown>): string {
  const value = metricValue(metrics, tile.key);
  if (tile.bankingNa && isBankingSector(metrics) && (value === undefined || value === null || value === '' || Number(value) === 0)) {
    return 'N/A for banks';
  }
  return (tile.fmt ?? fmtNum)(value);
}

const FUNDAMENTAL_TILES: FundamentalTile[] = [
  { label: 'Price', key: 'price', fmt: fmtMoney },
  { label: 'Market cap (₹ Cr)', key: ['market_cap_cr', 'market_cap', 'marketCap'] },
  { label: 'P/E', key: ['pe', 'trailing_pe', 'trailingPE'] },
  { label: 'P/B', key: ['pb_ratio', 'price_to_book', 'priceToBook'] },
  { label: 'PEG', key: ['peg_ratio', 'pegRatio'] },
  { label: 'EPS', key: 'eps', fmt: fmtMoney },
  { label: 'Book value', key: ['book_value', 'bookValue'], fmt: fmtMoney },
  { label: 'ROE', key: ['roe', 'return_on_equity', 'returnOnEquity'], fmt: (v) => fmtNum(v, '%') },
  { label: 'ROA', key: ['roa', 'return_on_assets', 'returnOnAssets'], fmt: (v) => fmtNum(v, '%') },
  { label: 'ROCE', key: 'roce', fmt: (v) => fmtNum(v, '%') },
  { label: 'Debt / equity', key: ['debt_to_equity', 'debtToEquity'] },
  { label: 'Div yield', key: ['div_yield', 'dividend_yield', 'dividendYield'], fmt: (v) => fmtNum(v, '%') },
  { label: 'Sales YoY', key: ['sales_yoy', 'revenue_growth', 'revenueGrowth'], fmt: (v) => fmtNum(v, '%') },
  { label: 'Profit YoY', key: ['profit_yoy', 'eps_growth', 'earningsGrowth'], fmt: (v) => fmtNum(v, '%') },
  { label: '52w High', key: ['high_52w', 'fiftyTwoWeekHigh'], fmt: fmtMoney },
  { label: '52w Low', key: ['low_52w', 'fiftyTwoWeekLow'], fmt: fmtMoney },
  { label: 'Gross margin', key: ['gross_margin', 'grossMargins'], fmt: (v) => fmtNum(v, '%'), bankingNa: true },
  { label: 'EBITDA margin', key: ['ebitda_margin', 'ebitdaMargins'], fmt: (v) => fmtNum(v, '%'), bankingNa: true },
  { label: 'Operating margin', key: ['operating_margin', 'operatingMargins'], fmt: (v) => fmtNum(v, '%'), bankingNa: true },
  { label: 'FCF (₹ Cr)', key: ['fcf_cr', 'free_cash_flow', 'freeCashflow'], bankingNa: true },
  { label: 'CFO (₹ Cr)', key: ['cfo_cr', 'operating_cash_flow', 'operatingCashflow'], bankingNa: true },
  { label: 'Est. Capex (₹ Cr)', key: ['capex_cr', 'capital_expenditure'], hint: 'CFO − FCF proxy', bankingNa: true },
  { label: 'Interest coverage', key: ['interest_coverage', 'interestCoverage'], bankingNa: true },
  { label: 'Total debt (₹ Cr)', key: ['total_debt_cr', 'totalDebt'], bankingNa: true },
  { label: 'Total cash (₹ Cr)', key: ['total_cash_cr', 'totalCash'], bankingNa: true },
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
  const [chartError, setChartError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [swingError, setSwingError] = useState('');
  const [swingEval, setSwingEval] = useState<Record<string, unknown> | null>(null);
  const [swingLoading, setSwingLoading] = useState(false);
  const [overlayPatternIds, setOverlayPatternIds] = useState<Set<string>>(() => new Set());

  const canRefreshLive = user?.role === 'admin' || user?.role === 'analyst';

  const loadChart = useCallback(async (sym: string, refresh = false) => {
    const normalized = normalizeSymbolInput(sym);
    if (!normalized) return;
    setChartLoading(true);
    setChartError('');
    try {
      const q = refresh ? '?refresh=true' : '';
      const data = await api<ChartResponse>(
        `/api/v1/stock/${encodeURIComponent(normalized)}/chart${q}`,
      );
      setChartData(data);
    } catch (err) {
      setChartData(null);
      setChartError(err instanceof Error ? err.message : 'Chart load failed');
    } finally {
      setChartLoading(false);
    }
  }, []);

  const loadSwing = useCallback(async (sym: string, refresh = false) => {
    const normalized = normalizeSymbolInput(sym);
    if (!normalized) return;
    setSwingLoading(true);
    setSwingError('');
    try {
      const data = await api<Record<string, unknown>>('/api/v1/swing/evaluate', {
        method: 'POST',
        body: JSON.stringify({ symbol: normalized, refresh }),
      });
      setSwingEval(data);
    } catch (err) {
      setSwingEval(null);
      setSwingError(err instanceof Error ? err.message : 'Swing evaluation unavailable');
    } finally {
      setSwingLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async (sym: string, refresh = false) => {
    const normalized = normalizeSymbolInput(sym);
    if (!normalized) return;
    setProfileLoading(true);
    setProfileError('');
    try {
      const q = refresh ? '?refresh=true' : '';
      const data = await api<{ profile: ScreenerProfile | null }>(
        `/api/v1/stock/${encodeURIComponent(normalized)}/profile${q}`,
      );
      setProfile(data.profile);
    } catch (err) {
      setProfile(null);
      setProfileError(err instanceof Error ? err.message : 'Profile load failed');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const load = useCallback(
    async (sym: string, refresh = false) => {
      const normalized = normalizeSymbolInput(sym);
      if (!normalized) return;
      setError('');
      setRefreshMsg('');
      setLoading(true);
      setChartData(null);
      setProfile(null);
      setSwingEval(null);
      setChartError('');
      setProfileError('');
      setSwingError('');
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
    const normalized = normalizeSymbolInput(sym);
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
      void loadSwing(normalized, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cache refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [loadChart, loadProfile, loadSwing]);

  useEffect(() => {
    if (routeSymbol) {
      const normalized = normalizeSymbolInput(routeSymbol);
      setQuery(normalized);
      void load(normalized, false);
    }
  }, [routeSymbol, load]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const sym = normalizeSymbolInput(query);
    if (!sym) return;
    navigate(`/stock/${encodeURIComponent(sym)}`);
  }

  const m = summary?.metrics ?? {};
  const v = summary?.valuation;
  const ta = chartData?.ta ?? {};
  const phases = chartData?.phases;
  const patterns = chartData?.patterns;

  useEffect(() => {
    const top = patterns?.patterns?.[0];
    if (top) {
      setOverlayPatternIds(new Set([top.id]));
    } else {
      setOverlayPatternIds(new Set());
    }
  }, [patterns?.patterns?.[0]?.id]);

  const togglePatternOverlay = useCallback((patternId: string) => {
    setOverlayPatternIds((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) next.delete(patternId);
      else next.add(patternId);
      return next;
    });
  }, []);

  const patternLevels = useMemo((): ChartPriceLevel[] => {
    if (!patterns?.patterns?.length) return [];
    return patterns.patterns
      .filter((p) => overlayPatternIds.has(p.id))
      .flatMap((p) => patternChartPriceLevels(p));
  }, [patterns, overlayPatternIds]);

  const patternOverlays = useMemo(() => {
    const bars = chartData?.chart?.bars;
    if (!patterns?.patterns?.length || !bars?.length) {
      return { markers: [], segments: [] };
    }
    const barTimes = bars.map((b) => String(b.time));
    const enabled = patterns.patterns.filter((p) => overlayPatternIds.has(p.id));
    return mergePatternOverlays(enabled, barTimes);
  }, [patterns, overlayPatternIds, chartData?.chart?.bars]);
  const expenditureItems = (profile?.expenditures?.items ?? []).filter(
    (item) => item.latest_cr !== null && item.latest_cr !== undefined && Number.isFinite(Number(item.latest_cr)),
  );
  const expenditureUnit = profile?.expenditures?.unit ?? 'Rs Cr';

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
              onChange={(e) => {
                setQuery(e.target.value.toUpperCase());
                setRefreshMsg('');
              }}
              placeholder="TCS"
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div className="stock-details-actions">
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
          {summary.data_quality && summary.data_quality.level !== 'reported' ? (
            <div className={`data-quality-banner data-quality-${summary.data_quality.level}`} role="alert">
              <strong>{summary.data_quality.label}</strong>
              <span>{summary.data_quality.message}</span>
            </div>
          ) : null}

          {summary.screener_insights &&
          (summary.screener_insights.warnings.length > 0 || summary.screener_insights.pros.length > 0) ? (
            <div className="card screener-insights-card">
              <h2>Screener.in checklist</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Machine-generated pros/cons from Screener.in — use as a screening aid, not a sole decision input.
              </p>
              {summary.screener_insights.warnings.length > 0 ? (
                <ul className="screener-insights-list">
                  {summary.screener_insights.warnings.map((w) => (
                    <li
                      key={`${w.label}-${w.text.slice(0, 48)}`}
                      className={`screener-insight screener-insight-${w.severity}`}
                    >
                      <span className="screener-insight-label">{w.label}</span>
                      <span>{w.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {summary.screener_insights.pros.length > 0 ? (
                <details className="screener-pros-details">
                  <summary>{summary.screener_insights.pros.length} pro(s) from Screener</summary>
                  <ul className="screener-insights-list screener-insights-pros">
                    {summary.screener_insights.pros.map((p) => (
                      <li key={p.slice(0, 60)}>{p}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {(() => {
            const memo = buildStockMemoView(summary, ta);

            return (
              <div id="stock-memo-print" className="research-print-root">
                <StockMemoLayout
                  hero={{
                    ...memo.hero,
                    actions: (
                      <div className="stock-details-actions stock-details-hero-actions no-print">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            printResearchMemo(`${summary.symbol} — ${summary.name} research memo`)
                          }
                        >
                          Export PDF
                        </button>
                        <Link
                          className="btn btn-secondary"
                          to={`/compare?a=${encodeURIComponent(summary.symbol)}&b=INFY`}
                        >
                          Compare
                        </Link>
                        <Link className="btn btn-secondary" to={`/verify/full?symbol=${encodeURIComponent(summary.symbol)}`}>
                          Full verify
                        </Link>
                        <Link className="btn btn-secondary" to={`/verify?symbol=${encodeURIComponent(summary.symbol)}`}>
                          CFA verify
                        </Link>
                        <Link className="btn btn-secondary" to={`/swing?symbol=${encodeURIComponent(summary.symbol)}`}>
                          Swing scan
                        </Link>
                        <Link className="btn btn-secondary" to={`/screener?universe=nifty50&preset=quality&show_ta=1`}>
                          Screener
                        </Link>
                        <Link className="btn btn-secondary" to={`/watchlist`}>
                          Watchlist
                        </Link>
                      </div>
                    ),
                  }}
                  pillars={memo.pillars}
                  investmentCase={memo.investmentCase}
                  strengths={memo.strengths}
                  risks={memo.risks}
                  metrics={
                    <div className="cfa-metrics-grid">
                      {memo.metricTiles.map((tile) => (
                        <div key={tile.label} className="metric-box">
                          <div className="lbl">{tile.label}</div>
                          <div className="val">{tile.value}</div>
                        </div>
                      ))}
                    </div>
                  }
                />
              </div>
            );
          })()}

          {summary.last_verify ? (
            <p className="muted stock-last-verify">
              Last verify ({summary.last_verify.mode}) · {new Date(summary.last_verify.created_at).toLocaleString()} ·{' '}
              <EvidenceStrip
                recommendationBasis={summary.last_verify.recommendation_basis}
                scoreBasis={summary.last_verify.score_basis}
                compact
              />
            </p>
          ) : null}

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
              <MetricTile label="Quick score" value={`${v.verify_score}/56`} hint="Quality proxy; Full Verify has manual gates" />
              <MetricTile label="Method" value={v.method || '—'} />
              <MetricTile label="Verdict" value={v.recommendation || '—'} />
            </div>
          </div>

          <div className="card">
            <h2>Fundamentals</h2>
            <div className="sd-metric-grid">
              {FUNDAMENTAL_TILES.map((tile) => (
                <MetricTile
                  key={Array.isArray(tile.key) ? tile.key[0] : tile.key}
                  label={tile.label}
                  value={fundamentalDisplayValue(tile, m)}
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
                  trendHint(
                    String(m.promoter_holding_trend ?? ''),
                    m.promoter_holding_change_pp != null
                      ? Number(m.promoter_holding_change_pp)
                      : null,
                    String(m.promoter_holding_as_of ?? summary.shareholding?.latest_period ?? ''),
                  ) ??
                  (m.promoter_holding_as_of
                    ? `As of ${String(m.promoter_holding_as_of)}`
                    : undefined)
                }
                className={trendMetricClass(String(m.promoter_holding_trend ?? ''), true)}
              />
              <MetricTile
                label="Promoter pledge"
                value={
                  m.promoter_pledge != null ? `${fmtNum(Number(m.promoter_pledge), '%')}` : '—'
                }
                hint={
                  m.promoter_pledge_as_of
                    ? `As of ${String(m.promoter_pledge_as_of)}`
                    : Number(m.promoter_pledge ?? 0) > 25
                      ? 'Above 25% — governance flag'
                      : undefined
                }
                className={
                  Number(m.promoter_pledge ?? 0) > 25
                    ? 'signal-bear'
                    : Number(m.promoter_pledge ?? 0) > 0
                      ? 'signal-watch'
                      : ''
                }
              />
            </div>
          </div>

          {summary.shareholding?.promoter || summary.shareholding?.fii || summary.shareholding?.dii ? (
            <div className="card">
              <h2>Shareholding pattern</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Quarterly trend from Screener.in
                {summary.shareholding.latest_period ? ` · latest ${summary.shareholding.latest_period}` : ''}
              </p>
              <div className="sd-metric-grid">
                {summary.shareholding.promoter ? (
                  <MetricTile
                    label="Promoters"
                    value={`${fmtNum(summary.shareholding.promoter.latest_pct, '%')}`}
                    hint={trendHint(
                      summary.shareholding.promoter.trend,
                      summary.shareholding.promoter.change_pp,
                      summary.shareholding.latest_period,
                    )}
                    className={trendMetricClass(summary.shareholding.promoter.trend, true)}
                  />
                ) : null}
                {summary.shareholding.fii ? (
                  <MetricTile
                    label="FII"
                    value={`${fmtNum(summary.shareholding.fii.latest_pct, '%')}`}
                    hint={trendHint(
                      summary.shareholding.fii.trend,
                      summary.shareholding.fii.change_pp,
                      summary.shareholding.latest_period,
                    )}
                    className={trendMetricClass(summary.shareholding.fii.trend, false)}
                  />
                ) : null}
                {summary.shareholding.dii ? (
                  <MetricTile
                    label="DII"
                    value={`${fmtNum(summary.shareholding.dii.latest_pct, '%')}`}
                    hint={trendHint(
                      summary.shareholding.dii.trend,
                      summary.shareholding.dii.change_pp,
                      summary.shareholding.latest_period,
                    )}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="card">
            <h2>Daily chart (2y)</h2>
            {chartLoading && <p className="muted">Loading chart…</p>}
            {chartError && !chartLoading && <p className="error">{chartError}</p>}
            {!chartLoading && (
              <StockDailyChart
                chart={chartData?.chart ?? null}
                priceLevels={patternLevels}
                overlayMarkers={patternOverlays.markers}
                overlaySegments={patternOverlays.segments}
              />
            )}
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

          {patterns?.ready && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>Chart patterns</h2>
                <Link to={`/patterns?symbol=${encodeURIComponent(routeSymbol ?? '')}`} className="btn btn-secondary btn-sm">
                  Pattern feed
                </Link>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                Daily ({patterns.timeframe}) · swings {patterns.swing_count.highs}H /{' '}
                {patterns.swing_count.lows}L · reversals, triangles, flags, cup/rounding, rectangle/channel
              </p>
              {patternLevels.length > 0 ? (
                <p className="muted">
                  {overlayPatternIds.size} pattern{overlayPatternIds.size === 1 ? '' : 's'} on chart — levels,
                  swing markers, and necklines/boundaries. Toggle per card below.
                </p>
              ) : patterns.patterns.length > 0 ? (
                <p className="muted">Enable chart overlay on a pattern card to draw levels on the chart above.</p>
              ) : null}
              {patterns.patterns.length === 0 ? (
                <p className="muted">No classic patterns detected in the current window.</p>
              ) : (
                <div className="pattern-grid">
                  {patterns.patterns.map((p) => (
                    <article
                      key={p.id}
                      className={`pattern-card signal-${p.type === 'bullish' ? 'bull' : p.type === 'bearish' ? 'bear' : 'watch'}`}
                    >
                      <div className="pattern-card-head">
                        <strong>{p.pattern}</strong>
                        <span className={`pattern-status pattern-status-${p.status}`}>{p.status}</span>
                      </div>
                      <label className="pattern-overlay-toggle">
                        <input
                          type="checkbox"
                          checked={overlayPatternIds.has(p.id)}
                          onChange={() => togglePatternOverlay(p.id)}
                        />
                        Show on chart
                      </label>
                      <div className="pattern-meta">
                        <span>{p.type}</span>
                        <span>confidence {p.confidence}</span>
                        {p.volume_confirmed ? <span>volume ✓</span> : null}
                        {p.rsi_confirmed ? <span>RSI ✓</span> : null}
                        {p.macd_confirmed ? <span>MACD ✓</span> : null}
                      </div>
                      <p className="pattern-detail">{p.detail}</p>
                      <dl className="pattern-levels">
                        <div>
                          <dt>Breakout</dt>
                          <dd>{fmtMoney(p.breakout)}</dd>
                        </div>
                        <div>
                          <dt>Target</dt>
                          <dd>{fmtMoney(p.target)}</dd>
                        </div>
                        <div>
                          <dt>Stop</dt>
                          <dd>{fmtMoney(p.stop_loss)}</dd>
                        </div>
                        <div>
                          <dt>Window</dt>
                          <dd>
                            {p.start_date} → {p.end_date}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
              {patterns.mtf && (
                <div className="pattern-mtf">
                  <h3 className="admin-subhead">Multi-timeframe</h3>
                  <p className={`phase-headline phase-bias-${patterns.mtf.overall_signal}`}>
                    Overall {patterns.mtf.overall_signal} · {patterns.mtf.strength_label} ·{' '}
                    {patterns.mtf.overall_confidence}%
                  </p>
                  <ul className="pattern-mtf-frames">
                    {patterns.mtf.frames.map((f) => (
                      <li key={f.timeframe}>
                        <strong>{f.timeframe}</strong> — {f.label}
                        <span className="muted">
                          {' '}
                          · {f.type} · {f.confidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {patterns.mtf.detail}
                  </p>
                </div>
              )}
              {patterns.backtest && patterns.backtest.length > 0 && (
                <div className="pattern-backtest">
                  <h3 className="admin-subhead">Historical pattern stats</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Walk-forward on this symbol (no look-ahead). Top pattern kinds only.
                  </p>
                  <div className="pattern-backtest-grid">
                    {patterns.backtest.map((bt) => (
                      <article key={bt.kind} className="pattern-backtest-card">
                        <div className="pattern-backtest-head">
                          <strong>{bt.label}</strong>
                          <span className="muted">{bt.timeframe}</span>
                        </div>
                        <dl className="pattern-backtest-stats">
                          <div>
                            <dt>Detected</dt>
                            <dd>{bt.occurrences}</dd>
                          </div>
                          <div>
                            <dt>Breakouts</dt>
                            <dd>{bt.confirmed_breakouts}</dd>
                          </div>
                          <div>
                            <dt>Target hit</dt>
                            <dd>{bt.target_hits}</dd>
                          </div>
                          <div>
                            <dt>Stop hit</dt>
                            <dd>{bt.stop_hits}</dd>
                          </div>
                          <div>
                            <dt>Success rate</dt>
                            <dd>{bt.success_rate_pct != null ? `${bt.success_rate_pct}%` : '—'}</dd>
                          </div>
                          <div>
                            <dt>Avg return</dt>
                            <dd>
                              {bt.avg_return_pct != null
                                ? `${bt.avg_return_pct > 0 ? '+' : ''}${bt.avg_return_pct}%`
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>Avg MFE</dt>
                            <dd>{bt.avg_mfe_pct != null ? `${bt.avg_mfe_pct}%` : '—'}</dd>
                          </div>
                          <div>
                            <dt>Avg MAE</dt>
                            <dd>{bt.avg_mae_pct != null ? `${bt.avg_mae_pct}%` : '—'}</dd>
                          </div>
                        </dl>
                        <p className="muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                          {bt.lookback_bars} bars · {bt.forward_horizon_bars}d forward horizon
                          {bt.unresolved > 0 ? ` · ${bt.unresolved} unresolved` : ''}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <p className="muted">{patterns.disclaimer}</p>
            </div>
          )}

          <div className="card">
            <h2>Technical indicators</h2>
            {chartLoading ? (
              <p className="muted">Loading TA metrics…</p>
            ) : chartError ? (
              <p className="muted">Technical indicators unavailable until chart data loads.</p>
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
              <h2>Swing entry rules (E1–E8 hard · E9–E12 soft)</h2>
              <Link to={`/swing?symbol=${summary.symbol}&mode=symbol`} className="btn btn-secondary btn-xs">
                Full swing analysis →
              </Link>
            </div>
            {swingLoading && <p className="muted">Evaluating swing rules…</p>}
            {swingError && !swingLoading && <p className="error">{swingError}</p>}
            {!swingLoading && swingEval?.entry ? (
              <>
                <SwingVerdictBanner
                  discovery={String((swingEval.entry as Record<string, unknown>).discovery_verdict ?? 'AVOID')}
                  strict={String((swingEval.entry as Record<string, unknown>).strict_verdict ?? 'AVOID')}
                  rulesPassed={Number((swingEval.entry as Record<string, unknown>).rules_passed ?? 0)}
                  entryScore={Number((swingEval.entry as Record<string, unknown>).entry_score ?? 0)}
                  rules={((swingEval.entry as Record<string, unknown>).rules as Array<{
                    id: string;
                    name: string;
                    criterion: string;
                    passed: boolean | null;
                    detail: string;
                  }>) ?? []}
                  engineVersion={String((swingEval.entry as Record<string, unknown>).engine_version ?? '')}
                />
                <p className="muted">
                  Stop {fmtMoney((swingEval.entry as Record<string, unknown>).stop_loss)} · Target{' '}
                  {fmtMoney((swingEval.entry as Record<string, unknown>).profit_target)} · R{' '}
                  {fmtNum((swingEval.entry as Record<string, unknown>).r_multiple)}
                  {' · '}
                  <Link to={`/swing/backtest?symbol=${summary.symbol}&autorun=1`}>Backtest</Link>
                </p>
                <SwingRulesTable
                  showTiers
                  rules={((swingEval.entry as Record<string, unknown>).rules as Array<{
                    id: string;
                    name: string;
                    criterion: string;
                    passed: boolean | null;
                    detail: string;
                  }>) ?? []}
                  emptyLabel="Entry rules not available."
                />
              </>
            ) : !swingLoading ? (
              <p className="muted">Swing evaluation unavailable.</p>
            ) : null}
          </div>

          <div className="card">
            <h2>Business profile</h2>
            {profileLoading && <p className="muted">Loading Screener.in profile…</p>}
            {profileError && !profileLoading && <p className="error">{profileError}</p>}
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
                {profile.business_plans?.highlights?.length > 0 && (
                  <>
                    <h3>Business plans &amp; guidance</h3>
                    <ul>
                      {profile.business_plans.highlights.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </>
                )}
                {profile.concalls?.length > 0 && (
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
                {expenditureItems.length > 0 ? (
                  <>
                    <h3>Expenditures ({expenditureUnit})</h3>
                    <div className="sd-metric-grid">
                      {expenditureItems.map((item) => (
                        <MetricTile
                          key={item.label}
                          label={item.label}
                          value={item.latest_cr != null ? fmtNum(item.latest_cr) : '—'}
                          hint={item.latest_period || undefined}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    Expenditure data unavailable from Screener for this symbol. Use Refresh data to retry.
                  </p>
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

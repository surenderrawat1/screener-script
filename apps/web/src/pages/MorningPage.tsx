import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';
import { SignalCard } from '../components/research/SignalCard';

interface RoutineStep {
  step: string;
  detail: string;
  href: string;
  status: 'ok' | 'warn' | 'info' | 'muted';
}

interface SwingRow {
  symbol: string;
  gain_pct: number | null;
  exit_verdict: string;
  current_price: number | null;
  id: string;
}

interface MorningBriefing {
  built_at: string;
  live: boolean;
  session: {
    phase: string;
    label: string;
    message: string;
    live_quotes: boolean;
    ist_time: string;
    ist_date: string;
  };
  regime: Record<string, unknown>;
  guidance: {
    tone: string;
    title: string;
    message: string;
    deploy_pct: number;
  };
  auto: {
    available: boolean;
    hits: Array<{
      symbol: string;
      decision_label: string;
      decision_score: number;
      verdict: string;
      strict_verdict: string;
      price: number | null;
    }>;
    hit_count: number;
    saved_ago: string | null;
    tier_changes?: {
      high_conviction?: { added: string[]; removed: string[] };
    } & Record<string, unknown>;
  };
  ltg_auto: {
    available: boolean;
    saved_at: string | null;
    universe: string;
    max_scan: number;
    tiers: {
      high_conviction: Array<{
        symbol: string;
        verdict: string;
        strict_verdict: string;
        decision_label: string;
        decision_score: number;
        price: number | null;
        mos: number | null;
        quality_score: number | null;
        recommendation_basis?: string;
        score_basis?: string;
      }>;
      strict_enter: Array<{
        symbol: string;
        verdict: string;
        strict_verdict: string;
        decision_label: string;
        decision_score: number;
        price: number | null;
        mos: number | null;
        quality_score: number | null;
        recommendation_basis?: string;
        score_basis?: string;
      }>;
      setup_radar: Array<{
        symbol: string;
        verdict: string;
        strict_verdict: string;
        decision_label: string;
        decision_score: number;
        price: number | null;
        mos: number | null;
        quality_score: number | null;
        recommendation_basis?: string;
        score_basis?: string;
      }>;
      breakout_surge: Array<{
        symbol: string;
        verdict: string;
        strict_verdict: string;
        decision_label: string;
        decision_score: number;
        price: number | null;
        mos: number | null;
        quality_score: number | null;
        recommendation_basis?: string;
        score_basis?: string;
      }>;
    };
  };
  swing: {
    open: number;
    exit_count: number;
    rows: SwingRow[];
    portfolio: {
      net_gain_pct: number | null;
      heat_pct: number;
      open: number;
    };
    live?: boolean;
  };
  nifty: {
    ok: boolean;
    label: string;
    tone: string;
    summary: string;
    confidence: number;
    price: number | null;
    setup_grade: string;
    instrument_label: string;
    href: string;
    as_of?: string;
  };
  alerts: string[];
  intraday: {
    open: number;
    exit_count: number;
    rows: Array<{
      label: string;
      gain_pct: number | null;
      position_action: string;
      action_label: string;
      id: string;
    }>;
    portfolio: {
      count: number;
      net_pnl_inr: number | null;
    };
    available: boolean;
    live?: boolean;
  };
  etf: {
    ok: boolean;
    error: string;
    hits: Array<{
      symbol: string;
      name: string;
      category: string;
      underlying: string;
      ter_pct: number;
      liquidity: string;
      low_liquidity: boolean;
      regime_note: string | null;
      verdict: string;
      strict_verdict: string;
      price: number | null;
      swing_rank: number;
      stale: boolean;
    }>;
    hit_count: number;
    from_cache: boolean;
    cached_ago: string | null;
    elapsed_sec: number | null;
    stale_count: number;
  };
  chart_patterns: {
    available: boolean;
    scan_date: string | null;
    pattern_count: number;
    breakout_count: number;
    confirmed_count: number;
    forming_count: number;
    hits: Array<{
      symbol: string;
      pattern: string;
      kind: string;
      type: string;
      status: string;
      confidence: number;
      timeframe: string;
    }>;
    href: string;
  };
  evening_gtt?: {
    date_key: string | null;
    order_count: number;
    regime_key?: string | null;
    built_at?: string;
    orders: Array<{
      symbol: string;
      name: string;
      tier: string;
      qty: number;
      trigger_price: number;
      limit_price: number;
      stop_loss: number | null;
      profit_target: number | null;
      copy_line: string;
    }>;
    href: string;
  };
  strategy_daily_proof?: {
    days: number;
    run_count: number;
    scoreboard: Array<{
      strategy_key: string;
      label: string;
      days: number;
      ok_days: number;
      avg_hits: number;
      last_hits: number;
      last_date: string;
    }>;
    href: string;
  };
  presets: Array<{
    id: string;
    icon: string;
    label: string;
    tone: string;
    description: string;
    href: string;
  }>;
  routine: RoutineStep[];
  disclaimer: string;
}

function sessionClass(phase: string): string {
  if (phase === 'open') return 'morning-session-open';
  if (phase === 'weekend' || phase === 'post') return 'morning-session-closed';
  return 'morning-session-pre';
}

function statusDot(status: RoutineStep['status']): string {
  return `routine-dot routine-dot-${status}`;
}

function guidanceClass(tone: string): string {
  if (tone === 'success') return 'regime-bull';
  if (tone === 'danger') return 'regime-bear';
  if (tone === 'warning') return 'regime-warn';
  return 'regime-neutral';
}

function niftyClass(tone: string): string {
  if (tone === 'bullish') return 'nifty-bull';
  if (tone === 'bearish') return 'nifty-bear';
  return 'nifty-neutral';
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n}%`;
}

function riskPosture(briefing: MorningBriefing): { label: string; tone: 'danger' | 'warn' | 'ok'; detail: string } {
  if (briefing.swing.exit_count > 0 || briefing.intraday.exit_count > 0 || briefing.alerts.length > 0) {
    return {
      label: 'Risk first',
      tone: 'danger',
      detail: 'Resolve exit signals and alerts before adding new exposure.',
    };
  }
  if (briefing.guidance.deploy_pct < 70 || briefing.swing.portfolio.heat_pct >= 3) {
    return {
      label: 'Selective',
      tone: 'warn',
      detail: 'Keep sizing conservative; prioritize only highest-quality setups.',
    };
  }
  return {
    label: 'Constructive',
    tone: 'ok',
    detail: 'No urgent book alerts; review new ideas after session and regime checks.',
  };
}

function morningActions(briefing: MorningBriefing): Array<{ label: string; detail: string; href: string; tone: 'danger' | 'warn' | 'ok' | 'info' }> {
  const actions: Array<{ label: string; detail: string; href: string; tone: 'danger' | 'warn' | 'ok' | 'info' }> = [];
  if (briefing.swing.exit_count > 0) {
    actions.push({
      label: 'Manage swing exits',
      detail: `${briefing.swing.exit_count} open swing position(s) have EXIT signals.`,
      href: '/positions',
      tone: 'danger',
    });
  }
  if (briefing.intraday.exit_count > 0) {
    actions.push({
      label: 'Manage intraday exits',
      detail: `${briefing.intraday.exit_count} intraday position(s) need action.`,
      href: '/intraday/positions',
      tone: 'danger',
    });
  }
  const signalCount =
    briefing.swing.exit_count +
    briefing.intraday.exit_count +
    (briefing.auto.hit_count ?? 0) +
    (briefing.chart_patterns.available ? briefing.chart_patterns.hits.length : 0);
  if (signalCount > 0) {
    actions.push({
      label: 'Open signals inbox',
      detail: `${signalCount} actionable item(s) across exits, HC radar, and chart patterns.`,
      href: '/signals',
      tone: briefing.swing.exit_count + briefing.intraday.exit_count > 0 ? 'danger' : 'ok',
    });
  }
  if (briefing.nifty.ok) {
    actions.push({
      label: 'Check intraday cockpit',
      detail: `${briefing.nifty.label} · grade ${briefing.nifty.setup_grade || '—'} · ${briefing.nifty.confidence}% confidence.`,
      href: briefing.nifty.href,
      tone: briefing.nifty.tone === 'neutral' ? 'info' : 'ok',
    });
  }
  if (briefing.auto.available && briefing.auto.hit_count > 0) {
    actions.push({
      label: 'Review high-conviction swing ideas',
      detail: `${briefing.auto.hit_count} radar names available from latest snapshot.`,
      href: '/swing/auto?tier=high_conviction',
      tone: 'ok',
    });
  }
  if ((briefing.evening_gtt?.order_count ?? 0) > 0) {
    actions.push({
      label: 'Place evening GTT orders',
      detail: `${briefing.evening_gtt!.order_count} GTT line(s) from ${briefing.evening_gtt!.date_key ?? 'last close'} — copy on Signals.`,
      href: briefing.evening_gtt!.href || '/signals',
      tone: 'ok',
    });
  }
  actions.push({
    label: 'Run quality screener',
    detail: 'Nifty 50 · quality compounders — verify top names before sizing.',
    href: '/screener?preset=quality&universe=nifty50',
    tone: 'info',
  });
  actions.push({
    label: 'Scan EMA momentum setups',
    detail: 'Daily fresh cross ↑ EMA-20 with quality gates.',
    href: '/screener?preset=ta_fresh_ema20_cross&universe=nifty50&show_ta=1',
    tone: 'info',
  });
  if (briefing.auto.available && briefing.auto.hits.length > 0) {
    const top = briefing.auto.hits[0]?.symbol;
    actions.push({
      label: 'Verify top HC name',
      detail: top ? `Quick CFA verify on ${top}.` : 'Quick verify on top high-conviction hit.',
      href: top ? `/verify?symbol=${encodeURIComponent(top)}` : '/verify',
      tone: 'info',
    });
  }
  if (briefing.etf.hit_count > 0) {
    actions.push({
      label: 'Review ETF SETUP+ book',
      detail: `${briefing.etf.hit_count} ETF candidates; ${briefing.etf.stale_count} stale.`,
      href: '/swing?universe=swing_etf',
      tone: briefing.etf.stale_count > 0 ? 'warn' : 'info',
    });
  }
  if (briefing.chart_patterns.available && briefing.chart_patterns.hits.length > 0) {
    actions.push({
      label: 'Review chart pattern feed',
      detail: `${briefing.chart_patterns.breakout_count} breakout · ${briefing.chart_patterns.confirmed_count} confirmed · scan ${briefing.chart_patterns.scan_date ?? '—'}.`,
      href: briefing.chart_patterns.href,
      tone: briefing.chart_patterns.breakout_count > 0 ? 'ok' : 'info',
    });
  }
  if (actions.length === 0) {
    actions.push({
      label: 'Stand aside / maintain watchlist',
      detail: 'No urgent risk alerts or high-priority new setup in the current briefing.',
      href: '/screener?preset=quality&universe=nifty50',
      tone: 'info',
    });
  }
  return actions;
}

function MorningCfaCockpit({ briefing }: { briefing: MorningBriefing }) {
  const posture = riskPosture(briefing);
  const actions = morningActions(briefing);
  const urgentCount = briefing.swing.exit_count + briefing.intraday.exit_count + briefing.alerts.length;
  return (
    <section className={`card morning-cfa-cockpit posture-${posture.tone}`}>
      <div className="morning-cfa-head">
        <div>
          <span className={`morning-posture-pill posture-${posture.tone}`}>{posture.label}</span>
          <h2>Senior CFA morning decision cockpit</h2>
          <p className="muted">{posture.detail}</p>
        </div>
        <div className="morning-cfa-time">
          <strong>{briefing.session.label}</strong>
          <span>{briefing.session.ist_date} · {briefing.session.ist_time} IST</span>
        </div>
      </div>

      <div className="morning-cfa-grid">
        <div className="morning-cfa-tile">
          <span>Priority alerts</span>
          <strong className={urgentCount > 0 ? 'morning-danger' : 'morning-ok'}>{urgentCount}</strong>
          <small>Swing exits + intraday exits + alerts</small>
        </div>
        <div className="morning-cfa-tile">
          <span>Regime deploy</span>
          <strong>{briefing.guidance.deploy_pct}%</strong>
          <small>{String(briefing.regime.label ?? briefing.regime.key ?? '—')}</small>
        </div>
        <div className="morning-cfa-tile">
          <span>Swing book</span>
          <strong>{briefing.swing.open} open</strong>
          <small>
            Heat {briefing.swing.portfolio.heat_pct}% · avg {fmtPct(briefing.swing.portfolio.net_gain_pct)}
          </small>
        </div>
        <div className="morning-cfa-tile">
          <span>Intraday</span>
          <strong>{briefing.nifty.ok ? briefing.nifty.label : 'Unavailable'}</strong>
          <small>
            Grade {briefing.nifty.setup_grade || '—'} · {briefing.nifty.confidence || 0}% confidence
          </small>
        </div>
        <div className="morning-cfa-tile">
          <span>New ideas</span>
          <strong>{briefing.auto.available ? briefing.auto.hit_count : 0}</strong>
          <small>Swing Auto high-conviction snapshot</small>
        </div>
        <div className="morning-cfa-tile">
          <span>ETF book</span>
          <strong>{briefing.etf.hit_count}</strong>
          <small>{briefing.etf.cached_ago ? `Cached ${briefing.etf.cached_ago}` : 'Latest available'}</small>
        </div>
        <div className="morning-cfa-tile">
          <span>Patterns</span>
          <strong>{briefing.chart_patterns.available ? briefing.chart_patterns.pattern_count : 0}</strong>
          <small>
            {briefing.chart_patterns.breakout_count} breakout · scan{' '}
            {briefing.chart_patterns.scan_date ?? '—'}
          </small>
        </div>
      </div>

      <div className="morning-action-queue">
        <h3>Action queue</h3>
        <ol>
          {actions.slice(0, 5).map((action) => (
            <li key={action.label} className={`morning-action-${action.tone}`}>
              <Link to={action.href}>{action.label}</Link>
              <span>{action.detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function MorningPage() {
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [refreshingEtf, setRefreshingEtf] = useState(false);

  const loadBriefing = useCallback((useLive: boolean, refreshEtf = false) => {
    if (!refreshEtf) {
      setLoading(true);
    }
    setError('');
    const params = new URLSearchParams();
    if (!useLive) params.set('live', '0');
    if (refreshEtf) params.set('refresh_etf', '1');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return api<MorningBriefing>(`/api/v1/morning${qs}`)
      .then(setBriefing)
      .catch((err) => {
        if (!refreshEtf) setBriefing(null);
        setError(err instanceof Error ? err.message : 'Failed to load morning briefing');
      })
      .finally(() => {
        if (!refreshEtf) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadBriefing(live);
  }, [live, loadBriefing]);

  async function refreshEtfBook() {
    setRefreshingEtf(true);
    setError('');
    try {
      await loadBriefing(live, true);
    } finally {
      setRefreshingEtf(false);
    }
  }

  const regime = briefing?.regime ?? {};
  const guidance = briefing?.guidance;

  return (
    <Page>
      <PageHeader
        title="Morning Routine"
        subtitle="Pre-market cockpit — regime, checklist, and auto radar"
        actions={
          <label className="morning-live-toggle">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            Live position quotes
          </label>
        }
      />

      {loading && <p className="muted">Loading briefing…</p>}
      {error && <p className="error">{error}</p>}

      {briefing && (
        <>
          <div className={`card morning-session ${sessionClass(briefing.session.phase)}`}>
            <div className="morning-session-row">
              <div>
                <strong>{briefing.session.label}</strong>
                <span className="muted" style={{ marginLeft: '0.75rem' }}>
                  {briefing.session.ist_date} · {briefing.session.ist_time} IST
                </span>
              </div>
              {briefing.session.live_quotes && (
                <span className="badge badge-buy">Live quotes</span>
              )}
            </div>
            <p className="muted" style={{ margin: '0.5rem 0 0' }}>
              {briefing.session.message}
            </p>
          </div>

          <MorningCfaCockpit briefing={briefing} />

          <div className="morning-panels" style={{ marginBottom: 16 }}>
            <section className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Evening GTT · last digest</h2>
                <Link to={briefing.evening_gtt?.href || '/signals'} className="btn btn-sm btn-secondary">
                  Open Signals board
                </Link>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                {briefing.evening_gtt?.date_key
                  ? `${briefing.evening_gtt.date_key} · ${briefing.evening_gtt.order_count} order(s)${
                      briefing.evening_gtt.regime_key ? ` · ${briefing.evening_gtt.regime_key}` : ''
                    }`
                  : 'No evening GTT digest yet — worker builds at 16:00 IST (HC + Strict ENTER).'}
              </p>
              {(briefing.evening_gtt?.orders?.length ?? 0) > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {briefing.evening_gtt!.orders.slice(0, 5).map((o) => (
                    <li key={o.symbol} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, marginBottom: 4 }}>
                      {o.copy_line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <h2 style={{ marginTop: 0, marginBottom: 0 }}>Strategy daily proof</h2>
                <Link to={briefing.strategy_daily_proof?.href || '/strategies'} className="btn btn-sm btn-secondary">
                  Scoreboard
                </Link>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                {(briefing.strategy_daily_proof?.run_count ?? 0) > 0
                  ? `${briefing.strategy_daily_proof!.run_count} run row(s) in last ${briefing.strategy_daily_proof!.days} days`
                  : 'No daily strategy proof rows yet — worker batch at 16:15 IST.'}
              </p>
              {(briefing.strategy_daily_proof?.scoreboard?.length ?? 0) > 0 ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {briefing.strategy_daily_proof!.scoreboard.slice(0, 4).map((row) => (
                    <li key={row.strategy_key}>
                      <strong>{row.label}</strong> · avg {row.avg_hits} hits · last {row.last_hits} ({row.last_date})
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>

          {briefing.presets.length > 0 && (
            <div className="morning-presets" aria-label="Trading presets">
              <span className="muted">Trade today:</span>
              {briefing.presets.map((preset) => (
                <Link
                  key={preset.id}
                  to={preset.href}
                  className={`morning-preset-chip morning-preset-${preset.tone}`}
                  title={preset.description}
                >
                  {preset.icon} {preset.label}
                </Link>
              ))}
              <Link to="/presets" className="muted morning-presets-more">
                All presets →
              </Link>
            </div>
          )}

          {briefing.alerts.length > 0 && (
            <div className="morning-alerts" role="alert">
              <strong>Action required</strong>
              <ul>
                {briefing.alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </div>
          )}

          {guidance && (
            <div className={`card regime-hero ${guidanceClass(guidance.tone)}`}>
              <h2 style={{ marginTop: 0 }}>1. Market regime and capital deployment</h2>
              <p className="regime-key">
                {String(regime.label ?? regime.key ?? '—')}
                {regime.ret_20d != null ? (
                  <span className="muted">
                    {' '}
                    · 20d {String(regime.ret_20d)}% · 60d {String(regime.ret_60d ?? '—')}%
                  </span>
                ) : null}
              </p>
              <p>
                <strong>{guidance.title}</strong> — deploy up to {guidance.deploy_pct}%
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                {guidance.message}
              </p>
              <Link to="/swing/auto" className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>
                Open Auto Radar
              </Link>
            </div>
          )}

          <div className="morning-panels">
            <div className={`card morning-nifty ${niftyClass(briefing.nifty.tone)}`}>
              <h2>2. Intraday index read · {briefing.nifty.instrument_label}</h2>
              {briefing.nifty.ok ? (
                <>
                  <p className="nifty-direction">
                    <strong>{briefing.nifty.label}</strong>
                    {briefing.nifty.setup_grade ? (
                      <span className="badge badge-muted">Grade {briefing.nifty.setup_grade}</span>
                    ) : null}
                  </p>
                  <p className="muted">{briefing.nifty.summary}</p>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {briefing.nifty.price != null ? `₹${briefing.nifty.price}` : '—'}
                    {briefing.nifty.confidence > 0 ? ` · ${briefing.nifty.confidence}% confidence` : ''}
                  </p>
                </>
              ) : (
                <p className="muted">{briefing.nifty.summary}</p>
              )}
              <Link to={briefing.nifty.href} className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>
                Open intraday cockpit
              </Link>
            </div>

            <div className="card">
              <h2>3. Swing book risk</h2>
              <p className="muted">
                {briefing.swing.open} open
                {briefing.swing.exit_count > 0 ? ` · ${briefing.swing.exit_count} EXIT` : ''}
                {briefing.swing.portfolio.net_gain_pct != null
                  ? ` · avg ${briefing.swing.portfolio.net_gain_pct > 0 ? '+' : ''}${briefing.swing.portfolio.net_gain_pct}%`
                  : ''}
                {briefing.swing.portfolio.heat_pct > 0
                  ? ` · heat ${briefing.swing.portfolio.heat_pct}%`
                  : ''}
                {!briefing.live && ' · cached (fast mode)'}
              </p>
              {briefing.swing.rows.length === 0 ? (
                <p className="muted">
                  No open positions —{' '}
                  <Link to="/positions">manage swing book</Link>
                </p>
              ) : (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Gain</th>
                      <th>Verdict</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {briefing.swing.rows.map((row) => (
                      <tr key={row.id || row.symbol}>
                        <td>
                          <Link to={`/stock/${encodeURIComponent(row.symbol)}`}>{row.symbol}</Link>
                        </td>
                        <td>
                          {row.gain_pct != null
                            ? `${row.gain_pct > 0 ? '+' : ''}${row.gain_pct}%`
                            : '—'}
                        </td>
                        <td>
                          <span
                            className={
                              row.exit_verdict === 'EXIT'
                                ? 'badge badge-sell'
                                : row.exit_verdict === 'HOLD'
                                  ? 'badge badge-buy'
                                  : 'badge badge-muted'
                            }
                          >
                            {row.exit_verdict || '—'}
                          </span>
                        </td>
                        <td>{row.current_price != null ? `₹${row.current_price}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link to="/positions" className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>
                All positions
              </Link>
            </div>

            <div className="card">
              <h2>4. Intraday ledger risk</h2>
              <p className="muted">
                {briefing.intraday.open} open
                {briefing.intraday.exit_count > 0 ? ` · ${briefing.intraday.exit_count} exit signal(s)` : ''}
                {briefing.intraday.portfolio.net_pnl_inr != null
                  ? ` · P&L ${fmtMoney(briefing.intraday.portfolio.net_pnl_inr)}`
                  : ''}
                {!briefing.live && ' · cached (fast mode)'}
              </p>
              {briefing.intraday.rows.length === 0 ? (
                <p className="muted">
                  No open intraday trades —{' '}
                  <Link to="/intraday/positions">log from radar</Link>
                </p>
              ) : (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Gain</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {briefing.intraday.rows.map((row) => (
                      <tr key={row.id || row.label}>
                        <td>{row.label}</td>
                        <td>
                          {row.gain_pct != null
                            ? `${row.gain_pct > 0 ? '+' : ''}${row.gain_pct}%`
                            : '—'}
                        </td>
                        <td>
                          <span
                            className={
                              row.position_action.startsWith('EXIT') || row.position_action === 'CUT_LOSS'
                                ? 'badge badge-sell'
                                : row.position_action === 'HOLD'
                                  ? 'badge badge-buy'
                                  : 'badge badge-muted'
                            }
                          >
                            {row.action_label || row.position_action || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link to="/intraday/positions" className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>
                Nifty positions
              </Link>
            </div>
          </div>

          <div className="card">
            <h2>5. Operating checklist</h2>
            <ul className="routine-list">
              {briefing.routine.map((step) => (
                <li key={step.step} className="routine-item">
                  <span className={statusDot(step.status)} aria-hidden />
                  <div className="routine-body">
                    <Link to={step.href}>{step.step}</Link>
                    <div className="muted">{step.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="morning-card-header">
              <h2>6. ETF SETUP+ book</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={refreshEtfBook}
                disabled={refreshingEtf}
              >
                {refreshingEtf ? 'Scanning…' : 'Refresh ETF book'}
              </button>
            </div>
            {briefing.etf.error && <p className="error">{briefing.etf.error}</p>}
            <p className="muted">
              {briefing.etf.hit_count} SETUP+ hits
              {briefing.etf.cached_ago ? ` · cached ${briefing.etf.cached_ago}` : ''}
              {briefing.etf.elapsed_sec != null && !briefing.etf.from_cache
                ? ` · scan ${briefing.etf.elapsed_sec}s`
                : ''}
              {briefing.etf.stale_count > 0 ? ` · ${briefing.etf.stale_count} stale` : ''}
            </p>
            {briefing.etf.hits.length === 0 ? (
              <p className="muted">
                No SETUP+ ETFs in latest scan —{' '}
                <Link to="/swing">open swing scanner</Link>
              </p>
            ) : (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>TER</th>
                    <th>Verdict</th>
                    <th>Rank</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {briefing.etf.hits.map((hit) => (
                    <tr key={hit.symbol}>
                      <td>
                        <Link to={`/stock/${encodeURIComponent(hit.symbol)}`}>{hit.symbol}</Link>
                        {hit.low_liquidity && (
                          <span className="badge badge-muted" style={{ marginLeft: '0.35rem' }}>
                            Low liq
                          </span>
                        )}
                        {hit.stale && (
                          <span className="badge badge-muted" style={{ marginLeft: '0.35rem' }}>
                            Stale
                          </span>
                        )}
                      </td>
                      <td>
                        {hit.name}
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          {hit.category} · {hit.underlying}
                        </div>
                        {hit.regime_note && (
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {hit.regime_note}
                          </div>
                        )}
                      </td>
                      <td>{hit.ter_pct}%</td>
                      <td>{hit.strict_verdict || hit.verdict}</td>
                      <td>{hit.swing_rank}</td>
                      <td>{hit.price != null ? `₹${hit.price}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Link to="/swing?universe=swing_etf" className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>
              Full ETF swing scan
            </Link>
          </div>

          <div className="card">
            <div className="morning-card-header">
              <h2>7. Chart patterns (daily scan)</h2>
              <Link to={briefing.chart_patterns.href} className="btn btn-secondary">
                Full pattern feed
              </Link>
            </div>
            {!briefing.chart_patterns.available ? (
              <p className="muted">
                No stored pattern scan yet — runs during daily sync or when you open Stock Details charts.
              </p>
            ) : (
              <>
                <p className="muted">
                  Scan {briefing.chart_patterns.scan_date} · {briefing.chart_patterns.pattern_count} total ·{' '}
                  {briefing.chart_patterns.breakout_count} breakout · {briefing.chart_patterns.confirmed_count}{' '}
                  confirmed · {briefing.chart_patterns.forming_count} forming
                </p>
                {briefing.chart_patterns.hits.length === 0 ? (
                  <p className="muted">No breakout/confirmed patterns above confidence threshold.</p>
                ) : (
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Pattern</th>
                        <th>Status</th>
                        <th>Bias</th>
                        <th>Conf.</th>
                        <th>TF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {briefing.chart_patterns.hits.map((hit) => (
                        <tr key={`${hit.symbol}-${hit.kind}-${hit.timeframe}`}>
                          <td>
                            <Link to={`/stock/${hit.symbol}`}>{hit.symbol}</Link>
                          </td>
                          <td>{hit.pattern}</td>
                          <td>
                            <span className={`pattern-status pattern-status-${hit.status}`}>{hit.status}</span>
                          </td>
                          <td>{hit.type}</td>
                          <td>{hit.confidence}%</td>
                          <td>{hit.timeframe}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h2>8. Swing Auto · high conviction</h2>
            {!briefing.auto.available && (
              <p className="muted">
                No snapshot yet —{' '}
                <Link to="/swing/auto">run Swing Auto scan</Link> to populate this panel.
              </p>
            )}
            {briefing.auto.available && (
              <>
                <p className="muted">
                  {briefing.auto.hit_count} names · saved {briefing.auto.saved_ago ?? '—'}
                </p>
                {briefing.auto.tier_changes?.high_conviction?.added?.length ? (
                  <p className="muted" style={{ marginTop: '-0.25rem' }}>
                    Overnight tier changes: +{briefing.auto.tier_changes.high_conviction.added.length} added HC ·{' '}
                    -{briefing.auto.tier_changes.high_conviction.removed.length} removed
                  </p>
                ) : null}
                {briefing.auto.hits.length === 0 ? (
                  <p className="muted">No high-conviction hits in latest snapshot.</p>
                ) : (
                  <div className="signal-card-grid">
                    {briefing.auto.hits.map((hit) => (
                      <SignalCard
                        key={hit.symbol}
                        variant="card"
                        symbol={hit.symbol}
                        verdict={hit.strict_verdict || hit.verdict}
                        verdictClassName="badge badge-buy"
                        decisionLabel={hit.decision_label}
                        decisionScore={hit.decision_score}
                        price={hit.price}
                        highConviction
                        recommendationBasis="screening_matrix"
                        scoreBasis="quality_proxy"
                        econStatus="unproven"
                        actions={
                          <>
                            <Link
                              to={`/verify?symbol=${encodeURIComponent(hit.symbol)}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Verify
                            </Link>
                            <Link
                              to={`/swing/auto?tier=high_conviction`}
                              className="btn btn-secondary btn-sm"
                            >
                              Auto Radar
                            </Link>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h2>9. LTG Auto · high conviction</h2>
            {!briefing.ltg_auto?.available ? (
              <p className="muted">
                No snapshot yet —{' '}
                <Link to="/ltg/auto">run LTG auto scan</Link> to populate this panel.
              </p>
            ) : (
              <>
                <p className="muted">
                  {briefing.ltg_auto.tiers.high_conviction.length} names · saved{' '}
                  {briefing.ltg_auto.saved_at ? new Date(briefing.ltg_auto.saved_at).toLocaleString('en-IN') : '—'}
                </p>
                {briefing.ltg_auto.tiers.high_conviction.length === 0 ? (
                  <p className="muted">No LTG high-conviction hits in latest snapshot.</p>
                ) : (
                  <div className="signal-card-grid">
                    {briefing.ltg_auto.tiers.high_conviction.slice(0, 5).map((hit) => {
                      const mos = hit.mos;
                      const econStatus =
                        mos == null ? 'missing' : mos >= 20 ? 'pass' : mos <= 0 ? 'fail' : 'unproven';
                      return (
                        <SignalCard
                          key={hit.symbol}
                          variant="card"
                          symbol={hit.symbol}
                          verdict={hit.strict_verdict || hit.verdict}
                          verdictClassName="badge badge-buy"
                          decisionLabel={hit.decision_label}
                          decisionScore={hit.decision_score}
                          price={hit.price}
                          qualityScore={hit.quality_score}
                          highConviction
                          recommendationBasis={hit.recommendation_basis}
                          scoreBasis={hit.score_basis}
                          mos={hit.mos}
                          econStatus={econStatus}
                          actions={
                            <>
                              <Link
                                to={`/verify?symbol=${encodeURIComponent(hit.symbol)}`}
                                className="btn btn-secondary btn-sm"
                              >
                                Verify
                              </Link>
                              <Link
                                to={`/ltg/auto`}
                                className="btn btn-secondary btn-sm"
                              >
                                LTG Auto
                              </Link>
                            </>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          <p className="disclaimer">{briefing.disclaimer}</p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Built {new Date(briefing.built_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          </p>
        </>
      )}
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

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
              <h2 style={{ marginTop: 0 }}>Swing regime · NIFTYBEES</h2>
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
              <h2>Nifty 15m · {briefing.nifty.instrument_label}</h2>
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
              <h2>Open swing positions</h2>
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
              <h2>Intraday ledger</h2>
              <p className="muted">
                {briefing.intraday.open} open
                {briefing.intraday.exit_count > 0 ? ` · ${briefing.intraday.exit_count} exit signal(s)` : ''}
                {briefing.intraday.portfolio.net_pnl_inr != null
                  ? ` · P&L ₹${briefing.intraday.portfolio.net_pnl_inr}`
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
            <h2>Morning checklist</h2>
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
              <h2>ETF SETUP+ book</h2>
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
            <h2>Swing Auto · high conviction</h2>
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
                {briefing.auto.hits.length === 0 ? (
                  <p className="muted">No high-conviction hits in latest snapshot.</p>
                ) : (
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Verdict</th>
                        <th>Action</th>
                        <th>Score</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {briefing.auto.hits.map((hit) => (
                        <tr key={hit.symbol}>
                          <td>
                            <Link to={`/stock/${encodeURIComponent(hit.symbol)}`}>{hit.symbol}</Link>
                          </td>
                          <td>{hit.strict_verdict || hit.verdict}</td>
                          <td>{hit.decision_label}</td>
                          <td>{hit.decision_score}</td>
                          <td>{hit.price != null ? `₹${hit.price}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

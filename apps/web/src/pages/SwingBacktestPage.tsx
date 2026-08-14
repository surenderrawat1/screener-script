import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

interface Universe {
  key: string;
  name: string;
  symbolCount: number;
}

interface BacktestStats {
  signal_count: number;
  enter_count: number;
  setup_count: number;
  target_hit_rate_pct: number | null;
  stop_hit_rate_pct: number | null;
  avg_forward_return_pct: number | null;
  win_rate_pct: number | null;
  trades_closed?: number;
  trade_win_rate_pct?: number | null;
  profit_factor?: number | null;
  avg_hold_days?: number | null;
  net_pnl_inr?: number | null;
  expectancy_pct?: number | null;
  compounded_return_pct?: number | null;
  max_drawdown_pct?: number | null;
  avg_realized_r?: number | null;
  economic_edge_status?: string;
  economic_edge_ok?: boolean;
}

interface RuleSnap {
  id: string;
  name: string;
  criterion?: string;
  passed: boolean | null;
  detail: string;
}

interface EntryWhy {
  summary: string;
  discovery_verdict: string;
  strict_verdict: string;
  entry_score: number | null;
  rules_passed: number;
  rules_hard_passed: number;
  rules_hard_total: number;
  rules_soft_passed: number;
  rules_soft_total: number;
  r_multiple: number | null;
  r_multiple_ok: boolean;
  stop_loss: number | null;
  profit_target: number | null;
  target_pct: number | null;
  passed_rule_ids: string[];
  failed_rule_ids: string[];
  soft_rule_ids: string[];
  rules: RuleSnap[];
}

interface ExitWhy {
  summary: string;
  reason: string;
  triggers: string[];
  trigger_labels: string[];
  details: string[];
  peak_gain_pct: number | null;
  gain_pct: number | null;
  active_stop: number | null;
  trail_armed: boolean | null;
  breakeven_armed: boolean | null;
  profit_lock_armed: boolean | null;
  rules: RuleSnap[];
}

interface BacktestTrade {
  symbol?: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  days_held: number;
  pnl_pct: number;
  net_pnl_inr: number | null;
  exit_reason: string;
  exit_triggers: string[];
  exit_path?: string;
  realized_r?: number | null;
  stop_loss?: number | null;
  profit_target?: number | null;
  r_multiple?: number | null;
  peak_gain_pct?: number | null;
  entry_why?: EntryWhy;
  exit_why?: ExitWhy;
}

interface PortfolioSummary {
  trades_closed: number;
  trade_win_rate_pct: number | null;
  profit_factor: number | null;
  avg_hold_days: number | null;
  net_pnl_inr: number | null;
  symbols_tested: number;
  entries_blocked: number;
  entries_accepted: number;
  portfolio_nav_inr: number;
  portfolio_gates: boolean;
  max_open_positions: number;
  max_heat_pct: number;
  notional_inr: number;
}

interface BacktestSignal {
  date: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  rules_passed: number;
  forward_return_pct: number | null;
  hit_target: boolean;
  hit_stop: boolean;
  stop_loss?: number | null;
  profit_target?: number | null;
  r_multiple?: number | null;
  entry_why?: EntryWhy;
}

interface BacktestResult {
  ok: boolean;
  symbol: string;
  bars_used: number;
  warmup: number;
  chart_from?: string;
  chart_to?: string;
  lookback_years?: number;
  method?: string;
  stats: BacktestStats;
  trades?: BacktestTrade[];
  signals: BacktestSignal[];
  engine_version?: string;
  disclaimer?: string;
  economic?: {
    min_expectancy_pct: number;
    min_profit_factor: number;
    max_drawdown_pct: number;
    status: string;
    pass: boolean;
  };
  auto_tiers?: {
    ok: boolean;
    hc_note?: string;
    tiers: Array<{
      tier: string;
      label: string;
      signals: number;
      trades: number;
      expectancy_pct: number;
      profit_factor: number;
      compounded_return_pct: number;
      max_drawdown_pct: number;
      win_rate_pct: number;
      grade: string;
      edge: string;
    }>;
  } | null;
}

function RuleList({ rules, title }: { rules: RuleSnap[]; title: string }) {
  if (!rules.length) return null;
  return (
    <div className="bt-why-rules">
      <div className="swing-pnl-section">{title}</div>
      {rules.map((r) => (
        <div key={r.id} className="bt-why-rule">
          <span
            className={
              r.passed === true ? 'intraday-pos' : r.passed === false ? 'intraday-neg' : 'muted'
            }
          >
            {r.id}
          </span>{' '}
          <strong>{r.name}</strong>
          <span className="muted"> — {r.detail}</span>
        </div>
      ))}
    </div>
  );
}

function EntryWhyBlock({ why }: { why?: EntryWhy }) {
  if (!why) return <span className="muted">—</span>;
  return (
    <details className="bt-why">
      <summary title={why.summary}>{why.summary}</summary>
      <div className="bt-why-body">
        <div className="swing-pnl-row">
          <span>Discovery / Strict</span>
          <span>
            {why.discovery_verdict} → {why.strict_verdict}
          </span>
        </div>
        <div className="swing-pnl-row">
          <span>Score / hard / soft</span>
          <span>
            {why.entry_score ?? '—'} · {why.rules_hard_passed}/{why.rules_hard_total} ·{' '}
            {why.rules_soft_passed}/{why.rules_soft_total}
          </span>
        </div>
        <div className="swing-pnl-row">
          <span>R / stop / target</span>
          <span>
            {why.r_multiple ?? '—'}
            {why.r_multiple_ok ? '' : ' (low)'} · SL ₹{why.stop_loss ?? '—'} · TG ₹
            {why.profit_target ?? '—'}
            {why.target_pct != null ? ` (${why.target_pct}%)` : ''}
          </span>
        </div>
        {why.passed_rule_ids.length > 0 && (
          <div className="swing-pnl-row">
            <span>Passed</span>
            <span className="intraday-pos">{why.passed_rule_ids.join(', ')}</span>
          </div>
        )}
        {why.failed_rule_ids.length > 0 && (
          <div className="swing-pnl-row">
            <span>Failed</span>
            <span className="intraday-neg">{why.failed_rule_ids.join(', ')}</span>
          </div>
        )}
        {why.soft_rule_ids.length > 0 && (
          <div className="swing-pnl-row">
            <span>Soft / null</span>
            <span className="muted">{why.soft_rule_ids.join(', ')}</span>
          </div>
        )}
        <RuleList rules={why.rules} title="Entry rules E1–E12" />
      </div>
    </details>
  );
}

function ExitWhyBlock({ why, fallbackReason, fallbackTriggers }: {
  why?: ExitWhy;
  fallbackReason?: string;
  fallbackTriggers?: string[];
}) {
  if (!why) {
    return (
      <span className="muted">
        {fallbackReason ?? '—'}
        {fallbackTriggers?.length ? ` (${fallbackTriggers.join(', ')})` : ''}
      </span>
    );
  }
  return (
    <details className="bt-why">
      <summary title={why.summary}>{why.summary}</summary>
      <div className="bt-why-body">
        <div className="swing-pnl-row">
          <span>Reason / triggers</span>
          <span>
            {why.reason} · {why.triggers.join(', ') || '—'}
          </span>
        </div>
        <div className="swing-pnl-row">
          <span>Labels</span>
          <span>{why.trigger_labels.join(' + ') || '—'}</span>
        </div>
        <div className="swing-pnl-row">
          <span>Peak / exit P&amp;L</span>
          <span>
            {why.peak_gain_pct != null ? `+${why.peak_gain_pct}%` : '—'} ·{' '}
            {why.gain_pct != null ? `${why.gain_pct >= 0 ? '+' : ''}${why.gain_pct}%` : '—'}
          </span>
        </div>
        <div className="swing-pnl-row">
          <span>Stops armed</span>
          <span>
            active ₹{why.active_stop ?? '—'}
            {why.breakeven_armed ? ' · CTC' : ''}
            {why.profit_lock_armed ? ' · lock' : ''}
            {why.trail_armed ? ' · trail' : ''}
          </span>
        </div>
        {why.details.map((d) => (
          <p key={d} className="bt-why-detail">
            {d}
          </p>
        ))}
        <RuleList rules={why.rules} title="Exit rules at close (X1–X9)" />
      </div>
    </details>
  );
}

export default function SwingBacktestPage() {
  const [searchParams] = useSearchParams();
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [mode, setMode] = useState<'symbol' | 'universe'>('symbol');
  const [symbol, setSymbol] = useState(searchParams.get('symbol') ?? 'TCS');
  const [universe, setUniverse] = useState('nifty250');
  const [maxScan, setMaxScan] = useState(25);
  const [minVerdict, setMinVerdict] = useState('SETUP_PLUS');
  const [zone52w, setZone52w] = useState('any');
  const [gc9Only, setGc9Only] = useState(false);
  const [portfolioGates, setPortfolioGates] = useState(true);
  const [warmup, setWarmup] = useState(220);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<{
    combined: Record<string, unknown>;
    results: BacktestResult[];
    portfolio?: PortfolioSummary;
    portfolio_trades?: BacktestTrade[];
  } | null>(null);

  useEffect(() => {
    api<{ universes: Universe[] }>('/api/v1/universes')
      .then((r) => {
        setUniverses(r.universes);
        if (r.universes.some((u) => u.key === 'nifty250')) setUniverse('nifty250');
      })
      .catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    setError('');
    setLoading(true);
    setPayload(null);
    try {
      const clampedWarmup = Math.min(300, Math.max(100, Math.round(Number(warmup) || 220)));
      if (clampedWarmup !== warmup) setWarmup(clampedWarmup);
      const body =
        mode === 'symbol'
          ? {
              symbol: symbol.trim().toUpperCase(),
              min_verdict: minVerdict,
              zone_52w: zone52w,
              gc9_only: gc9Only,
              warmup: clampedWarmup,
              portfolio_gates: false,
              auto_tiers: true,
            }
          : {
              universe,
              maxScan,
              min_verdict: minVerdict,
              zone_52w: zone52w,
              gc9_only: gc9Only,
              warmup: clampedWarmup,
              portfolio_gates: portfolioGates,
              auto_tiers: false,
            };
      const res = await api<{
        combined: Record<string, unknown>;
        results: BacktestResult[];
        portfolio?: PortfolioSummary;
        portfolio_trades?: BacktestTrade[];
      }>('/api/v1/swing/backtest', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPayload(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }, [mode, symbol, universe, maxScan, minVerdict, zone52w, gc9Only, warmup, portfolioGates]);

  useEffect(() => {
    if (searchParams.get('autorun') !== '1' || !symbol) return;
    void run();
    // Intentionally once per autorun landing — avoid re-fire when `run` identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('autorun'), symbol]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await run();
  }

  const pf = payload?.portfolio;
  const pfTrades = payload?.portfolio_trades ?? [];

  return (
    <Page>
      <PageHeader
        title="Swing Backtest"
        subtitle="Walk-forward hard E1–E8 · soft catalysts · X1–X9 exits · full entry/exit why"
        actions={
          <Link to="/swing" className="btn btn-secondary">
            ← Scanner
          </Link>
        }
      />
      <p className="disclaimer">
        Educational backtest on the <strong>last 3 years</strong> (Yahoo 5y fetch, trimmed) with
        historical NIFTYBEES regime per bar. Scaled book{' '}
        <strong>40/40/20 @ 1R/2R/3R</strong> (BE after T1) + X1–X9 on the runner. Score by{' '}
        <strong>expectancy → compound → max DD → PF</strong> — not win rate alone. Not live P&amp;L.
      </p>

      <form className="card" onSubmit={onSubmit}>
        <div className="segmented" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className={mode === 'symbol' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('symbol')}>
            Single symbol
          </button>
          <button type="button" className={mode === 'universe' ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('universe')}>
            Universe batch
          </button>
        </div>

        {mode === 'symbol' ? (
          <div className="form-group">
            <label>Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
        ) : (
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
              <label>Max symbols</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxScan}
                onChange={(e) => setMaxScan(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={portfolioGates}
                  onChange={(e) => setPortfolioGates(e.target.checked)}
                />{' '}
                Portfolio heat gates
              </label>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Min verdict</label>
            <select value={minVerdict} onChange={(e) => setMinVerdict(e.target.value)} style={{ width: '100%' }}>
              <option value="ENTER">ENTER (strict)</option>
              <option value="SETUP_PLUS">SETUP+</option>
              <option value="WATCH">WATCH+</option>
              <option value="ALL">ALL</option>
            </select>
          </div>
          <div className="form-group">
            <label>52w zone</label>
            <select value={zone52w} onChange={(e) => setZone52w(e.target.value)} style={{ width: '100%' }}>
              <option value="any">Any</option>
              <option value="green">Green (near 52w low)</option>
              <option value="mid">Mid</option>
              <option value="red">Red (near 52w high)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Warmup bars</label>
            <input
              type="number"
              min={100}
              max={300}
              value={warmup}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setWarmup(Math.min(300, Math.max(100, Math.round(n))));
              }}
            />
          </div>
          <div className="form-group">
            <label>
              <input type="checkbox" checked={gc9Only} onChange={(e) => setGc9Only(e.target.checked)} /> GC9 only
            </label>
          </div>
        </div>

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Running…' : 'Run backtest'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {payload && (
        <>
          <section className="card">
            <h2>Per-symbol aggregate (ungated)</h2>
            <p>
              Symbols {String(payload.combined.symbols)} · Signals {String(payload.combined.total_signals)} · Trades{' '}
              {String(payload.combined.total_trades_closed ?? 0)} · Win rate{' '}
              {String(payload.combined.avg_win_rate_pct ?? '—')}% · PF {String(payload.combined.avg_profit_factor ?? '—')} · Net{' '}
              {payload.combined.net_pnl_inr != null
                ? `₹${Number(payload.combined.net_pnl_inr).toLocaleString('en-IN')}`
                : '—'}
            </p>
          </section>

          {pf && pf.portfolio_gates ? (
            <section className="card">
              <h2>Portfolio book (heat-gated)</h2>
              <div className="swing-backtest-stats">
                <span>Accepted {pf.entries_accepted}</span>
                <span>Blocked {pf.entries_blocked}</span>
                <span>WR {pf.trade_win_rate_pct ?? '—'}%</span>
                <span>PF {pf.profit_factor ?? '—'}</span>
                <span>Avg hold {pf.avg_hold_days ?? '—'}d</span>
                <span>
                  Net{' '}
                  {pf.net_pnl_inr != null ? `₹${Number(pf.net_pnl_inr).toLocaleString('en-IN')}` : '—'}
                </span>
              </div>
              {pfTrades.length > 0 ? (
                <table className="data-table compact bt-why-table" style={{ marginTop: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>P&amp;L %</th>
                      <th>Why enter</th>
                      <th>Why exit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pfTrades.slice(0, 60).map((t) => (
                      <tr key={`${t.symbol}-${t.entry_date}-${t.exit_date}`}>
                        <td>{t.symbol}</td>
                        <td>
                          {t.entry_date}
                          <div className="muted">₹{t.entry_price}</div>
                        </td>
                        <td>
                          {t.exit_date}
                          <div className="muted">₹{t.exit_price} · {t.days_held}d</div>
                        </td>
                        <td className={t.pnl_pct >= 0 ? 'intraday-pos' : 'intraday-neg'}>
                          {t.pnl_pct >= 0 ? '+' : ''}
                          {t.pnl_pct}%
                        </td>
                        <td>
                          <EntryWhyBlock why={t.entry_why} />
                        </td>
                        <td>
                          <ExitWhyBlock
                            why={t.exit_why}
                            fallbackReason={t.exit_reason}
                            fallbackTriggers={t.exit_triggers}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">No trades survived portfolio gates.</p>
              )}
            </section>
          ) : null}

          {payload.results.map((r) => (
            <section key={r.symbol} className="card">
              <h2>
                {r.symbol}{' '}
                <span className="muted">
                  ({r.bars_used} bars · warmup {r.warmup}
                  {r.lookback_years ? ` · ${r.lookback_years}y` : ''}
                  {r.chart_from && r.chart_to ? ` · ${r.chart_from} → ${r.chart_to}` : ''}
                  {r.method ? ` · ${r.method}` : ''}
                  {r.engine_version ? ` · ${r.engine_version}` : ''})
                </span>
              </h2>
              <div className="swing-backtest-stats">
                <span>Signals {r.stats.signal_count}</span>
                <span>Trades {r.stats.trades_closed ?? 0}</span>
                <span>E {r.stats.expectancy_pct ?? '—'}%</span>
                <span>Avg R {r.stats.avg_realized_r ?? '—'}</span>
                <span>PF {r.stats.profit_factor ?? '—'}</span>
                <span>Compound {r.stats.compounded_return_pct ?? '—'}%</span>
                <span>Max DD {r.stats.max_drawdown_pct ?? '—'}%</span>
                <span>Trade WR {r.stats.trade_win_rate_pct ?? '—'}%</span>
                <span>Avg hold {r.stats.avg_hold_days ?? '—'}d</span>
                <span>
                  Net{' '}
                  {r.stats.net_pnl_inr != null
                    ? `₹${Number(r.stats.net_pnl_inr).toLocaleString('en-IN')}`
                    : '—'}
                </span>
                <span
                  className={
                    r.stats.economic_edge_ok || r.economic?.pass ? 'swing-pnl-pos' : 'swing-pnl-neg'
                  }
                >
                  Econ {(r.stats.economic_edge_status ?? r.economic?.status ?? 'missing').toUpperCase()}
                </span>
              </div>
              {r.disclaimer ? <p className="muted">{r.disclaimer}</p> : null}
              {r.auto_tiers?.ok ? (
                <>
                  <h3>Auto tier replay (Phase D)</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {r.auto_tiers.hc_note ??
                      'Independent exit books per Auto Radar tier · Expectancy → compound → DD → PF'}
                  </p>
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>Signals</th>
                        <th>Trades</th>
                        <th>E %</th>
                        <th>PF</th>
                        <th>Compound</th>
                        <th>Max DD</th>
                        <th>WR</th>
                        <th>Grade</th>
                        <th>Edge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.auto_tiers.tiers.map((tier) => (
                        <tr key={tier.tier}>
                          <td>{tier.label}</td>
                          <td>{tier.signals}</td>
                          <td>{tier.trades}</td>
                          <td>{tier.expectancy_pct}</td>
                          <td>{tier.profit_factor}</td>
                          <td>{tier.compounded_return_pct}%</td>
                          <td>{tier.max_drawdown_pct}%</td>
                          <td>{tier.win_rate_pct}%</td>
                          <td>{tier.grade}</td>
                          <td>{tier.edge}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
              {(r.trades?.length ?? 0) > 0 ? (
                <>
                  <h3>Simulated trades — expand Why enter / Why exit</h3>
                  <table className="data-table compact bt-why-table">
                    <thead>
                      <tr>
                        <th>Dates</th>
                        <th>Prices</th>
                        <th>Days</th>
                        <th>P&amp;L</th>
                        <th>Path</th>
                        <th>Peak</th>
                        <th>Why enter</th>
                        <th>Why exit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(r.trades ?? []).map((t) => (
                        <tr key={`${r.symbol}-${t.entry_date}-${t.exit_date}`}>
                          <td>
                            {t.entry_date}
                            <div className="muted">→ {t.exit_date}</div>
                          </td>
                          <td>
                            ₹{t.entry_price}
                            <div className="muted">→ ₹{t.exit_price}</div>
                            <div className="muted">
                              SL ₹{t.stop_loss ?? '—'} · TG ₹{t.profit_target ?? '—'}
                            </div>
                          </td>
                          <td>{t.days_held}</td>
                          <td className={t.pnl_pct >= 0 ? 'intraday-pos' : 'intraday-neg'}>
                            {t.pnl_pct >= 0 ? '+' : ''}
                            {t.pnl_pct}%
                            <div className="muted">
                              {t.realized_r != null ? `${t.realized_r}R · ` : ''}
                              {t.net_pnl_inr != null
                                ? `₹${Math.round(t.net_pnl_inr).toLocaleString('en-IN')}`
                                : '—'}
                            </div>
                          </td>
                          <td className="muted">{t.exit_path ?? t.exit_reason}</td>
                          <td className="muted">
                            {t.peak_gain_pct != null ? `+${t.peak_gain_pct}%` : '—'}
                          </td>
                          <td>
                            <EntryWhyBlock why={t.entry_why} />
                          </td>
                          <td>
                            <ExitWhyBlock
                              why={t.exit_why}
                              fallbackReason={t.exit_reason}
                              fallbackTriggers={t.exit_triggers}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
              {r.signals.length > 0 ? (
                <>
                  <h3 style={{ marginTop: '1rem' }}>Entry signals (last 50) — why each fired</h3>
                  <table className="data-table compact bt-why-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Price</th>
                        <th>Verdict</th>
                        <th>Fwd 20d</th>
                        <th>Why enter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.signals.map((s) => (
                        <tr key={`${r.symbol}-${s.date}`}>
                          <td>{s.date}</td>
                          <td>₹{s.price}</td>
                          <td>
                            {s.verdict}
                            <div className="muted">strict {s.strict_verdict}</div>
                          </td>
                          <td>
                            {s.forward_return_pct ?? '—'}
                            <div className="muted">
                              {s.hit_target ? 'tgt' : ''}
                              {s.hit_target && s.hit_stop ? ' · ' : ''}
                              {s.hit_stop ? 'stp' : ''}
                            </div>
                          </td>
                          <td>
                            <EntryWhyBlock why={s.entry_why} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="muted">No signals matched filters in lookback window.</p>
              )}
            </section>
          ))}
        </>
      )}
    </Page>
  );
}

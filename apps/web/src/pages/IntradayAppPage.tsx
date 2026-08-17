import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

type Interval = '5m' | '15m';

interface LiteOpen {
  id: string;
  instrument_id: string;
  instrument_label: string;
  side: string;
  side_label: string;
  timeframe: string;
  entry_price: number;
  quantity: number | null;
  current_price: number | null;
  pnl_inr: number | null;
  gain_pct: number | null;
  position_action: string;
  action_label: string;
  exit_verdict: string;
  source: string;
  source_label: string;
}

interface LitePayload {
  ok: boolean;
  interval: Interval;
  index: string;
  index_label: string;
  instrument?: { id: string; label: string; kind: string } | null;
  session?: { phase: string; label: string; message: string; ist_time: string };
  time_stop?: { ist: string; flatten: boolean; message: string };
  direction?: { label: string; confidence: number; tone: string };
  recommended_preset?: string;
  playbook?: { actionable: boolean; headline: string; headline_tone: string };
  scalp_setup?: {
    entry_allowed: boolean;
    summary: string;
    tone: string;
    preset_label: string;
    exit_label: string;
    gate_reasons: string[];
    plan: {
      bias_label?: string;
      entry?: { price: number } | null;
      stop_loss?: { price: number } | null;
      exits?: Array<{ tier: string; price: number }>;
    } | null;
  };
  log_plan?: {
    ok: boolean;
    bias: string;
    entry: { price: number };
    stop_loss: { price: number };
    exits: Array<{ price?: number }>;
  } | null;
  log_source?: string;
  positions?: { open: LiteOpen[]; portfolio?: { count?: number; net_pnl_inr?: number | null; urgent_count?: number } };
  journal?: {
    summary: {
      closed: number;
      win_rate_pct: number | null;
      wins: number;
      losses: number;
      avg_r: number | null;
      total_net_pnl: number;
    };
    recent: Array<{
      instrument_label: string;
      side: string;
      timeframe: string;
      entry_price: number;
      closed_price: number;
      closed_reason: string;
      source_label: string;
      net_pnl: number | null;
      r_multiple: number | null;
    }>;
  };
  refresh_sec?: number;
  error?: string;
  positions_included?: boolean;
  journal_included?: boolean;
}

interface Chip {
  id: string;
  label: string;
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(d);
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function isUrgent(row: LiteOpen): boolean {
  const a = (row.position_action || '').toUpperCase();
  return a.startsWith('EXIT') || row.exit_verdict === 'EXIT';
}

function actionClass(action: string): string {
  const a = (action || '').toUpperCase();
  if (a.startsWith('EXIT')) return 'exit';
  if (a.startsWith('PARTIAL') || a === 'TIGHTEN_STOP') return 'partial';
  return 'hold';
}

export default function IntradayAppPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialInterval: Interval = searchParams.get('tf') === '15m' || searchParams.get('interval') === '15m' ? '15m' : '5m';
  const initialInstrument = searchParams.get('symbol') ?? searchParams.get('instrument') ?? 'nifty50';

  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [instrument, setInstrument] = useState(initialInstrument);
  const [draft, setDraft] = useState(initialInstrument);
  const [chips, setChips] = useState<Chip[]>([]);
  const [data, setData] = useState<LitePayload | null>(null);
  const [openPositions, setOpenPositions] = useState<LiteOpen[]>([]);
  const [portfolio, setPortfolio] = useState<{
    count?: number;
    net_pnl_inr?: number | null;
    urgent_count?: number;
  } | null>(null);
  const [journal, setJournal] = useState<LitePayload['journal'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  const REFRESH_MS = 60_000;

  useEffect(() => {
    void api<{ indices: Chip[]; stocks: Chip[]; etfs?: Chip[] }>('/api/v1/intraday/instruments')
      .then((r) => {
        setChips([...(r.indices ?? []), ...(r.etfs ?? []).slice(0, 8), ...(r.stocks ?? []).slice(0, 6)]);
      })
      .catch(() => setChips([]));
  }, []);

  const load = useCallback(
    async (refresh = false, silent = false) => {
      setError('');
      if (!silent) setLoading(true);
      try {
        const q = new URLSearchParams({ interval, instrument, positions: '0', journal: '0' });
        if (refresh) q.set('refresh', '1');
        const payload = await api<LitePayload>(`/api/v1/intraday/nifty/lite?${q}`);
        setData(payload);
        const resolved = payload.instrument?.id;
        if (resolved && resolved !== instrument) {
          setInstrument(resolved);
          setDraft(resolved);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lite load failed');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [interval, instrument],
  );

  const loadPositions = useCallback(async () => {
    try {
      const q = new URLSearchParams({ interval, instrument, positions: '1', journal: '0' });
      const payload = await api<LitePayload>(`/api/v1/intraday/nifty/lite?${q}`);
      setOpenPositions(payload.positions?.open ?? []);
      setPortfolio(payload.positions?.portfolio ?? null);
    } catch {
      /* best-effort */
    }
  }, [interval, instrument]);

  const loadJournal = useCallback(async () => {
    try {
      const q = new URLSearchParams({ interval, instrument, positions: '0', journal: '1' });
      const payload = await api<LitePayload>(`/api/v1/intraday/nifty/lite?${q}`);
      setJournal(payload.journal ?? null);
    } catch {
      /* best-effort */
    }
  }, [interval, instrument]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(false, true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    void loadPositions();
    void loadJournal();
    const id = window.setInterval(() => {
      void loadPositions();
      void loadJournal();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadPositions, loadJournal]);

  function select(id: string, tf?: Interval) {
    const nextTf = tf ?? interval;
    setInstrument(id);
    setDraft(id);
    if (tf) setInterval(tf);
    setSearchParams({ instrument: id, interval: nextTf });
  }

  function submitSymbol(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim().toUpperCase();
    if (!next) return;
    select(next);
  }

  async function logEntry() {
    const plan = data?.log_plan;
    if (!plan?.ok) return;
    const quantity = Number(qty);
    setBusy(true);
    setError('');
    try {
      const exits = plan.exits ?? [];
      await api('/api/v1/intraday/positions', {
        method: 'POST',
        body: JSON.stringify({
          instrument_id: data?.instrument?.id ?? instrument,
          side: plan.bias === 'short' ? 'short' : 'long',
          timeframe: '5m',
          entry_price: Number(plan.entry.price),
          stop_loss: Number(plan.stop_loss.price),
          target_t1: exits[0]?.price ? Number(exits[0].price) : undefined,
          target_t2: exits[1]?.price ? Number(exits[1].price) : undefined,
          target_t3: exits[2]?.price ? Number(exits[2].price) : undefined,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
          source: data?.log_source ?? 'nifty_intraday_app',
          notes: 'Logged from /intraday/app',
        }),
      });
      setQty('');
      await Promise.all([load(true), loadPositions(), loadJournal()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Log failed');
    } finally {
      setBusy(false);
    }
  }

  async function closePosition(row: LiteOpen) {
    const px = row.current_price ?? row.entry_price;
    if (!(px > 0)) return;
    if (!confirm(`Close ${row.instrument_label} at ${fmt(px)}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/intraday/positions/${row.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ closed_price: px, closed_reason: isUrgent(row) ? row.action_label : 'manual' }),
      });
      await Promise.all([load(true), loadPositions(), loadJournal()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setBusy(false);
    }
  }

  const opens = openPositions.length > 0 ? openPositions : (data?.positions?.open ?? []);
  const portfolioKpi = portfolio ?? data?.positions?.portfolio;
  const journalData = journal ?? data?.journal;
  const scalp = data?.scalp_setup;
  const plan = scalp?.plan;
  const flatten = Boolean(data?.time_stop?.flatten);
  const session = data?.session;
  const radarHref = useMemo(
    () => `/intraday?instrument=${encodeURIComponent(instrument)}&interval=${interval}`,
    [instrument, interval],
  );

  return (
    <div className="ia-shell">
      {flatten && (
        <div className="ia-exit-bar" role="alert">
          {data?.time_stop?.message ?? 'Flatten open intraday — 14:30 IST time stop'}
        </div>
      )}

      <div className="ia-top">
        <div>
          <h1 className="ia-title">Intraday</h1>
          <p className="ia-sub">
            {data?.index_label ?? instrument} · 5m scalp · {session?.label ?? 'session'} {session?.ist_time ?? ''}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading || busy} onClick={() => void load(true)}>
          Refresh
        </button>
      </div>

      {session && (
        <p className={`ia-session ia-session-${session.phase}`}>{session.message}</p>
      )}

      <form className="ia-symbol" onSubmit={submitSymbol}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="TCS, NIFTYBEES, ^NSEI"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-sm">
          Load
        </button>
      </form>

      <div className="ia-chips">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={instrument === c.id ? 'ia-chip active' : 'ia-chip'}
            onClick={() => select(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="ia-tf">
        {(['5m', '15m'] as Interval[]).map((tf) => (
          <button
            key={tf}
            type="button"
            className={interval === tf ? 'ia-chip active' : 'ia-chip'}
            onClick={() => select(instrument, tf)}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="ia-kpi">
        <span className={loading ? 'ia-muted' : ''}>{loading ? 'Loading…' : data?.playbook?.headline || 'Ready'}</span>
        <span className={`ia-dir ia-${data?.direction?.tone ?? 'neutral'}`}>
          {data?.direction?.label ?? '—'} {data?.direction?.confidence ? `${data.direction.confidence}%` : ''}
        </span>
        <span>{portfolioKpi?.count ?? opens.length} open</span>
        {portfolioKpi?.net_pnl_inr != null && (
          <span className={portfolioKpi.net_pnl_inr >= 0 ? 'ia-live' : 'ia-warn'}>{fmtInr(portfolioKpi.net_pnl_inr)}</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <section className="card ia-card">
        <h2>{scalp?.preset_label ?? '5m trend scalp'}</h2>
        <div className={`ia-scalp ${scalp?.entry_allowed ? 'ok' : 'block'}`}>
          <p>{scalp?.summary ?? 'Waiting for radar…'}</p>
          {plan?.entry && (
            <div className="ia-levels">
              <div>
                <strong>Entry</strong>
                {fmt(plan.entry.price)}
              </div>
              <div>
                <strong>Stop</strong>
                {fmt(plan.stop_loss?.price)}
              </div>
              <div>
                <strong>T1</strong>
                {fmt(plan.exits?.[0]?.price)}
              </div>
            </div>
          )}
          {scalp?.gate_reasons?.length ? (
            <ul className="ia-reasons">
              {scalp.gate_reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {data?.log_plan?.ok && (
          <div className="ia-log-form">
            <label>
              Qty
              <input
                type="number"
                min={0}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </label>
            <button type="button" className="btn" disabled={busy} onClick={() => void logEntry()}>
              Log scalp entry
            </button>
          </div>
        )}
      </section>

      <section className="card ia-card">
        <h2>Open positions</h2>
        {opens.length === 0 ? (
          <p className="muted">No open positions. Log from a cleared scalp or the full ledger.</p>
        ) : (
          opens.map((row) => (
            <div key={row.id} className={`ia-pos-card ${isUrgent(row) ? 'ia-exit' : ''}`}>
              <div className="ia-pos-head">
                <div>
                  <div className="ia-pos-name">
                    {row.instrument_label} · {row.side_label} {row.timeframe}
                  </div>
                  {row.source_label ? <span className="ia-src">{row.source_label}</span> : null}
                </div>
                <span className={`ia-action ${actionClass(row.position_action)}`}>{row.action_label}</span>
              </div>
              <div className="ia-pos-meta">
                {fmt(row.entry_price)} → {fmt(row.current_price)} · {fmtInr(row.pnl_inr)}
                {row.gain_pct != null ? ` (${fmt(row.gain_pct, 1)}%)` : ''}
              </div>
              <button
                type="button"
                className={`ia-close-btn ${isUrgent(row) ? 'ia-urgent' : ''}`}
                disabled={busy}
                onClick={() => void closePosition(row)}
              >
                Close @ {fmt(row.current_price ?? row.entry_price)}
              </button>
            </div>
          ))
        )}
        <div className="ia-links">
          <Link to="/intraday/positions" className="ia-primary">
            Full ledger
          </Link>
          <Link to={radarHref}>Radar</Link>
          <Link to={`/intraday?instrument=${encodeURIComponent(instrument)}&interval=5m`}>5m radar</Link>
          <Link to="/presets?preset=intraday_session">Presets</Link>
        </div>
      </section>

      <section className="card ia-card">
        <div className="ia-journal-head">
          <h2>Session journal</h2>
          <Link to="/intraday/positions?status=closed" className="muted">
            Ledger · CSV
          </Link>
        </div>
        <div className="ia-journal">
          {journalData?.summary.closed ? (
            <>
              <span>
                {journalData.summary.wins}W / {journalData.summary.losses}L
                {journalData.summary.win_rate_pct != null ? ` · ${journalData.summary.win_rate_pct}%` : ''}
              </span>
              <span className={(journalData.summary.total_net_pnl ?? 0) >= 0 ? 'ia-live' : 'ia-warn'}>
                {fmtInr(journalData.summary.total_net_pnl)}
              </span>
              {journalData.summary.avg_r != null && <span>Avg {journalData.summary.avg_r}R</span>}
            </>
          ) : (
            <span className="muted">No closed trades yet</span>
          )}
        </div>
        {journalData?.recent.map((row, i) => (
          <div key={`${row.instrument_label}-${i}`} className="ia-closed-card">
            <div className="ia-closed-head">
              <strong>
                {row.instrument_label} {row.side} {row.timeframe}
              </strong>
              <span className={(row.net_pnl ?? 0) >= 0 ? 'ia-live' : 'ia-warn'}>{fmtInr(row.net_pnl)}</span>
            </div>
            <div className="muted">
              {fmt(row.entry_price)} → {fmt(row.closed_price)} · {row.closed_reason || 'close'}
              {row.source_label ? ` · ${row.source_label}` : ''}
              {row.r_multiple != null ? ` · ${row.r_multiple}R` : ''}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

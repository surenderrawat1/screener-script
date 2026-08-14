import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { SignalCard } from '../components/research/SignalCard';

type SignalBook = 'swing' | 'intraday' | 'watchlist' | 'screener' | 'verify' | 'pattern';
type SignalSide = 'entry' | 'exit' | 'review';

interface InboxSignal {
  id: string;
  book: SignalBook;
  side: SignalSide;
  symbol: string;
  name?: string;
  verdict?: string;
  strict_verdict?: string;
  decision_label?: string;
  decision_score?: number;
  price?: number | null;
  mos?: number | null;
  quality_score?: number | null;
  high_conviction?: boolean;
  recommendation_basis?: string;
  score_basis?: string;
  econ_status?: 'pass' | 'fail' | 'unproven' | 'missing';
  source_href: string;
  detail?: string;
  urgency?: 'danger' | 'warn' | 'ok' | 'info';
}

interface SignalsResponse {
  built_at: string;
  live: boolean;
  summary: {
    total: number;
    exit_count: number;
    hc_count: number;
    review_count: number;
    by_book: Record<string, number>;
  };
  signals: InboxSignal[];
  disclaimer: string;
}

interface EveningGttOrder {
  symbol: string;
  name: string;
  tier: string;
  qty: number;
  trigger_price: number;
  limit_price: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  copy_line: string;
  oco_note: string;
}

interface EveningGttDigest {
  date_key?: string | null;
  built_at?: string;
  order_count: number;
  orders?: EveningGttOrder[];
  copy_all?: string;
  regime_key?: string | null;
  disclaimer?: string;
}

const BOOK_LABELS: Record<SignalBook, string> = {
  swing: 'Swing',
  intraday: 'Intraday',
  watchlist: 'Watchlist',
  screener: 'Screener',
  verify: 'Verify history',
  pattern: 'Patterns',
};

const SIDE_LABELS: Record<SignalSide, string> = {
  exit: 'Exits',
  entry: 'Entries',
  review: 'Reviews',
};

function verdictClass(side: SignalSide, verdict?: string): string {
  if (side === 'exit') return 'badge badge-sell';
  if (side === 'review') return 'badge badge-hold';
  const v = String(verdict ?? '').toUpperCase();
  if (v.includes('BUY') || v.includes('ENTER') || v.includes('BREAKOUT') || v.includes('CONFIRMED')) {
    return 'badge badge-buy';
  }
  return 'badge badge-muted';
}

export default function SignalsPage() {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [evening, setEvening] = useState<EveningGttDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [buildingGtt, setBuildingGtt] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [bookFilter, setBookFilter] = useState<SignalBook | 'all'>('all');
  const [sideFilter, setSideFilter] = useState<SignalSide | 'all'>('all');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, gtt] = await Promise.all([
        api<SignalsResponse>(`/api/v1/signals?live=${live ? '1' : '0'}`),
        api<EveningGttDigest>('/api/v1/signals/evening-gtt').catch(() => null),
      ]);
      setData(res);
      setEvening(gtt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setLoading(false);
    }
  }, [live]);

  const buildEveningGtt = useCallback(async () => {
    setBuildingGtt(true);
    setError('');
    try {
      const digest = await api<EveningGttDigest>('/api/v1/signals/evening-gtt/build', {
        method: 'POST',
        body: JSON.stringify({ force: true, send_email: false }),
      });
      setEvening(digest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evening GTT build failed');
    } finally {
      setBuildingGtt(false);
    }
  }, []);

  const copyText = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Clipboard copy failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.signals.filter((s) => {
      if (bookFilter !== 'all' && s.book !== bookFilter) return false;
      if (sideFilter !== 'all' && s.side !== sideFilter) return false;
      return true;
    });
  }, [data, bookFilter, sideFilter]);

  const grouped = useMemo(() => {
    const groups: Record<SignalSide, InboxSignal[]> = { exit: [], entry: [], review: [] };
    for (const s of filtered) groups[s.side].push(s);
    return groups;
  }, [filtered]);

  return (
    <Page>
      <PageHeader
        title="Signals inbox"
        subtitle="Evening GTT board + actionable feed across swing exits, HC radar, chart patterns, and ledgers"
        actions={
          <>
            <label className="signals-live-toggle">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              Live refresh
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => void buildEveningGtt()} disabled={buildingGtt}>
              {buildingGtt ? 'Building GTT…' : 'Build evening GTT'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {loading && !data ? <PageLoading label="Loading signals…" /> : null}

      {evening ? (
        <section className="card signals-section" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>Evening GTT · Swing</h2>
            <span className="muted">
              {evening.date_key ?? '—'} · {evening.order_count} order(s)
              {evening.regime_key ? ` · ${evening.regime_key}` : ''}
            </span>
          </div>
          {evening.order_count > 0 && evening.orders?.length ? (
            <>
              <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void copyText(evening.copy_all || '', 'all')}
                >
                  {copied === 'all' ? 'Copied' : 'Copy all lines'}
                </button>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Qty</th>
                      <th>Trigger / Limit</th>
                      <th>SL / Target</th>
                      <th>GTT line</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {evening.orders.map((o) => (
                      <tr key={o.symbol}>
                        <td>
                          <strong>{o.symbol}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {o.name}
                          </div>
                        </td>
                        <td>{o.qty}</td>
                        <td>
                          {o.trigger_price} / {o.limit_price}
                        </td>
                        <td>
                          {o.stop_loss ?? '—'} / {o.profit_target ?? '—'}
                        </td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{o.copy_line}</td>
                        <td>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => void copyText(o.copy_line, o.symbol)}>
                            {copied === o.symbol ? 'Copied' : 'Copy'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {evening.disclaimer}
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>
              No evening digest yet — worker builds at 16:00 IST from High Conviction, or click Build evening GTT.
            </p>
          )}
        </section>
      ) : null}

      {data ? (
        <>
          <div className="signals-summary card">
            <div className="signals-summary-metrics">
              <span>
                <strong>{data.summary.exit_count}</strong> exit
              </span>
              <span>
                <strong>{data.summary.hc_count}</strong> HC
              </span>
              <span>
                <strong>{data.summary.review_count}</strong> review
              </span>
              {!data.live ? <span className="muted">Cached mode</span> : null}
            </div>
            <div className="signals-filters">
              <span className="muted">Book:</span>
              {(['all', 'swing', 'intraday', 'pattern', 'watchlist', 'screener', 'verify'] as const).map((book) => (
                <button
                  key={book}
                  type="button"
                  className={`btn btn-sm ${bookFilter === book ? '' : 'btn-secondary'}`}
                  onClick={() => setBookFilter(book)}
                >
                  {book === 'all' ? 'All' : BOOK_LABELS[book]}
                  {book !== 'all' && data.summary.by_book[book] != null
                    ? ` (${data.summary.by_book[book]})`
                    : ''}
                </button>
              ))}
            </div>
            <div className="signals-filters">
              <span className="muted">Type:</span>
              {(['all', 'exit', 'entry', 'review'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={`btn btn-sm ${sideFilter === side ? '' : 'btn-secondary'}`}
                  onClick={() => setSideFilter(side)}
                >
                  {side === 'all' ? 'All' : SIDE_LABELS[side]}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState>
              No signals match filters —{' '}
              <Link to="/morning">open Morning cockpit</Link>,{' '}
              <Link to="/patterns">pattern feed</Link>, or{' '}
              <Link to="/swing/auto">run Auto Radar</Link>.
            </EmptyState>
          ) : (
            (['exit', 'entry', 'review'] as SignalSide[]).map((side) => {
              const items = grouped[side];
              if (items.length === 0) return null;
              return (
                <section key={side} className="signals-section card">
                  <h2>{SIDE_LABELS[side]}</h2>
                  <div className="signal-card-grid">
                    {items.map((s) => (
                      <SignalCard
                        key={s.id}
                        variant="card"
                        symbol={s.symbol}
                        name={s.name}
                        verdict={s.strict_verdict || s.verdict}
                        verdictClassName={verdictClass(s.side, s.verdict)}
                        subtitle={s.detail}
                        decisionLabel={s.decision_label}
                        decisionScore={s.decision_score}
                        price={s.price}
                        mos={s.mos}
                        qualityScore={s.quality_score}
                        highConviction={s.high_conviction}
                        recommendationBasis={s.recommendation_basis}
                        scoreBasis={s.score_basis}
                        econStatus={s.econ_status}
                        actions={
                          <>
                            {s.side === 'entry' && s.book !== 'pattern' ? (
                              <Link
                                to={`/verify?symbol=${encodeURIComponent(s.symbol)}`}
                                className="btn btn-secondary btn-sm"
                              >
                                Verify
                              </Link>
                            ) : null}
                            <Link to={s.source_href} className="btn btn-secondary btn-sm">
                              {s.book === 'pattern' ? 'Patterns' : 'Open book'}
                            </Link>
                            <Link
                              to={`/stock/${encodeURIComponent(s.symbol)}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Memo
                            </Link>
                          </>
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}

          <p className="disclaimer">{data.disclaimer}</p>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Built {new Date(data.built_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          </p>
        </>
      ) : null}
    </Page>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { SignalCard } from '../components/research/SignalCard';
import type { EconStatus } from '../components/research/EvidenceStrip';

type LtgTierKey = 'high_conviction' | 'strict_enter' | 'setup_radar' | 'breakout_surge';

type LtgAutoTierHit = {
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
};

type LtgAutoState = {
  available: boolean;
  saved_at: string | null;
  universe: string;
  max_scan: number;
  tiers: Record<LtgTierKey, LtgAutoTierHit[]>;
  summary?: { scanned: number; passed: number; buy_eligible: number };
  guidance?: { tone: string; title: string; message: string; deploy_pct: number };
};

const TIER_LABELS: Record<LtgTierKey, string> = {
  high_conviction: 'High conviction',
  strict_enter: 'Strict enter',
  setup_radar: 'Setup radar',
  breakout_surge: 'Breakout surge',
};

function econStatusFromMos(mos: number | null): EconStatus {
  if (mos == null) return 'missing';
  if (mos >= 20) return 'pass';
  if (mos <= 0) return 'fail';
  return 'unproven';
}

export default function LtgAutoPage() {
  const [state, setState] = useState<LtgAutoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api<LtgAutoState>('/api/v1/fundamental-auto/state');
      setState(res);
    } catch (err) {
      setState(null);
      setError(err instanceof Error ? err.message : 'Failed to load LTG auto');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      await api('/api/v1/fundamental-auto/start', {
        method: 'POST',
        body: JSON.stringify({ universe: 'nifty250', maxScan: 250, refresh: true }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LTG scan start failed');
    } finally {
      setRunning(false);
    }
  }, [load, running]);

  const tierCards = useMemo(() => {
    if (!state?.available) return [];
    const keys: LtgTierKey[] = ['high_conviction', 'strict_enter', 'setup_radar', 'breakout_surge'];
    return keys.map((tier) => ({
      tier,
      items: state.tiers[tier].slice(0, 12),
    }));
  }, [state]);

  return (
    <Page>
      <PageHeader
        title="LTG Auto (fundamental + technical gate)"
        subtitle="cfa_ltg_auto preset · buy-eligible filter · CFA decision score · TA tier gates"
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void start()} disabled={running}>
            {running ? 'Scanning…' : 'Run LTG auto scan'}
          </button>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {loading && !state ? <PageLoading label="Loading LTG snapshot…" /> : null}

      {!loading && !state?.available ? (
        <EmptyState>
          No LTG snapshot yet — run a scan to populate tiers.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => void start()}>
            Run LTG auto scan
          </button>
        </EmptyState>
      ) : null}

      {state?.available ? (
        <>

      {state?.guidance ? (
        <div
          className={`data-quality-banner ${state.guidance.tone === 'success' ? 'data-quality-estimated' : 'data-quality-limited'}`}
          role="status"
        >
          <strong>{state.guidance.title}</strong>
          <span>{state.guidance.message}</span>
          {state.summary ? (
            <span className="muted">
              Scanned {state.summary.scanned} · {state.summary.passed} passed preset ·{' '}
              {state.summary.buy_eligible} buy-eligible · deploy hint {state.guidance.deploy_pct}%
            </span>
          ) : null}
        </div>
      ) : null}
          <p className="muted">
            Universe {state.universe} · maxScan {state.max_scan} · saved{' '}
            {state.saved_at ? new Date(state.saved_at).toLocaleString('en-IN') : '—'}
          </p>

          {tierCards.map(({ tier, items }) => (
            <section key={tier} className="card" style={{ marginBottom: '1rem' }}>
              <h2 style={{ marginTop: 0 }}>
                {TIER_LABELS[tier]} ({items.length})
              </h2>
              {items.length === 0 ? (
                <p className="muted">No hits in this tier.</p>
              ) : (
                <div className="signal-card-grid">
                  {items.map((hit) => (
                    <SignalCard
                      key={hit.symbol}
                      variant="card"
                      symbol={hit.symbol}
                      verdict={hit.strict_verdict || hit.verdict}
                      verdictClassName="badge badge-buy"
                      mos={hit.mos}
                      qualityScore={hit.quality_score}
                      price={hit.price}
                      recommendationBasis={hit.recommendation_basis}
                      scoreBasis={hit.score_basis}
                      econStatus={econStatusFromMos(hit.mos)}
                      actions={
                        <>
                          <Link to={`/verify?symbol=${encodeURIComponent(hit.symbol)}`} className="btn btn-secondary btn-sm">
                            Verify
                          </Link>
                          <Link to={`/stock/${encodeURIComponent(hit.symbol)}`} className="btn btn-secondary btn-sm">
                            Memo
                          </Link>
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      ) : null}
    </Page>
  );
}


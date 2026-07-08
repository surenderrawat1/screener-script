import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';

interface InvestmentMemo {
  grade: string;
  rating: string;
  verdict: string;
  verdict_color: string;
  conviction: string;
  headline: string;
  pillars: Record<string, string>;
  strengths: string[];
  risks: string[];
  investment_case: string;
  valuation: {
    current: number;
    intrinsic: number;
    mos_pct: number;
    zone: string;
    pe: number;
    fair_pe: number;
    dcf_value: number;
    fcf_yield: number;
    model: string;
    sector: string;
  };
  quality: { score: number };
  score: number;
  score_max: number;
  score_pct: number;
}

interface VerifyResult {
  symbol: string;
  success: boolean;
  company_name?: string;
  sources?: string[];
  from_cache?: boolean;
  assumptions?: string[];
  analysis: {
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
    dcf_value?: number;
    verdict?: { action: string; grade: string; summary: string; color: string };
  };
  memo?: InvestmentMemo;
  disclaimer: string;
}

interface HistoryRun {
  id: string;
  symbol: string;
  createdAt: string;
  mos: number | null;
  recommendation: string;
}

function verdictClass(color: string): string {
  if (color === 'success') return 'cfa-verdict-green';
  if (color === 'warning') return 'cfa-verdict-amber';
  if (color === 'danger') return 'cfa-verdict-red';
  return '';
}

function normalizeSymbolInput(value: string): string {
  return value.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
}

export default function VerifyPage() {
  const location = useLocation();
  const initialSymbol =
    (location.state as { symbol?: string } | null)?.symbol ??
    new URLSearchParams(location.search).get('symbol') ??
    'TCS';
  const [symbol, setSymbol] = useState(initialSymbol);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [history, setHistory] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadHistory() {
    try {
      const res = await api<{ runs: HistoryRun[] }>('/api/v1/verify/history?limit=10');
      setHistory(res.runs);
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('symbol');
    if (fromUrl) {
      setSymbol(normalizeSymbolInput(fromUrl));
      setResult(null);
      setError('');
    }
  }, [location.search]);

  async function runVerify(refresh = false) {
    const normalized = normalizeSymbolInput(symbol);
    if (!normalized) {
      setError('Enter a valid NSE/BSE symbol.');
      return;
    }
    setSymbol(normalized);
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await api<VerifyResult>('/api/v1/verify/auto', {
        method: 'POST',
        body: JSON.stringify({ symbol: normalized, refresh }),
      });
      setResult(res);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runVerify(false);
  }

  const memo = result?.memo;
  const verdict = result?.analysis.verdict;
  const currentSymbol = normalizeSymbolInput(symbol) || 'TCS';

  return (
    <Page>
      <PageHeader title="CFA Verify" subtitle="One-click institutional memo — full engine with screening defaults" />
      <p className="disclaimer">
        Screening mode assumes Phase 0 and portfolio gates — confirm with{' '}
        <Link to={`/verify/full?symbol=${encodeURIComponent(symbol)}&from=verify`}>
          Full Verify
        </Link>{' '}
        before investing.
      </p>

      <form className="card quick-verify-card" onSubmit={onSubmit}>
        <div className="verify-command-row">
          <div className="form-group" style={{ maxWidth: 280 }}>
            <label>Symbol</label>
            <input
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase());
                setResult(null);
                setError('');
              }}
              placeholder="TCS"
              style={{ width: '100%' }}
            />
          </div>
          <div className="verify-command-actions">
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Analyzing…' : 'Auto verify'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={() => void runVerify(true)}
            >
              Refresh live data
            </button>
            <Link className="btn btn-secondary" to={`/verify/full?symbol=${encodeURIComponent(currentSymbol)}&from=verify`}>
              Full Verify
            </Link>
            <Link className="btn btn-secondary" to={`/stock/${encodeURIComponent(currentSymbol)}`}>
              Details
            </Link>
          </div>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {result && memo && (
        <div className="card cfa-memo-card">
          <div className={`cfa-hero grade-${memo.grade.toLowerCase()}`}>
            <div className="cfa-grade">{memo.grade}</div>
            <div className="cfa-hero-body">
              <div className={`cfa-verdict ${verdictClass(memo.verdict_color)}`}>
                {verdict?.action ?? result.analysis.recommendation}
              </div>
              <h2>
                <Link to={`/stock/${encodeURIComponent(result.symbol)}`}>
                  {result.company_name ?? result.symbol}
                </Link>
                <small> ({result.symbol})</small>
              </h2>
              <p className="cfa-rating">
                {memo.rating} · Conviction: <strong>{memo.conviction}</strong>
                {verdict?.grade ? ` · ${verdict.grade}` : ''}
              </p>
              <p className="cfa-headline">{memo.headline}</p>
            </div>
            <div className="cfa-score-ring">
              <span className="num">{memo.quality.score}</span>
              <span className="lbl">Quality</span>
              <span className="pct">{result.analysis.verify_score}/56 scorecard</span>
            </div>
          </div>

          {result.sources && result.sources.length > 0 && (
            <p className="muted cfa-meta">
              Sources: {result.sources.join(' · ')}
              {result.from_cache ? ' (cached)' : ''}
            </p>
          )}

          <div className="cfa-metrics-grid">
            <div className="metric-box">
              <div className="lbl">Price</div>
              <div className="val">₹{memo.valuation.current}</div>
            </div>
            <div className="metric-box">
              <div className="lbl">Intrinsic</div>
              <div className="val">₹{memo.valuation.intrinsic}</div>
            </div>
            <div className="metric-box">
              <div className="lbl">MOS</div>
              <div className="val">{memo.valuation.mos_pct}%</div>
            </div>
            <div className="metric-box">
              <div className="lbl">Fair P/E</div>
              <div className="val">{memo.valuation.fair_pe}×</div>
            </div>
            <div className="metric-box">
              <div className="lbl">DCF</div>
              <div className="val">₹{memo.valuation.dcf_value}</div>
            </div>
            <div className="metric-box">
              <div className="lbl">FCF yield</div>
              <div className="val">{memo.valuation.fcf_yield}%</div>
            </div>
          </div>

          {Object.keys(memo.pillars).length > 0 && (
            <div className="cfa-memo-section">
              <h3>Quality pillars</h3>
              <div className="cfa-pillars">
                {Object.entries(memo.pillars).map(([name, score]) => (
                  <span key={name} className="cfa-pillar-chip">
                    {name}: {score}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="cfa-memo-section">
            <h3>Investment case</h3>
            <p>{memo.investment_case}</p>
          </div>

          {(memo.strengths.length > 0 || memo.risks.length > 0) && (
            <div className="cfa-memo-columns">
              {memo.strengths.length > 0 && (
                <div className="cfa-memo-section">
                  <h3>Strengths</h3>
                  <ul>
                    {memo.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {memo.risks.length > 0 && (
                <div className="cfa-memo-section">
                  <h3>Risks</h3>
                  <ul>
                    {memo.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {verdict?.summary && (
            <p className="cfa-verdict-summary">{verdict.summary}</p>
          )}

          {result.assumptions && result.assumptions.length > 0 && (
            <details className="assumptions-box">
              <summary>Screening assumptions ({result.assumptions.length})</summary>
              <ul>
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}

          <p className="disclaimer">{result.disclaimer}</p>
          <p className="verify-result-actions">
            <Link className="btn btn-secondary" to={`/verify/full?symbol=${encodeURIComponent(result.symbol)}&from=verify`}>
              Open Full Verify →
            </Link>
            <Link className="btn btn-secondary" to={`/stock/${encodeURIComponent(result.symbol)}`}>
              Open Details →
            </Link>
          </p>
        </div>
      )}

      {result && !memo && (
        <div className="card">
          <p className="error">Memo unavailable — try refresh.</p>
        </div>
      )}

      <div className="card">
        <h2>Recent verifications</h2>
        {history.length === 0 ? (
          <EmptyState>No verification history yet.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Symbol</th>
                <th>MOS</th>
                <th>Verdict</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.createdAt).toLocaleString()}</td>
                  <td>
                    <Link to={`/stock/${encodeURIComponent(run.symbol)}`}>{run.symbol}</Link>
                  </td>
                  <td>{run.mos !== null ? `${run.mos}%` : '—'}</td>
                  <td>{run.recommendation}</td>
                  <td>
                    <Link to={`/verify/full?symbol=${encodeURIComponent(run.symbol)}&from=verify`}>
                      Full Verify
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
}

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader, PageLoading } from '../components/PageLayout';
import { StockMemoLayout } from '../components/research/StockMemoLayout';
import { printResearchMemo } from '../lib/memo-export';
import {
  buildStockMemoView,
  normalizeSymbolInput,
  type StockSummaryMemoInput,
} from '../lib/stock-memo-view';

interface StockSummary extends StockSummaryMemoInput {
  success: boolean;
  disclaimer: string;
}

interface ChartTa {
  ta: Record<string, unknown>;
}

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [symbolA, setSymbolA] = useState(params.get('a')?.toUpperCase() ?? 'TCS');
  const [symbolB, setSymbolB] = useState(params.get('b')?.toUpperCase() ?? 'INFY');
  const [summaryA, setSummaryA] = useState<StockSummary | null>(null);
  const [summaryB, setSummaryB] = useState<StockSummary | null>(null);
  const [taA, setTaA] = useState<Record<string, unknown>>({});
  const [taB, setTaB] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPair = useCallback(async (a: string, b: string) => {
    const symA = normalizeSymbolInput(a);
    const symB = normalizeSymbolInput(b);
    if (!symA || !symB) {
      setError('Enter two valid symbols.');
      return;
    }
    if (symA === symB) {
      setError('Choose two different symbols.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [resA, resB, chartA, chartB] = await Promise.all([
        api<StockSummary>(`/api/v1/stock/${encodeURIComponent(symA)}`),
        api<StockSummary>(`/api/v1/stock/${encodeURIComponent(symB)}`),
        api<ChartTa>(`/api/v1/stock/${encodeURIComponent(symA)}/chart`).catch(() => ({ ta: {} })),
        api<ChartTa>(`/api/v1/stock/${encodeURIComponent(symB)}/chart`).catch(() => ({ ta: {} })),
      ]);
      setSummaryA(resA);
      setSummaryB(resB);
      setTaA(chartA.ta ?? {});
      setTaB(chartB.ta ?? {});
      setParams({ a: symA, b: symB }, { replace: true });
    } catch (err) {
      setSummaryA(null);
      setSummaryB(null);
      setError(err instanceof Error ? err.message : 'Compare load failed');
    } finally {
      setLoading(false);
    }
  }, [setParams]);

  const initialLoad = useRef(false);

  useEffect(() => {
    const a = params.get('a');
    const b = params.get('b');
    if (a) setSymbolA(a.toUpperCase());
    if (b) setSymbolB(b.toUpperCase());
    if (initialLoad.current || !a || !b) return;
    initialLoad.current = true;
    void loadPair(a, b);
  }, [params, loadPair]);

  const memoA = useMemo(
    () => (summaryA ? buildStockMemoView(summaryA, taA) : null),
    [summaryA, taA],
  );
  const memoB = useMemo(
    () => (summaryB ? buildStockMemoView(summaryB, taB) : null),
    [summaryB, taB],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void loadPair(symbolA, symbolB);
  }

  const compareRows = memoA?.compareRows ?? [];

  return (
    <Page>
      <PageHeader
        title="Compare memos"
        subtitle="Side-by-side CFA screening view — confirm with Full Verify before allocating"
        actions={
          summaryA && summaryB ? (
            <button
              type="button"
              className="btn btn-secondary no-print"
              onClick={() =>
                printResearchMemo(`${summaryA.symbol} vs ${summaryB.symbol} — research memo`)
              }
            >
              Export PDF
            </button>
          ) : null
        }
      />

      <form className="compare-picker card no-print" onSubmit={onSubmit}>
        <div className="compare-picker-fields">
          <label>
            Symbol A
            <input value={symbolA} onChange={(e) => setSymbolA(e.target.value.toUpperCase())} />
          </label>
          <label>
            Symbol B
            <input value={symbolB} onChange={(e) => setSymbolB(e.target.value.toUpperCase())} />
          </label>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Loading…' : 'Compare'}
          </button>
        </div>
      </form>

      {error ? <p className="error">{error}</p> : null}
      {loading && !summaryA ? <PageLoading label="Loading memos…" /> : null}

      {summaryA && summaryB && memoA && memoB ? (
        <div id="compare-memo-print" className="research-print-root compare-page">
          <div className="compare-metrics card">
            <h2 style={{ marginTop: 0 }}>Headline metrics</h2>
            <div className="table-scroll">
              <table className="data-table compare-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>{summaryA.symbol}</th>
                    <th>{summaryB.symbol}</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((row, idx) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.value}</td>
                      <td>{memoB.compareRows[idx]?.value ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="compare-memo-grid">
            <StockMemoLayout
              hero={{
                ...memoA.hero,
                actions: (
                  <div className="stock-memo-actions no-print">
                    <Link className="btn btn-secondary" to={`/stock/${encodeURIComponent(summaryA.symbol)}`}>
                      Full memo
                    </Link>
                    <Link
                      className="btn btn-secondary"
                      to={`/verify/full?symbol=${encodeURIComponent(summaryA.symbol)}`}
                    >
                      Full verify
                    </Link>
                  </div>
                ),
              }}
              pillars={memoA.pillars}
              investmentCase={memoA.investmentCase}
              strengths={memoA.strengths}
              risks={memoA.risks}
              metrics={
                <div className="cfa-metrics-grid">
                  {memoA.metricTiles.map((tile) => (
                    <div key={tile.label} className="metric-box">
                      <div className="lbl">{tile.label}</div>
                      <div className="val">{tile.value}</div>
                    </div>
                  ))}
                </div>
              }
            />

            <StockMemoLayout
              hero={{
                ...memoB.hero,
                actions: (
                  <div className="stock-memo-actions no-print">
                    <Link className="btn btn-secondary" to={`/stock/${encodeURIComponent(summaryB.symbol)}`}>
                      Full memo
                    </Link>
                    <Link
                      className="btn btn-secondary"
                      to={`/verify/full?symbol=${encodeURIComponent(summaryB.symbol)}`}
                    >
                      Full verify
                    </Link>
                  </div>
                ),
              }}
              pillars={memoB.pillars}
              investmentCase={memoB.investmentCase}
              strengths={memoB.strengths}
              risks={memoB.risks}
              metrics={
                <div className="cfa-metrics-grid">
                  {memoB.metricTiles.map((tile) => (
                    <div key={tile.label} className="metric-box">
                      <div className="lbl">{tile.label}</div>
                      <div className="val">{tile.value}</div>
                    </div>
                  ))}
                </div>
              }
            />
          </div>

          <p className="disclaimer">{summaryA.disclaimer}</p>
        </div>
      ) : !loading && !error ? (
        <EmptyState>
          Enter two symbols above — e.g. TCS vs INFY — or open from a{' '}
          <Link to="/stock/TCS">stock memo</Link>.
        </EmptyState>
      ) : null}
    </Page>
  );
}

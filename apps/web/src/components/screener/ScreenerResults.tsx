import { useEffect, useState } from 'react';
import {
  badgeClass,
  downloadJobPitchCsv,
  downloadPitchCsv,
  fmtNum,
  fmtPct,
  defaultDirForSortKey,
  sortRows,
  type ScreenerRow,
  type SortKey,
} from '../../lib/screener-export';
import { ResearchRowActions } from '../ResearchRowActions';
import { SignalCard } from '../research/SignalCard';
import { ActiveFilterStrip } from './ActiveFilterStrip';
import { ScreenerRowDetail } from './ScreenerRowDetail';
import type { ScreenerCustomFilters, ScreenerTaPresetFilters, ScreenerTechFilters } from '../../lib/screener-filters';

function crossCell(active: boolean | null | undefined, bars: number | null | undefined): string {
  if (!active) return '—';
  return bars != null ? `✓@${bars}` : '✓';
}

export function ScreenerResults({
  rows,
  scanned,
  passed,
  restrictedSkipped,
  cacheHits,
  tablePrefilterSkipped,
  stockCacheHits,
  fullAnalyzed,
  exchangeListAsOf,
  jobId,
  filterStrip,
  presetSort,
  resultsKey,
  showEmaColumns = false,
  showHourlyEmaColumns = false,
}: {
  rows: ScreenerRow[];
  scanned?: number;
  passed?: number;
  restrictedSkipped?: number;
  cacheHits?: number;
  tablePrefilterSkipped?: number;
  stockCacheHits?: number;
  fullAnalyzed?: number;
  exchangeListAsOf?: string;
  jobId?: string | null;
  filterStrip?: {
    universeName?: string;
    presetLabel?: string;
    custom?: ScreenerCustomFilters;
    tech?: ScreenerTechFilters;
    taPreset?: ScreenerTaPresetFilters;
    showTa?: boolean;
    excludeRestricted?: boolean;
    recommendationFilter?: string;
    presetHasRecommendationTiers?: boolean;
  };
  showEmaColumns?: boolean;
  presetSort?: { key: SortKey; dir: 'asc' | 'desc' };
  resultsKey?: string;
  showHourlyEmaColumns?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>(presetSort?.key ?? 'recommendation');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(presetSort?.dir ?? 'desc');
  const [actionMsg, setActionMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!presetSort || !resultsKey) return;
    setSortKey(presetSort.key);
    setSortDir(presetSort.dir);
  }, [resultsKey, presetSort?.key, presetSort?.dir]);

  const sorted = sortRows(rows, sortKey, sortDir);
  const showTa = rows.some((r) => r.ta_ready);
  const detailColSpan = (() => {
    let n = 12;
    if (showTa) {
      n += 7;
      if (showEmaColumns) n += 2;
      if (showHourlyEmaColumns) n += 2;
    }
    return n;
  })();

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(defaultDirForSortKey(key));
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  return (
    <div className="card screener-results">
      <div className="screener-results-header">
        <div>
          <h2 style={{ margin: 0 }}>Results ({rows.length})</h2>
          {scanned != null && (
            <p className="muted screener-results-meta">
              Scanned {scanned} symbols · {passed ?? rows.length} passed
              {restrictedSkipped ? ` · ${restrictedSkipped} ASM/GSM/T2T skipped` : ''}
              {tablePrefilterSkipped ? ` · ${tablePrefilterSkipped} table prefilter skips` : ''}
              {cacheHits ? ` · ${cacheHits} row cache hits` : ''}
              {stockCacheHits ? ` · ${stockCacheHits} stock cache hits` : ''}
              {fullAnalyzed ? ` · ${fullAnalyzed} full analyzed` : ''}
              {exchangeListAsOf ? ` · exchange lists as of ${exchangeListAsOf}` : ''}
            </p>
          )}
        </div>
        <div className="screener-results-actions">
          <label className="screener-sort">
            Sort
            <select
              value={sortKey}
              onChange={(e) => {
                const k = e.target.value as SortKey;
                setSortKey(k);
                setSortDir(defaultDirForSortKey(k));
              }}
            >
              <option value="recommendation">Recommendation</option>
              <option value="mos">MOS</option>
              <option value="composite_score">Quality score</option>
              <option value="roe">ROE</option>
              <option value="roce">ROCE</option>
              <option value="pe">P/E</option>
              <option value="symbol">Symbol</option>
              <option value="sales_yoy">Sales YoY</option>
              <option value="div_yield">Dividend yield</option>
              <option value="moat_count">Moat count</option>
              <option value="ta_rsi14">RSI (low first)</option>
              <option value="ta_pct_52w">52w % (low first)</option>
              <option value="ta_bb_pct_b">BB %B (low first)</option>
              <option value="ta_macd_hist">MACD hist</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (expanded.size === sorted.length) setExpanded(new Set());
              else setExpanded(new Set(sorted.map((r) => r.symbol)));
            }}
          >
            {expanded.size === sorted.length && sorted.length > 0 ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exporting}
            onClick={() => {
              void (async () => {
                setExporting(true);
                try {
                  if (jobId) {
                    await downloadJobPitchCsv(jobId);
                  } else {
                    downloadPitchCsv(sorted);
                  }
                } catch (err) {
                  setActionMsg(err instanceof Error ? err.message : 'Export failed');
                } finally {
                  setExporting(false);
                }
              })();
            }}
          >
            {exporting ? 'Exporting…' : 'Export pitch CSV'}
          </button>
        </div>
      </div>

      {actionMsg ? <p className="flash success">{actionMsg}</p> : null}

      {filterStrip ? <ActiveFilterStrip {...filterStrip} /> : null}

      <div className="table-scroll">
        <table className="data-table screener-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('symbol')}>
                  Symbol{sortIndicator('symbol')}
                </button>
              </th>
              <th>Price</th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('pe')}>
                  P/E{sortIndicator('pe')}
                </button>
              </th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('roe')}>
                  ROE{sortIndicator('roe')}
                </button>
              </th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('roce')}>
                  ROCE{sortIndicator('roce')}
                </button>
              </th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('mos')}>
                  MOS{sortIndicator('mos')}
                </button>
              </th>
              <th>Fair P/E</th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('composite_score')}>
                  Quality /100{sortIndicator('composite_score')}
                </button>
              </th>
              <th>Zone</th>
              <th>
                <button type="button" className="th-sort" onClick={() => toggleSort('recommendation')}>
                  Quick verdict{sortIndicator('recommendation')}
                </button>
              </th>
              <th title="Cached Full Verify scorecard when available">Verify</th>
              {showTa ? (
                <>
                  <th>RSI</th>
                  <th>52w%</th>
                  <th>SMA50</th>
                  <th>↑SMA20</th>
                  <th>↑SMA50</th>
                  {showEmaColumns ? (
                    <>
                      <th>↑EMA20</th>
                      <th>↑EMA50</th>
                    </>
                  ) : null}
                  {showHourlyEmaColumns ? (
                    <>
                      <th>H↑EMA20</th>
                      <th>H↑EMA50</th>
                    </>
                  ) : null}
                  <th>MACD</th>
                  <th>Bottom</th>
                </>
              ) : null}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isOpen = expanded.has(r.symbol);
              const colSpan = detailColSpan;
              return (
              <>
              <tr key={r.symbol} className={isOpen ? 'screener-row-expanded' : undefined}>
                <td>
                  <SignalCard
                    variant="inline"
                    symbol={r.symbol}
                    subtitle={r.name}
                    mos={r.mos}
                    qualityScore={r.composite_score}
                    zone={r.zone}
                    recommendationBasis={r.recommendation_basis}
                    scoreBasis={r.score_basis}
                  />
                </td>
                <td>{fmtNum(r.price, 2)}</td>
                <td>{fmtNum(r.pe, 1)}</td>
                <td>{fmtPct(r.roe)}</td>
                <td>{fmtPct(r.roce)}</td>
                <td className={r.mos != null && r.mos >= 15 ? 'pos' : r.mos != null && r.mos < 0 ? 'neg' : ''}>
                  {fmtPct(r.mos)}
                </td>
                <td>{r.fair_pe > 0 ? fmtNum(r.fair_pe, 1) : '—'}</td>
                <td title={r.score_basis === 'quality_proxy' ? 'CFA quality proxy, not the Full Verify 56-point scorecard.' : undefined}>
                  {r.composite_score}
                </td>
                <td>
                  <span className={badgeClass(r.zone)}>{r.zone}</span>
                </td>
                <td className="screener-verdict">
                  <div>{r.recommendation}</div>
                </td>
                <td className="screener-verify-hint">
                  {r.verify_cached && r.verify_score != null ? (
                    <span
                      title={
                        r.verify_decision
                          ? `Full Verify: ${r.verify_decision}` +
                            (r.verify_iv && r.iv_delta_pct != null
                              ? ` · IV Δ ${r.iv_delta_pct.toFixed(1)}%`
                              : '')
                          : 'Cached Full Verify scorecard'
                      }
                      className={r.iv_drift_warn ? 'neg' : undefined}
                    >
                      {r.verify_score}/56{r.iv_drift_warn ? ' ⚠' : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                {showTa ? (
                  <>
                    <td>{r.ta_rsi14 != null ? fmtNum(r.ta_rsi14, 1) : '—'}</td>
                    <td>{r.ta_pct_52w != null ? `${fmtNum(r.ta_pct_52w, 0)}%` : '—'}</td>
                    <td>{r.ta_above_sma50 ? '✓' : '—'}</td>
                    <td title={r.ta_cross_above_sma20_bars != null ? `${r.ta_cross_above_sma20_bars} bars ago` : undefined}>
                      {r.ta_cross_above_sma20 ? '✓' : '—'}
                    </td>
                    <td title={r.ta_cross_above_sma50_bars != null ? `${r.ta_cross_above_sma50_bars} bars ago` : undefined}>
                      {r.ta_cross_above_sma50 ? '✓' : '—'}
                    </td>
                    {showEmaColumns ? (
                      <>
                        <td title={r.ta_cross_above_ema20_bars != null ? `${r.ta_cross_above_ema20_bars} bars ago` : undefined}>
                          {crossCell(r.ta_cross_above_ema20, r.ta_cross_above_ema20_bars)}
                        </td>
                        <td title={r.ta_cross_above_ema50_bars != null ? `${r.ta_cross_above_ema50_bars} bars ago` : undefined}>
                          {crossCell(r.ta_cross_above_ema50, r.ta_cross_above_ema50_bars)}
                        </td>
                      </>
                    ) : null}
                    {showHourlyEmaColumns ? (
                      <>
                        <td title={r.ta_h_cross_above_ema20_bars != null ? `${r.ta_h_cross_above_ema20_bars} bars ago` : undefined}>
                          {crossCell(r.ta_h_cross_above_ema20, r.ta_h_cross_above_ema20_bars)}
                        </td>
                        <td title={r.ta_h_cross_above_ema50_bars != null ? `${r.ta_h_cross_above_ema50_bars} bars ago` : undefined}>
                          {crossCell(r.ta_h_cross_above_ema50, r.ta_h_cross_above_ema50_bars)}
                        </td>
                      </>
                    ) : null}
                    <td>{r.ta_macd_hist != null ? fmtNum(r.ta_macd_hist, 2) : '—'}</td>
                    <td>{r.ta_bottom_out_hint ? '✓' : '—'}</td>
                  </>
                ) : null}
                <td className="screener-actions">
                  <button
                    type="button"
                    className="screener-expand-btn"
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `Collapse ${r.symbol} CFA detail` : `Expand ${r.symbol} CFA detail`}
                    onClick={() => {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.symbol)) next.delete(r.symbol);
                        else next.add(r.symbol);
                        return next;
                      });
                    }}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                  <ResearchRowActions
                    symbol={r.symbol}
                    source="screener"
                    sourceLabel="Screener"
                    onMessage={setActionMsg}
                  />
                </td>
              </tr>
              {isOpen ? (
                <tr key={`${r.symbol}-detail`} className="screener-detail-row">
                  <td colSpan={colSpan}>
                    <ScreenerRowDetail row={r} />
                  </td>
                </tr>
              ) : null}
              </>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  badgeClass,
  downloadPitchCsv,
  fmtNum,
  fmtPct,
  sortRows,
  type ScreenerRow,
  type SortKey,
} from '../../lib/screener-export';
import { ResearchRowActions } from '../ResearchRowActions';

export function ScreenerResults({
  rows,
  scanned,
  passed,
  restrictedSkipped,
  cacheHits,
  exchangeListAsOf,
}: {
  rows: ScreenerRow[];
  scanned?: number;
  passed?: number;
  restrictedSkipped?: number;
  cacheHits?: number;
  exchangeListAsOf?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('mos');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [actionMsg, setActionMsg] = useState('');

  const sorted = sortRows(rows, sortKey, sortDir);
  const showTa = rows.some((r) => r.ta_ready);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
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
              {cacheHits ? ` · ${cacheHits} cache hits` : ''}
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
                setSortDir(k === 'symbol' ? 'asc' : 'desc');
              }}
            >
              <option value="mos">MOS</option>
              <option value="composite_score">Quality score</option>
              <option value="roe">ROE</option>
              <option value="roce">ROCE</option>
              <option value="pe">P/E</option>
              <option value="symbol">Symbol</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => downloadPitchCsv(sorted)}>
            Export pitch CSV
          </button>
        </div>
      </div>

      {actionMsg ? <p className="flash success">{actionMsg}</p> : null}

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
                  Score{sortIndicator('composite_score')}
                </button>
              </th>
              <th>Zone</th>
              <th>Verdict</th>
              {showTa ? (
                <>
                  <th>RSI</th>
                  <th>52w%</th>
                  <th>SMA50</th>
                  <th>MACD</th>
                  <th>Bottom</th>
                </>
              ) : null}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <Link to={`/stock/${encodeURIComponent(r.symbol)}`}>
                    <strong>{r.symbol}</strong>
                  </Link>
                  <br />
                  <span className="muted">{r.name}</span>
                </td>
                <td>{fmtNum(r.price, 2)}</td>
                <td>{fmtNum(r.pe, 1)}</td>
                <td>{fmtPct(r.roe)}</td>
                <td>{fmtPct(r.roce)}</td>
                <td className={r.mos != null && r.mos >= 15 ? 'pos' : r.mos != null && r.mos < 0 ? 'neg' : ''}>
                  {fmtPct(r.mos)}
                </td>
                <td>{r.fair_pe > 0 ? fmtNum(r.fair_pe, 1) : '—'}</td>
                <td>{r.composite_score}</td>
                <td>
                  <span className={badgeClass(r.zone)}>{r.zone}</span>
                </td>
                <td className="screener-verdict">{r.recommendation}</td>
                {showTa ? (
                  <>
                    <td>{r.ta_rsi14 != null ? fmtNum(r.ta_rsi14, 1) : '—'}</td>
                    <td>{r.ta_pct_52w != null ? `${fmtNum(r.ta_pct_52w, 0)}%` : '—'}</td>
                    <td>{r.ta_above_sma50 ? '✓' : '—'}</td>
                    <td>{r.ta_macd_hist != null ? fmtNum(r.ta_macd_hist, 2) : '—'}</td>
                    <td>{r.ta_bottom_out_hint ? '✓' : '—'}</td>
                  </>
                ) : null}
                <td className="screener-actions">
                  <ResearchRowActions
                    symbol={r.symbol}
                    source="screener"
                    sourceLabel="Screener"
                    onMessage={setActionMsg}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

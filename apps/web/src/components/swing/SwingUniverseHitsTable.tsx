import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { SwingEntryRulesTable } from './SwingEntryRulesTable';
import { SwingScanHitAddButton } from './SwingScanHitAddButton';
import { fmtMoney, fmtNum, verdictClass, zoneClass } from './format';

export interface UniverseScanHit {
  symbol: string;
  price: number;
  verdict: string;
  strict_verdict: string;
  entry_score: number;
  rules_passed: number;
  rules_scored?: number;
  stop_loss: number | null;
  profit_target: number | null;
  r_multiple: number | null;
  swing_rank?: number;
  swing_tier?: string;
  ta_rsi14?: number | null;
  ta_pct_52w?: number | null;
  ta_52w_chart_zone?: string;
  ta_52w_low_date?: string;
  ta_52w_high_date?: string;
  ta_volume_ratio?: number | null;
  ta_macd_hist?: number | null;
  broke_swing_high?: boolean;
  as_of_date?: string;
  entry_rules?: Array<{ id: string; name: string; criterion: string; passed: boolean | null; detail: string }>;
  rules?: Array<{ id: string; name: string; criterion: string; passed: boolean | null; detail: string }>;
}

interface Props {
  hits: UniverseScanHit[];
}

function zoneTitle(hit: UniverseScanHit): string {
  const low = hit.ta_52w_low_date ? `Low ${hit.ta_52w_low_date}` : '';
  const high = hit.ta_52w_high_date ? `High ${hit.ta_52w_high_date}` : '';
  return [low, high].filter(Boolean).join(' · ');
}

function zoneLabel(hit: UniverseScanHit): string {
  const pct = hit.ta_pct_52w;
  const zone = String(hit.ta_52w_chart_zone ?? '').toUpperCase();
  if (pct == null) return zone || '—';
  return `${fmtNum(pct, '%', 0)}${zone ? ` · ${zone}` : ''}`;
}

export function SwingUniverseHitsTable({ hits }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="card swing-uni-hits">
      <h2 style={{ marginTop: 0 }}>Hits ({hits.length})</h2>
      <div className="swing-uni-table-wrap">
        <table className="data-table swing-uni-table">
          <thead>
            <tr>
              <th aria-label="Expand rules" />
              <th>Symbol</th>
              <th>Rank</th>
              <th>Tier</th>
              <th>Score</th>
              <th>Discovery</th>
              <th>Strict</th>
              <th>Rules</th>
              <th>Price</th>
              <th>Stop</th>
              <th>Target</th>
              <th>R</th>
              <th>RSI</th>
              <th>52w%</th>
              <th>Vol×</th>
              <th>Brk</th>
              <th>MACD</th>
              <th>Add</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => {
              const rules = h.entry_rules ?? h.rules ?? [];
              const open = expanded === h.symbol;
              const scored = h.rules_scored ?? 11;
              const symbolUrl = `/swing?mode=symbol&symbol=${encodeURIComponent(h.symbol)}&autorun=1`;
              return (
                <Fragment key={h.symbol}>
                  <tr>
                    <td>
                      {rules.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => setExpanded(open ? null : h.symbol)}
                        >
                          {open ? '−' : '+'}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <Link to={symbolUrl} className="swing-symbol-link">
                        <strong>{h.symbol}</strong>
                      </Link>
                    </td>
                    <td>
                      <strong>{h.swing_rank ?? '—'}</strong>
                    </td>
                    <td>{h.swing_tier ?? '—'}</td>
                    <td>{h.entry_score}</td>
                    <td>
                      <span className={`swing-verdict-pill ${verdictClass(h.verdict)}`}>{h.verdict}</span>
                    </td>
                    <td>
                      <span className={`swing-verdict-pill ${verdictClass(h.strict_verdict)}`}>{h.strict_verdict}</span>
                    </td>
                    <td>
                      {h.rules_passed}/{scored}
                    </td>
                    <td className="swing-uni-price">
                      {fmtMoney(h.price)}
                      {h.as_of_date ? (
                        <>
                          <br />
                          <span className="swing-eod-badge" title={`Yahoo daily close · ${h.as_of_date}`}>
                            EOD
                          </span>
                          <br />
                          <span className="swing-zone-dates">{h.as_of_date}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{h.stop_loss != null ? fmtMoney(h.stop_loss) : '—'}</td>
                    <td>{h.profit_target != null ? fmtMoney(h.profit_target) : '—'}</td>
                    <td>{h.r_multiple != null ? fmtNum(h.r_multiple, '', 2) : '—'}</td>
                    <td>{h.ta_rsi14 != null ? fmtNum(h.ta_rsi14, '', 1) : '—'}</td>
                    <td>
                      <span
                        className={zoneClass(String(h.ta_52w_chart_zone ?? ''))}
                        title={zoneTitle(h)}
                      >
                        {zoneLabel(h)}
                      </span>
                    </td>
                    <td title="Latest volume ÷ 20-day average">
                      {h.ta_volume_ratio != null ? `${fmtNum(h.ta_volume_ratio, '', 2)}×` : '—'}
                    </td>
                    <td title="Close cleared last swing high">{h.broke_swing_high ? '✓' : '—'}</td>
                    <td>{h.ta_macd_hist != null ? fmtNum(h.ta_macd_hist, '', 2) : '—'}</td>
                    <td>
                      <SwingScanHitAddButton
                        symbol={h.symbol}
                        price={h.price}
                        asOfDate={h.as_of_date}
                        stopLoss={h.stop_loss}
                        profitTarget={h.profit_target}
                        verdict={h.verdict}
                        rulesPassed={h.rules_passed}
                      />
                    </td>
                  </tr>
                  {open && rules.length > 0 ? (
                    <tr key={`${h.symbol}-rules`}>
                      <td colSpan={18}>
                        <SwingEntryRulesTable rules={rules} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

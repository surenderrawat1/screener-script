import { Link } from 'react-router-dom';
import { fmtNum, formatRegimeLabel, regimeClass } from './format';

export interface SwingScanSummaryData {
  hits: number;
  strict_enter: number;
  discovery_enter: number;
  setup: number;
  filter_label: string;
  no_chart: number;
  full_universe: boolean;
}

export interface PrefetchStats {
  cached: number;
  fetched: number;
}

interface Props {
  universeName: string;
  scanned: number;
  symbolsRequested?: number;
  durationMs?: number;
  engineVersion?: string;
  regime?: Record<string, unknown> | null;
  summary: SwingScanSummaryData | null;
  filterStats?: Record<string, number> | null;
  scanMessage?: string;
  source?: string | null;
  prefetch?: PrefetchStats | null;
}

function filterStatLabel(key: string): string {
  const labels: Record<string, string> = {
    min_verdict: 'Min verdict',
    gc9_only: 'GC9 only (E11)',
    entry_rules: 'Required rules',
    zone_52w: '52w zone',
    breakout_volume: 'Breakout + volume',
    no_ta: 'Insufficient TA',
    no_price: 'No price',
  };
  return labels[key] ?? key;
}

export function SwingUniverseScanSummary({
  universeName,
  scanned,
  symbolsRequested,
  durationMs,
  engineVersion,
  regime,
  summary,
  filterStats,
  scanMessage,
  source,
  prefetch,
}: Props) {
  const regimeLabel = formatRegimeLabel(regime);
  const regimeCls = regime ? regimeClass(regime) : '';
  const durationSec = durationMs != null && durationMs > 0 ? fmtNum(durationMs / 1000, 's', 2) : null;
  const blocksStrict = Boolean(regime?.blocks_strict_enter);
  const bearOverlay = Boolean(regime?.bear) && !Boolean(regime?.strong_bear);

  return (
    <section className="card swing-uni-summary">
      <h2 style={{ marginTop: 0 }}>Universe scan — {universeName}</h2>
      {scanMessage ? <p className="muted">{scanMessage}</p> : null}
      <div className="swing-kpi-bar">
        <div className="swing-kpi-pills">
          <span className={`swing-pill ${regimeCls}`}>Regime {regimeLabel}</span>
          {engineVersion ? <span className="swing-pill">Engine {engineVersion}</span> : null}
          <span className="swing-pill">
            Scanned <strong>{symbolsRequested ?? scanned}</strong>
          </span>
          {summary ? (
            <>
              <span className="swing-pill">
                Hits <strong>{summary.hits}</strong>
              </span>
              <span className="swing-pill">
                Filter <strong>{summary.filter_label}</strong>
              </span>
              <span className="swing-pill">
                Strict ENTER <strong className="swing-bt-strong">{summary.strict_enter}</strong>
              </span>
              <span className="swing-pill">
                Discovery ENTER <strong>{summary.discovery_enter}</strong>
              </span>
              <span className="swing-pill">
                SETUP <strong>{summary.setup}</strong>
              </span>
              {summary.full_universe ? (
                <span className="swing-pill">
                  Full universe <strong>{symbolsRequested ?? scanned}</strong>
                </span>
              ) : null}
              {summary.no_chart > 0 ? (
                <span className="swing-pill">
                  No chart <strong>{summary.no_chart}</strong>
                </span>
              ) : null}
            </>
          ) : null}
          {source ? (
            <span className="swing-pill">
              Source <strong>{source}</strong>
            </span>
          ) : null}
          {prefetch && (prefetch.cached > 0 || prefetch.fetched > 0) ? (
            <span className="swing-pill">
              Prefetch <strong>{prefetch.cached}</strong> cached · <strong>{prefetch.fetched}</strong> fetched
            </span>
          ) : null}
          {durationSec ? <span className="swing-pill">{durationSec}</span> : null}
        </div>
      </div>
      <p className="swing-subsection-hint muted">
        <strong>CFA workflow:</strong> sort by swing rank (Tier A ≥75 entry score) → Strict ENTER column for live
        orders → <Link to="/positions">Positions</Link>. Discovery column is wider (SETUP+ research); strict uses
        full E1–E8 + score floor.
      </p>
      {bearOverlay || blocksStrict ? (
        <p className="swing-subsection-hint muted">
          {blocksStrict
            ? 'Strong bear regime — strict ENTER is blocked; use Discovery / SETUP for research only.'
            : 'Mild bear overlay (index below SMA-200) — use the Strict column for order-ready names.'}{' '}
          Filter <strong>Strict ENTER only</strong> to hide discovery SETUP rows.
        </p>
      ) : null}
      {filterStats && Object.keys(filterStats).length > 0 ? (
        <details className="swing-filter-breakdown">
          <summary>Filter breakdown (why symbols dropped)</summary>
          <ul className="swing-filter-list">
            {Object.entries(filterStats)
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => (
                <li key={key}>
                  {filterStatLabel(key)}: {count}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

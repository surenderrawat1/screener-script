import { Link } from 'react-router-dom';

export type GateStatus = 'pass' | 'fail' | 'unproven' | 'missing';

export interface EconomicGateBook {
  id: string;
  label: string;
  book: string;
  status: GateStatus;
  paper_only: boolean;
  net_expectancy_r?: number | null;
  profit_factor?: number | null;
  trades?: number;
  period_days?: number;
  preset_id?: string;
  instrument_id?: string;
  interval?: string;
  hc_hits?: number;
  hc_econ_pass?: number;
  detail?: string;
  reasons?: string[];
}

function statusLabel(status: GateStatus): string {
  switch (status) {
    case 'pass':
      return 'ECON PASS';
    case 'fail':
      return 'ECON FAIL';
    case 'unproven':
      return 'ECON UNPROVEN';
    default:
      return 'ECON MISSING';
  }
}

function toneClass(status: GateStatus): string {
  switch (status) {
    case 'pass':
      return 'econ-gate econ-gate-pass';
    case 'fail':
      return 'econ-gate econ-gate-fail';
    case 'unproven':
      return 'econ-gate econ-gate-warn';
    default:
      return 'econ-gate econ-gate-missing';
  }
}

function fmtMetric(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** CFA economic-edge banner — net E, PF, sample, paper-only guidance. */
export function EconomicGateBanner({
  gate,
  backtestHref,
  compact = false,
}: {
  gate: EconomicGateBook | null | undefined;
  backtestHref?: string;
  compact?: boolean;
}) {
  if (!gate) return null;

  const paperBadge = gate.paper_only ? (
    <span className="econ-gate-paper">Paper only</span>
  ) : null;

  return (
    <div className={toneClass(gate.status)} role="status">
      <div className="econ-gate-head">
        <strong>{gate.label}</strong>
        <span className={`econ-gate-status econ-gate-status-${gate.status}`}>{statusLabel(gate.status)}</span>
        {paperBadge}
      </div>
      {!compact && gate.detail ? <p className="econ-gate-detail muted">{gate.detail}</p> : null}
      <div className="econ-gate-metrics">
        {gate.net_expectancy_r != null ? (
          <span>
            Net E <strong>{fmtMetric(gate.net_expectancy_r)}R</strong>
          </span>
        ) : null}
        {gate.profit_factor != null ? (
          <span>
            PF <strong>{fmtMetric(gate.profit_factor)}</strong>
          </span>
        ) : null}
        {gate.trades != null && gate.trades > 0 ? (
          <span>
            n=<strong>{gate.trades}</strong>
          </span>
        ) : null}
        {gate.hc_hits != null ? (
          <span>
            HC hits <strong>{gate.hc_hits}</strong>
            {gate.hc_econ_pass != null ? ` · edge ${gate.hc_econ_pass} pass` : ''}
          </span>
        ) : null}
        {gate.period_days ? <span>{gate.period_days}d window</span> : null}
      </div>
      {gate.reasons?.length ? (
        <ul className="econ-gate-reasons">
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {gate.status !== 'pass' ? (
        <p className="econ-gate-note">
          Do not size live capital on this book until economic edge passes backtest gates.
          {backtestHref ? (
            <>
              {' '}
              <Link to={backtestHref}>View backtest →</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Pick a book from the API payload by id prefix or exact match. */
export function pickEconomicGate(
  books: EconomicGateBook[] | undefined,
  matcher: { id?: string; book?: string; instrument_id?: string },
): EconomicGateBook | undefined {
  if (!books?.length) return undefined;
  if (matcher.id) {
    const exact = books.find((b) => b.id === matcher.id);
    if (exact) return exact;
  }
  if (matcher.instrument_id && matcher.book) {
    return books.find(
      (b) => b.book === matcher.book && b.instrument_id === matcher.instrument_id,
    );
  }
  if (matcher.book) return books.find((b) => b.book === matcher.book);
  return undefined;
}

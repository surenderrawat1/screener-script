import { fmtMoney, verdictClass } from './format';
import type { SwingEngineMeta, SwingEntryPayload } from './types';

interface Props {
  symbol: string;
  price: number;
  asOfDate?: string | null;
  entry: SwingEntryPayload;
  regime: Record<string, unknown>;
  engineMeta?: SwingEngineMeta;
  scanEligibility?: { passes: boolean; failed: string[] };
}

export function SwingSymbolSummary({
  symbol,
  price,
  asOfDate,
  entry,
  regime,
  engineMeta,
  scanEligibility,
}: Props) {
  const strict = String(entry.strict_verdict ?? 'AVOID');
  const discovery = String(entry.discovery_verdict ?? 'AVOID');
  const strictReady = entry.strict_enter_ready !== false;
  const strictFloor = Number(entry.strict_floor ?? 0);
  const minR = Number(entry.min_r_multiple ?? engineMeta?.min_r_multiple ?? 0);
  const minNetEdge = Number(engineMeta?.min_net_edge_pct ?? 0);
  const chargePct = Number(engineMeta?.estimated_round_trip_charge_pct ?? 0);
  const ruleCount = Number(engineMeta?.entry_rule_count ?? entry.rules?.length ?? 11);
  const gc9 = entry.gc9 ?? {};
  const gc9Label = gc9.label ? String(gc9.label) : gc9.gc9_entry || gc9.gc9_active ? 'GC9 · swing long' : gc9.entry_ok ? 'GC9 structure' : '';
  const failedChaseRules = (entry.rules ?? [])
    .filter((r) => r.passed === false && ['E2', 'E4', 'E5'].includes(r.id))
    .map((r) => `${r.id} ${r.name}`);

  return (
    <header className="swing-symbol-summary">
      <div className="swing-symbol-title-row">
        <h2 className="swing-symbol-title">
          {symbol}
          <span className="swing-symbol-price">{fmtMoney(price)}</span>
        </h2>
        {asOfDate ? (
          <p className="swing-symbol-asof muted">
            EOD as of <strong>{asOfDate}</strong> · 2Y daily series
          </p>
        ) : null}
      </div>

      <div className="swing-verdict-banner swing-symbol-verdicts">
        <span className={`swing-verdict-pill ${verdictClass(strict)}`} title="Strict gate — live orders & backtest parity">
          Strict {strict}
        </span>
        <span className={`swing-verdict-pill ${verdictClass(discovery)}`} title="Discovery gate — universe scan ranking">
          Discovery {discovery}
        </span>
        {gc9Label ? (
          <span className="swing-verdict-pill swing-verdict-gc9" title={String(gc9.message ?? '')}>
            {gc9Label}
          </span>
        ) : null}
        {regime.label ? (
          <span className="swing-verdict-pill swing-regime-pill" title="Nifty proxy via NIFTYBEES">
            {String(regime.label)}
          </span>
        ) : null}
      </div>

      <p className="swing-symbol-score-line">
        Composite score <strong>{Number(entry.entry_score ?? 0)}</strong>/100
        {strictFloor > 0 ? (
          <>
            {' '}
            · need ≥{strictFloor} strict ENTER
          </>
        ) : null}
        {minR > 0 ? <> · R ≥{minR}</> : null}
        {minNetEdge > 0 ? (
          <>
            {' '}
            · net edge ≥{minNetEdge}%{chargePct > 0 ? ` (after ~${chargePct}% charges)` : ''}
          </>
        ) : null}
        {entry.net_edge_ok === false ? <span className="swing-flag-warn"> · net edge below floor</span> : null}
        {entry.r_multiple_ok === false ? <span className="swing-flag-warn"> · R below minimum</span> : null}
      </p>

      <div className="swing-symbol-meta-row">
        <span>
          {Number(entry.rules_passed ?? 0)} / {ruleCount} rules pass
        </span>
        {entry.deploy_scale != null ? (
          <span>
            NAV deploy <strong>{Number(entry.deploy_scale).toFixed(2)}×</strong>
          </span>
        ) : null}
        <span className="muted">Engine {String(entry.engine_version ?? engineMeta?.engine_version ?? '—')}</span>
      </div>

      {scanEligibility && !scanEligibility.passes ? (
        <p className="swing-scan-eligibility-warn">
          Current scan filters would exclude this symbol: {scanEligibility.failed.join(' · ')}
        </p>
      ) : null}
      {scanEligibility?.passes ? (
        <p className="swing-scan-eligibility-ok muted">Passes active scanner filters.</p>
      ) : null}
      {discovery === 'ENTER' && strict !== 'ENTER' ? (
        <p className="swing-scan-eligibility-warn">
          Discovery ENTER is for ranking only. Strict gate is <strong>{strict}</strong>
          {strictFloor > 0 ? ` and needs score >= ${strictFloor}` : ''}; do not use this as an order-ready signal.
        </p>
      ) : null}
      {strict === 'ENTER' && !strictReady ? (
        <p className="swing-scan-eligibility-warn">
          Strict verdict is ENTER, but strict readiness is not confirmed. Re-check rule table and risk gates before adding.
        </p>
      ) : null}
      {failedChaseRules.length > 0 ? (
        <p className="swing-scan-eligibility-warn">
          CFA caution: chase-risk rules failed ({failedChaseRules.join(' · ')}). Prefer pullback/confirmation before sizing up,
          even if the strict gate passes.
        </p>
      ) : null}
    </header>
  );
}

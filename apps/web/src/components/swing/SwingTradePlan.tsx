import { Link } from 'react-router-dom';
import { fmtMoney, fmtNum, paCandleLabel, paStructureLabel } from './format';
import type { SwingEntryPayload } from './types';

interface Props {
  entry: SwingEntryPayload;
}

export function SwingTradePlan({ entry }: Props) {
  const pa = entry.price_action ?? {};

  return (
    <section className="swing-subsection" aria-label="Trade plan">
      <h3>Trade plan</h3>
      <p className="swing-subsection-hint muted">Dynamic stops from EMA/ATR structure; target frozen at entry for R discipline.</p>
      <dl className="swing-metric-grid">
        <div>
          <dt>Effective stop</dt>
          <dd>
            {fmtMoney(entry.stop_loss)}
            {entry.risk_pct != null ? <span className="muted"> (−{fmtNum(entry.risk_pct, '%')} risk)</span> : null}
          </dd>
        </div>
        <div>
          <dt>Hard stop</dt>
          <dd>{fmtMoney(entry.hard_stop)}</dd>
        </div>
        <div>
          <dt>Structural stop</dt>
          <dd>{fmtMoney(entry.structural_stop)}</dd>
        </div>
        <div>
          <dt>Profit target</dt>
          <dd>
            {fmtMoney(entry.profit_target)}
            {entry.target_pct != null && entry.r_multiple != null ? (
              <span className="muted">
                {' '}
                (+{fmtNum(entry.target_pct, '%')} · {fmtNum(entry.r_multiple)}R)
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>R-multiple</dt>
          <dd className={entry.r_multiple_ok ? 'swing-metric-ok' : 'swing-metric-warn'}>
            {entry.r_multiple != null ? fmtNum(entry.r_multiple) : '—'}
          </dd>
        </div>
        <div>
          <dt>Time stop</dt>
          <dd>{Number(entry.time_stop_days ?? 15)} sessions</dd>
        </div>
        <div>
          <dt>PA structure</dt>
          <dd>{paStructureLabel(pa)}</dd>
        </div>
        <div>
          <dt>PA candle</dt>
          <dd>{paCandleLabel(pa)}</dd>
        </div>
      </dl>
      <Link to="/swing/positions" className="btn btn-secondary btn-xs swing-all-positions">
        Open positions ledger →
      </Link>
    </section>
  );
}

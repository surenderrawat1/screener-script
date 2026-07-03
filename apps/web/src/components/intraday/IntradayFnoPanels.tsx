import { Link } from 'react-router-dom';

type ProductMode = 'spot' | 'futures' | 'options';

function fmtRs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function IntradayTradePlanCard({ plan }: { plan: Record<string, unknown> | null | undefined }) {
  if (!plan?.ok) {
    return (
      <div className="intraday-plan-block intraday-plan-wait">
        <p>{String(plan?.message ?? 'No actionable spot plan — stand aside.')}</p>
      </div>
    );
  }

  const entry = (plan.entry as Record<string, unknown>) ?? {};
  const stop = (plan.stop_loss as Record<string, unknown>) ?? {};
  const exits = (plan.exits as Array<Record<string, unknown>>) ?? [];
  const trigger = (plan.trigger as Record<string, unknown>) ?? {};

  return (
    <div className={`intraday-plan-block intraday-plan-${String(plan.tone ?? 'neutral')}`}>
      <div className="intraday-plan-head">
        <span className={`intraday-bias-badge ${plan.bias}`}>{String(plan.bias_label ?? plan.bias)}</span>
        <span className="muted">{String(plan.action_label ?? '')}</span>
        <span className={`intraday-trigger ${trigger.actionable ? 'ready' : 'wait'}`}>
          {String(trigger.label ?? trigger.status ?? '')}
        </span>
      </div>
      <div className="intraday-levels-grid">
        <div>
          <span className="intraday-level-label">Entry</span>
          <strong>{fmtRs(Number(entry.price ?? 0))}</strong>
          <small className="muted block">{String(entry.condition ?? entry.type ?? '')}</small>
        </div>
        <div>
          <span className="intraday-level-label">Stop</span>
          <strong className="intraday-neg">{fmtRs(Number(stop.price ?? 0))}</strong>
          <small className="muted block">{Number(stop.pts ?? 0)} pts</small>
        </div>
        {exits.map((ex) => (
          <div key={String(ex.tier)}>
            <span className="intraday-level-label">{String(ex.tier)}</span>
            <strong className="intraday-pos">{fmtRs(Number(ex.price ?? 0))}</strong>
            <small className="muted block">{String(ex.action ?? '')}</small>
          </div>
        ))}
      </div>
      <p className="muted intraday-plan-meta">
        Time exit {String(plan.time_stop_ist ?? '15:15')} IST · confidence {Number(plan.confidence ?? 0)}%
      </p>
    </div>
  );
}

export function IntradayFnoPanel({
  fno,
  mode,
}: {
  fno: Record<string, unknown> | null | undefined;
  mode: ProductMode;
}) {
  if (!fno?.ok) {
    return (
      <div className="intraday-fno-block">
        <p className="muted">{String(fno?.message ?? 'F&O plans unavailable.')}</p>
      </div>
    );
  }

  const futures = fno.futures as Record<string, unknown> | null;
  const options = fno.options as Record<string, unknown> | null;

  if (mode === 'futures' && futures) {
    const targets = (futures.targets as Array<Record<string, unknown>>) ?? [];
    return (
      <div className="intraday-fno-block">
        <div className="intraday-fno-head">
          <h3>{String(futures.symbol_label)}</h3>
          <span className={`intraday-bias-badge ${fno.bias}`}>{String(futures.side_label)}</span>
        </div>
        <div className="intraday-fno-grid">
          <div className="intraday-fno-stat">
            <span>Lot size</span>
            <strong>{Number(futures.lot_size)}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Suggested lots</span>
            <strong>{Number(futures.lots_suggested)}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Entry (index)</span>
            <strong>{fmtRs(Number(futures.entry_index))}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Stop (index)</span>
            <strong className="intraday-neg">{fmtRs(Number(futures.stop_index))}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Risk / lot</span>
            <strong className="intraday-neg">{fmtInr(Number(futures.risk_inr_per_lot))}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Margin est.</span>
            <strong>{fmtInr(Number(futures.margin_inr_total_est))}</strong>
          </div>
        </div>
        {targets.length > 0 && (
          <table className="data-table compact intraday-fno-targets">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Index</th>
                <th>Pts</th>
                <th>P&L est.</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={String(t.tier)}>
                  <td>{String(t.tier)}</td>
                  <td>{fmtRs(Number(t.index_level))}</td>
                  <td>{Number(t.points)}</td>
                  <td className="intraday-pos">{fmtInr(Number(t.pnl_inr_est))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ul className="intraday-fno-notes">
          {((futures.notes as string[]) ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (mode === 'options' && options) {
    const targets = (options.targets as Array<Record<string, unknown>>) ?? [];
    const greeks = (options.greeks_hint as Record<string, unknown>) ?? {};
    return (
      <div className="intraday-fno-block">
        <div className="intraday-fno-head">
          <h3>{String(options.symbol_label)}</h3>
          <span className={`intraday-bias-badge ${fno.bias}`}>{String(options.strategy_label)}</span>
        </div>
        <div className="intraday-fno-grid">
          <div className="intraday-fno-stat">
            <span>Strike</span>
            <strong>
              {Number(options.strike)} {String(options.strike_style)}
            </strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Type</span>
            <strong>{String(options.option_type)}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Premium est.</span>
            <strong>{fmtRs(Number(options.premium_entry_est))}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Premium stop</span>
            <strong className="intraday-neg">{fmtRs(Number(options.premium_stop_est))}</strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Lots</span>
            <strong>
              {Number(options.lots_suggested)} × {Number(options.lot_size)}
            </strong>
          </div>
          <div className="intraday-fno-stat">
            <span>Risk est.</span>
            <strong className="intraday-neg">{fmtInr(Number(options.risk_inr_total))}</strong>
          </div>
        </div>
        {targets.length > 0 && (
          <table className="data-table compact intraday-fno-targets">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Index ref</th>
                <th>Premium tgt</th>
                <th>Book</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={String(t.tier)}>
                  <td>{String(t.tier)}</td>
                  <td>{t.index_level != null ? fmtRs(Number(t.index_level)) : '—'}</td>
                  <td>{fmtRs(Number(t.premium_target_est))}</td>
                  <td>{Number(t.book_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted intraday-greeks-hint">
          Δ ~{Number(greeks.delta_est ?? 0.5)} · theta {String(greeks.theta_risk ?? '—')} ·{' '}
          {String(greeks.iv_note ?? '')}
        </p>
        <ul className="intraday-fno-notes">
          {((options.notes as string[]) ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

export function IntradayPresetTable({
  presets,
  activeInterval,
  recommended,
}: {
  presets: Array<Record<string, unknown>>;
  activeInterval: '5m' | '15m';
  recommended: string;
}) {
  if (!presets.length) return null;
  const passKey = activeInterval === '5m' ? 'pass_5m' : 'pass_15m';

  return (
    <div className="table-scroll">
      <table className="data-table compact intraday-preset-table">
        <thead>
          <tr>
            <th>Preset</th>
            <th>{activeInterval} pass</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {presets.map((p) => {
            const pass = Boolean(p[passKey]);
            const isRec = p.id === recommended;
            return (
              <tr key={String(p.id)} className={isRec ? 'intraday-preset-rec' : ''}>
                <td>
                  <strong>{String(p.label)}</strong>
                  {isRec ? <span className="intraday-rec-tag"> recommended</span> : null}
                </td>
                <td>
                  <span className={pass ? 'intraday-pass' : 'intraday-fail'}>{pass ? 'PASS' : '—'}</span>
                </td>
                <td className="muted">{String(p.description ?? '')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function IntradayProductTabs({
  mode,
  onChange,
}: {
  mode: ProductMode;
  onChange: (m: ProductMode) => void;
}) {
  const tabs: { id: ProductMode; label: string }[] = [
    { id: 'spot', label: 'Spot / Index' },
    { id: 'futures', label: 'Futures' },
    { id: 'options', label: 'Options' },
  ];
  return (
    <div className="intraday-product-tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={mode === t.id ? 'intraday-product-tab active' : 'intraday-product-tab'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function IntradayLedgerLink({
  instrumentId,
  plan,
}: {
  instrumentId: string;
  plan?: Record<string, unknown> | null;
}) {
  const params = new URLSearchParams({ instrument: instrumentId });
  const entry = (plan?.entry as Record<string, unknown> | undefined)?.price;
  const stop = (plan?.stop_loss as Record<string, unknown> | undefined)?.price;
  const exits = (plan?.exits as Array<Record<string, unknown>>) ?? [];
  if (entry != null) params.set('entry', String(entry));
  if (stop != null) params.set('stop', String(stop));
  if (exits[0]?.price != null) params.set('t1', String(exits[0].price));
  if (exits[1]?.price != null) params.set('t2', String(exits[1].price));
  if (exits[2]?.price != null) params.set('t3', String(exits[2].price));
  if (plan?.bias === 'short') params.set('side', 'short');
  if (plan?.interval) params.set('timeframe', String(plan.interval));

  return (
    <p className="muted">
      <Link to={`/intraday/positions?${params}`}>Log trade in intraday ledger →</Link>
    </p>
  );
}

export type { ProductMode };

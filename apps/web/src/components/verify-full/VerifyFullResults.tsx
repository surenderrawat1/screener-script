export interface VerifyFullResultData {
  stock_name: string;
  scorecard: {
    rows: { phase: number; title: string; score: number; max: number; critical_fail: boolean }[];
    total: number;
    max: number;
    percent: number;
    grade: string;
  };
  verdict: {
    action: string;
    color: string;
    summary: string;
    score: number;
    mos: number;
    grade: string;
    mos_zone: string;
  };
  metrics: {
    margin_of_safety: number;
    intrinsic_value: number;
    final_rating: string;
  };
  investment_ready: {
    ready: boolean;
    automatable_ready: boolean;
    manual_phases_pending: boolean;
    reasons: string[];
    checklist: Record<string, boolean>;
  };
  executive_summary: {
    headline: string;
    strengths: string[];
    risks: string[];
    next_steps: string[];
    conviction: string;
  };
  data_quality: {
    passed: boolean;
    pass_count: number;
    total_count: number;
    gates?: { id: string; label: string; pass: boolean | null; note: string }[];
  };
  critical_fails: { id: string; label: string; note: string }[];
  red_flag_scan: { count: number; quick_reject: boolean; flags?: string[] };
  position_size?: { conviction: string; mos: string; size: string };
}

function verdictBadgeClass(action: string, color?: string): string {
  const c = (color ?? action).toLowerCase();
  if (c.includes('green') || c.includes('buy') || c.includes('strong')) return 'badge badge-buy';
  if (c.includes('amber') || c.includes('hold') || c.includes('accumulate') || c.includes('yellow'))
    return 'badge badge-hold';
  return 'badge badge-expensive';
}

interface Props {
  result: VerifyFullResultData | null;
  running?: boolean;
  labels?: {
    title: string;
    score: string;
    ready: string;
    verdict: string;
    pending: string;
  };
}

export default function VerifyFullResults({ result, running, labels }: Props) {
  const L = {
    title: labels?.title ?? 'Results',
    score: labels?.score ?? 'Master score',
    ready: labels?.ready ?? 'Investment ready',
    verdict: labels?.verdict ?? 'Verdict',
    pending: labels?.pending ?? 'Pending',
  };

  if (running) {
    return (
      <aside className="verify-results card">
        <h2>{L.title}</h2>
        <p className="muted">Running verification engine…</p>
      </aside>
    );
  }

  if (!result) {
    return (
      <aside className="verify-results card">
        <h2>{L.title}</h2>
        <p className="muted">
          Complete manual gates (especially Phase 0, 7, and thesis), check attestation on Phase 8, then
          run verification.
        </p>
        <div className="verify-results-placeholder">
          <div className="verify-results-metric">
            <span className="lbl">{L.score}</span>
            <span className="val muted">— / 56</span>
          </div>
          <div className="verify-results-metric">
            <span className="lbl">{L.ready}</span>
            <span className="val muted">{L.pending}</span>
          </div>
          <div className="verify-results-metric">
            <span className="lbl">{L.verdict}</span>
            <span className="val muted">—</span>
          </div>
        </div>
      </aside>
    );
  }

  const { scorecard, verdict, investment_ready, executive_summary, data_quality } = result;
  const readyClass = investment_ready.ready ? 'verify-ready-yes' : 'verify-ready-no';
  const positionSize = result.position_size;
  const redFlags = result.red_flag_scan.flags ?? [];

  return (
    <aside className="verify-results card">
      <h2>{L.title}</h2>
      <p className="verify-results-stock muted">{result.stock_name}</p>

      <div className="verify-results-placeholder">
        <div className="verify-results-metric">
          <span className="lbl">{L.score}</span>
          <span className="val">
            <strong>{scorecard.total}</strong> / {scorecard.max}{' '}
            <span className="muted">({scorecard.grade})</span>
          </span>
        </div>
        <div className="verify-results-metric">
          <span className="lbl">MOS</span>
          <span className="val">
            {result.metrics.margin_of_safety.toFixed(1)}% · {verdict.mos_zone}
          </span>
        </div>
        <div className="verify-results-metric">
          <span className="lbl">{L.ready}</span>
          <span className={`val ${readyClass}`}>{investment_ready.ready ? 'Yes' : 'No'}</span>
        </div>
        <div className="verify-results-metric">
          <span className="lbl">{L.verdict}</span>
          <span className={verdictBadgeClass(verdict.action, verdict.color)}>{verdict.action}</span>
        </div>
        {positionSize ? (
          <div className="verify-results-metric">
            <span className="lbl">Position size</span>
            <span className="val">
              {positionSize.size} <span className="muted">({positionSize.conviction})</span>
            </span>
          </div>
        ) : null}
      </div>

      {investment_ready.reasons.length > 0 && (
        <div className="verify-ready-reasons">
          <h3>Investment-ready checklist</h3>
          <ul>
            {investment_ready.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="verify-scorecard">
        <h3>Scorecard</h3>
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.rows.map((row) => (
              <tr key={row.phase} className={row.critical_fail ? 'verify-row-critical' : undefined}>
                <td>
                  {row.phase}. {row.title}
                </td>
                <td>
                  {row.score}/{row.max}
                </td>
              </tr>
            ))}
            <tr className="verify-scorecard-total">
              <td>Total</td>
              <td>
                <strong>
                  {scorecard.total}/{scorecard.max}
                </strong>{' '}
                ({scorecard.percent.toFixed(0)}%)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {result.critical_fails.length > 0 && (
        <div className="verify-critical-fails">
          <h3>Critical fails</h3>
          <ul>
            {result.critical_fails.map((f) => (
              <li key={f.id}>
                <strong>{f.label}</strong> — {f.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="verify-exec-summary">
        <h3>Executive summary</h3>
        <p>{executive_summary.headline}</p>
        {executive_summary.strengths.length > 0 && (
          <>
            <h4>Strengths</h4>
            <ul>
              {executive_summary.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {executive_summary.risks.length > 0 && (
          <>
            <h4>Risks</h4>
            <ul>
              {executive_summary.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
        {executive_summary.next_steps.length > 0 && (
          <>
            <h4>Next steps</h4>
            <ul>
              {executive_summary.next_steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="verify-dq-summary">
        <h3>Data quality</h3>
        <p>
          {data_quality.passed ? (
            <span className="verify-ready-yes">D1–D7 passed</span>
          ) : (
            <span className="verify-ready-no">
              {data_quality.pass_count}/{data_quality.total_count} gates passed — review before
              investing
            </span>
          )}
        </p>
        {data_quality.gates && data_quality.gates.length > 0 ? (
          <ul className="verify-dq-gates">
            {data_quality.gates.map((g) => (
              <li key={g.id} className={g.pass ? 'verify-dq-pass' : 'verify-dq-fail'}>
                <strong>{g.id}</strong> {g.label} — {g.note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {redFlags.length > 0 && (
        <div className="verify-red-flags">
          <h3>Red flags ({result.red_flag_scan.count})</h3>
          <ul>
            {redFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {result.red_flag_scan.quick_reject ? <p className="verify-warning">Quick reject threshold</p> : null}
        </div>
      )}

      {result.red_flag_scan.count > 0 && redFlags.length === 0 && (
        <p className="verify-red-flags">
          {result.red_flag_scan.count} red flag(s)
          {result.red_flag_scan.quick_reject ? ' — quick reject' : ''}
        </p>
      )}

      <p className="disclaimer" style={{ marginTop: '1rem', marginBottom: 0 }}>
        {verdict.summary}
      </p>
    </aside>
  );
}

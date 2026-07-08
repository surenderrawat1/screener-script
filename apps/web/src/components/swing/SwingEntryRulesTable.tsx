export interface SwingRuleRow {
  id: string;
  name: string;
  criterion: string;
  passed: boolean | null;
  detail: string;
}

function statusLabel(passed: boolean | null): string {
  if (passed === true) return 'PASS';
  if (passed === false) return 'FAIL';
  return '—';
}

function statusClass(passed: boolean | null): string {
  if (passed === true) return 'swing-rule-pass';
  if (passed === false) return 'swing-rule-fail';
  return 'swing-rule-neutral';
}

export function SwingEntryRulesTable({ rules }: { rules: SwingRuleRow[] }) {
  if (!rules.length) return <p className="muted">Entry rules not available.</p>;

  return (
    <div className="table-scroll">
      <table className="data-table compact swing-rules-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Rule</th>
            <th>Criterion</th>
            <th>Status</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className={statusClass(r.passed)}>
              <td>
                <strong>{r.id}</strong>
              </td>
              <td>{r.name}</td>
              <td className="muted">{r.criterion}</td>
              <td>
                <span className={`swing-rule-pill ${statusClass(r.passed)}`}>{statusLabel(r.passed)}</span>
              </td>
              <td>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SwingVerdictBanner({
  discovery,
  strict,
  rulesPassed,
  entryScore,
}: {
  discovery: string;
  strict: string;
  rulesPassed: number;
  entryScore: number;
}) {
  return (
    <div className="swing-verdict-banner">
      <span className={`swing-verdict-pill discovery-${discovery.toLowerCase()}`}>Discovery {discovery}</span>
      <span className={`swing-verdict-pill strict-${strict.toLowerCase()}`}>Strict {strict}</span>
      <span className="swing-verdict-pill">Score {entryScore}</span>
      <span className="swing-verdict-pill">Rules {rulesPassed}/11</span>
    </div>
  );
}

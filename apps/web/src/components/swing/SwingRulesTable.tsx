export interface SwingRuleRow {
  id: string;
  name: string;
  criterion: string;
  passed: boolean | null;
  detail: string;
}

/** Mirrors @sv/swing entry-rule-tiers — keep in sync with v3.11-lite. */
const SOFT_ENTRY_IDS = new Set(['E9', 'E10', 'E11', 'E12']);

export function entryRuleTier(id: string): 'hard' | 'soft' {
  return SOFT_ENTRY_IDS.has(id) ? 'soft' : 'hard';
}

function statusLabel(passed: boolean | null): string {
  if (passed === true) return 'PASS';
  if (passed === false) return 'FAIL';
  return 'SOFT';
}

function statusClass(passed: boolean | null): string {
  if (passed === true) return 'swing-rule-pass';
  if (passed === false) return 'swing-rule-fail';
  return 'swing-rule-neutral';
}

function countHardSoft(rules: SwingRuleRow[]) {
  let hardPassed = 0;
  let hardTotal = 0;
  let softPassed = 0;
  let softTotal = 0;
  for (const r of rules) {
    if (entryRuleTier(r.id) === 'hard') {
      hardTotal += 1;
      if (r.passed === true) hardPassed += 1;
    } else {
      softTotal += 1;
      if (r.passed === true) softPassed += 1;
    }
  }
  return { hardPassed, hardTotal, softPassed, softTotal };
}

/** Presentational table for E1–E12 entry or X1–X9 exit rule rows. */
export function SwingRulesTable({
  rules,
  emptyLabel = 'Rules not available.',
  showTiers = false,
}: {
  rules: SwingRuleRow[];
  emptyLabel?: string;
  /** When true, show Hard/Soft tier column (entry rules). */
  showTiers?: boolean;
}) {
  if (!rules.length) return <p className="muted">{emptyLabel}</p>;

  return (
    <div className="table-scroll">
      <table className="data-table compact swing-rules-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Rule</th>
            {showTiers ? <th>Tier</th> : null}
            <th>Criterion</th>
            <th>Status</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const tier = entryRuleTier(r.id);
            return (
              <tr key={r.id} className={statusClass(r.passed)}>
                <td>
                  <strong>{r.id}</strong>
                </td>
                <td>{r.name}</td>
                {showTiers ? (
                  <td>
                    <span className={`swing-tier-pill swing-tier-${tier}`}>
                      {tier === 'hard' ? 'Hard' : 'Soft'}
                    </span>
                  </td>
                ) : null}
                <td className="muted">{r.criterion}</td>
                <td>
                  <span className={`swing-rule-pill ${statusClass(r.passed)}`}>{statusLabel(r.passed)}</span>
                </td>
                <td>{r.detail}</td>
              </tr>
            );
          })}
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
  rules,
  engineVersion,
}: {
  discovery: string;
  strict: string;
  rulesPassed: number;
  entryScore: number;
  rules?: SwingRuleRow[];
  engineVersion?: string;
}) {
  const hs = rules?.length ? countHardSoft(rules) : null;
  return (
    <div className="swing-verdict-banner">
      <span className={`swing-verdict-pill discovery-${discovery.toLowerCase()}`}>Discovery {discovery}</span>
      <span className={`swing-verdict-pill strict-${strict.toLowerCase()}`}>Strict {strict}</span>
      <span className="swing-verdict-pill">Score {entryScore}</span>
      {hs ? (
        <>
          <span className="swing-verdict-pill" title="Hard risk/structure rules (E1–E8)">
            Hard {hs.hardPassed}/{hs.hardTotal}
          </span>
          <span className="swing-verdict-pill muted" title="Soft catalysts / style (E9–E12)">
            Soft {hs.softPassed}/{hs.softTotal}
          </span>
        </>
      ) : (
        <span className="swing-verdict-pill">Rules {rulesPassed}/12</span>
      )}
      {engineVersion ? <span className="swing-verdict-pill muted">{engineVersion}</span> : null}
    </div>
  );
}

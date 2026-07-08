import type { SwingEngineMeta } from './types';

interface Props {
  engineMeta?: SwingEngineMeta;
  embedded?: boolean;
}

export function SwingExitRulesReference({ engineMeta, embedded = false }: Props) {
  const rules = engineMeta?.exit_rules ?? [];
  const summary = engineMeta?.exit_rules_summary;

  const body = (
    <>
      {embedded ? (
        <h4 className="swing-exit-ref-title">Exit rules (reference)</h4>
      ) : (
        <h2>Exit rules (reference)</h2>
      )}
      {!rules.length && !summary ? (
        <p className="muted">Exit rule definitions load with the evaluation response.</p>
      ) : (
        <>
          {summary ? <p className="swing-rules-ref">{summary}</p> : null}
          <ol className="swing-rules-ref-list">
            {rules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="swing-exit-ref swing-exit-ref-embedded">{body}</div>;
  }

  return <section className="card swing-exit-ref">{body}</section>;
}

import type { SwingEngineMeta, SwingEntryPayload } from './types';

interface Props {
  entry: SwingEntryPayload;
  engineMeta?: SwingEngineMeta;
}

export function SwingScoreBreakdown({ entry, engineMeta }: Props) {
  const detail = entry.entry_score_detail ?? {};
  if (!engineMeta?.score_categories?.length) {
    return (
      <section className="swing-subsection" aria-label="Score breakdown">
        <h3>Score breakdown</h3>
        <p className="muted">Score categories load with engine metadata.</p>
      </section>
    );
  }
  const categories = engineMeta.score_categories;

  return (
    <section className="swing-subsection" aria-label="Score breakdown">
      <h3>Score breakdown</h3>
      <p className="swing-subsection-hint muted">Weighted composite from E1–E11 rule outcomes and trade geometry.</p>
      <div className="swing-score-grid">
        {categories.map((cat) => {
          const value = Number(detail[cat.key] ?? 0);
          const pct = cat.max > 0 ? Math.round((value / cat.max) * 100) : 0;
          return (
            <div key={cat.key} className="swing-score-card">
              <div className="swing-score-card-head">
                <span>{cat.label}</span>
                <strong>
                  {value}/{cat.max}
                </strong>
              </div>
              <div className="swing-score-bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

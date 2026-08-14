import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EvidenceStrip } from './EvidenceStrip';

export interface StockMemoHeroProps {
  symbol: string;
  name: string;
  verdict: string;
  verdictClassName?: string;
  grade?: string;
  headline?: string;
  subline?: string;
  qualityScore?: number | null;
  verifyScore?: number | null;
  scoreLabel?: string;
  recommendationBasis?: string;
  scoreBasis?: string;
  dataQuality?: string;
  sources?: string[];
  fromCache?: boolean;
  actions?: ReactNode;
}

export interface StockMemoSection {
  title: string;
  items: string[];
}

/** CFA investment memo layout — hero, evidence, pillars, thesis, actions. */
export function StockMemoLayout({
  hero,
  pillars,
  investmentCase,
  strengths,
  risks,
  metrics,
  children,
}: {
  hero: StockMemoHeroProps;
  pillars?: Record<string, string>;
  investmentCase?: string;
  strengths?: string[];
  risks?: string[];
  metrics?: ReactNode;
  children?: ReactNode;
}) {
  const gradeClass = hero.grade ? `grade-${hero.grade.toLowerCase()}` : 'grade-c';

  return (
    <div className="card cfa-memo-card stock-memo-layout">
      <div className={`cfa-hero ${gradeClass}`}>
        <div className="cfa-grade">{hero.grade ?? '—'}</div>
        <div className="cfa-hero-body">
          <div className={`cfa-verdict ${hero.verdictClassName ?? ''}`}>{hero.verdict}</div>
          <h2 style={{ margin: '0.25rem 0' }}>
            <Link to={`/stock/${encodeURIComponent(hero.symbol)}`}>{hero.name}</Link>
            <small className="muted"> ({hero.symbol})</small>
          </h2>
          {hero.subline ? <p className="cfa-rating">{hero.subline}</p> : null}
          {hero.headline ? <p className="cfa-headline">{hero.headline}</p> : null}
          <EvidenceStrip
            recommendationBasis={hero.recommendationBasis}
            scoreBasis={hero.scoreBasis}
            dataQuality={hero.dataQuality}
            compact
          />
        </div>
        {hero.qualityScore != null ? (
          <div className="cfa-score-ring">
            <span className="num">{hero.qualityScore}</span>
            <span className="lbl">Quality</span>
            {hero.verifyScore != null ? (
              <span className="pct">
                {hero.verifyScore}/56 {hero.scoreLabel ?? 'proxy'}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {hero.sources && hero.sources.length > 0 ? (
        <p className="muted cfa-meta">
          Sources: {hero.sources.join(' · ')}
          {hero.fromCache ? ' (cached)' : ''}
        </p>
      ) : null}

      {hero.actions ? <div className="stock-memo-actions">{hero.actions}</div> : null}

      {metrics ? <div className="stock-memo-metrics">{metrics}</div> : null}

      {pillars && Object.keys(pillars).length > 0 ? (
        <div className="cfa-memo-section">
          <h3>Quality pillars</h3>
          <div className="cfa-pillars">
            {Object.entries(pillars).map(([name, score]) => (
              <span key={name} className="cfa-pillar-chip">
                {name}: {score}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {investmentCase ? (
        <div className="cfa-memo-section">
          <h3>Investment case</h3>
          <p>{investmentCase}</p>
        </div>
      ) : null}

      {(strengths?.length || risks?.length) ? (
        <div className="cfa-memo-columns">
          {strengths && strengths.length > 0 ? (
            <div className="cfa-memo-section">
              <h3>Strengths</h3>
              <ul>
                {strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {risks && risks.length > 0 ? (
            <div className="cfa-memo-section">
              <h3>Risks</h3>
              <ul>
                {risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}

/** Build screening memo bullets from fundamentals when Full Verify memo is unavailable. */
export function buildScreeningThesis(input: {
  recommendation: string;
  zone: string;
  mos: number | null;
  roe?: number;
  roce?: number;
  pe?: number;
  moatTier?: string;
  taCrossEma20?: boolean;
  taPct52w?: number | null;
}): { investmentCase: string; strengths: string[]; risks: string[]; pillars: Record<string, string> } {
  const strengths: string[] = [];
  const risks: string[] = [];

  if (input.roe != null && input.roe >= 15) strengths.push(`ROE ${input.roe}% — above quality compounder floor`);
  else if (input.roe != null && input.roe < 12) risks.push(`ROE ${input.roe}% — below preferred quality band`);

  if (input.roce != null && input.roce >= 18) strengths.push(`ROCE ${input.roce}% — capital efficiency solid`);
  if (input.mos != null && input.mos >= 15) strengths.push(`MOS ${input.mos}% — meaningful margin of safety`);
  else if (input.mos != null && input.mos < 0) risks.push(`Negative MOS — trading above intrinsic estimate`);

  if (input.pe != null && input.pe > 40) risks.push(`P/E ${input.pe}× — elevated vs value screens`);
  if (input.moatTier && input.moatTier !== 'none') strengths.push(`Moat tier: ${input.moatTier}`);

  if (input.taCrossEma20) strengths.push('Fresh daily cross above EMA-20 — momentum setup');
  if (input.taPct52w != null && input.taPct52w >= 85) risks.push(`52w position ${input.taPct52w}% — extended vs range`);

  const investmentCase = `${input.recommendation} · ${input.zone}. Screening view only — confirm thesis with Full Verify before allocating.`;

  const pillars: Record<string, string> = {};
  if (input.roe != null) pillars['ROE'] = `${input.roe}%`;
  if (input.roce != null) pillars['ROCE'] = `${input.roce}%`;
  if (input.mos != null) pillars['MOS'] = `${input.mos}%`;
  if (input.pe != null) pillars['P/E'] = `${input.pe}×`;

  return { investmentCase, strengths, risks, pillars };
}

function gradeFromVerdict(verdict: string): string {
  const v = verdict.toLowerCase();
  if (v.includes('strong buy')) return 'A';
  if (v.includes('buy') || v.includes('accumulate')) return 'B';
  if (v.includes('hold')) return 'C';
  if (v.includes('avoid') || v.includes('sell')) return 'D';
  return 'C';
}

export { gradeFromVerdict };

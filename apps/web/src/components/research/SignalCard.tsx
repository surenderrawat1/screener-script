import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtPct } from '../../lib/screener-export';
import { EvidenceStrip, type EconStatus } from './EvidenceStrip';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export interface SignalCardProps {
  symbol: string;
  name?: string;
  verdict?: string;
  verdictClassName?: string;
  subtitle?: string;
  mos?: number | null;
  price?: number | null;
  qualityScore?: number | null;
  decisionLabel?: string;
  decisionScore?: number | null;
  zone?: string;
  recommendationBasis?: string;
  scoreBasis?: string;
  dataQuality?: string;
  econStatus?: EconStatus;
  highConviction?: boolean;
  backtestLabel?: string;
  variant?: 'inline' | 'card';
  href?: string;
  actions?: ReactNode;
}

/** Unified research signal — screener, swing, morning HC. */
export function SignalCard({
  symbol,
  name,
  verdict,
  verdictClassName,
  subtitle,
  mos,
  price,
  qualityScore,
  decisionLabel,
  decisionScore,
  zone,
  recommendationBasis,
  scoreBasis,
  dataQuality,
  econStatus,
  highConviction,
  backtestLabel,
  variant = 'inline',
  href,
  actions,
}: SignalCardProps) {
  const symbolHref = href ?? `/stock/${encodeURIComponent(symbol)}`;
  const metrics: string[] = [];
  if (price != null && Number.isFinite(price)) metrics.push(fmtMoney(price));
  if (mos != null) metrics.push(`MOS ${fmtPct(mos)}`);
  if (zone) metrics.push(zone);
  if (qualityScore != null) metrics.push(`Q ${qualityScore}`);
  if (decisionScore != null) metrics.push(`D ${decisionScore}`);
  if (backtestLabel) metrics.push(backtestLabel);

  if (variant === 'card') {
    return (
      <article className="signal-card signal-card-block">
        <div className="signal-card-head">
          <div>
            <Link to={symbolHref} className="signal-card-symbol">
              <strong>{symbol}</strong>
            </Link>
            {name ? <span className="muted signal-card-name">{name}</span> : null}
            {highConviction ? <span className="signal-card-hc">HC</span> : null}
          </div>
          {verdict ? <span className={verdictClassName ?? 'badge'}>{verdict}</span> : null}
        </div>
        {(subtitle || decisionLabel) && (
          <p className="signal-card-sub muted">{decisionLabel || subtitle}</p>
        )}
        {metrics.length > 0 ? <p className="signal-card-metrics">{metrics.join(' · ')}</p> : null}
        <EvidenceStrip
          recommendationBasis={recommendationBasis}
          scoreBasis={scoreBasis}
          dataQuality={dataQuality}
          econStatus={econStatus}
          compact
        />
        {actions ? <div className="signal-card-actions">{actions}</div> : null}
      </article>
    );
  }

  return (
    <div className="signal-card signal-card-inline">
      <Link to={symbolHref} className="signal-card-symbol">
        <strong>{symbol}</strong>
      </Link>
      {highConviction ? <span className="signal-card-hc">HC</span> : null}
      {verdict ? (
        <span className={`signal-card-verdict ${verdictClassName ?? ''}`}>{verdict}</span>
      ) : null}
      {metrics.length > 0 ? <span className="signal-card-metrics muted">{metrics.join(' · ')}</span> : null}
      {(subtitle || decisionLabel) && (
        <span className="signal-card-sub muted">{decisionLabel || subtitle}</span>
      )}
      <EvidenceStrip
        recommendationBasis={recommendationBasis}
        scoreBasis={scoreBasis}
        dataQuality={dataQuality}
        econStatus={econStatus}
        compact
      />
      {actions ? <div className="signal-card-actions">{actions}</div> : null}
    </div>
  );
}

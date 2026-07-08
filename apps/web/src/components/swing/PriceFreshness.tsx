/** Price freshness badge — parity with PHP `PriceFreshness.renderBadge()`. */

export interface PriceFreshnessInput {
  live?: boolean;
  stale?: boolean;
  quote_time?: string;
  as_of_date?: string;
  as_of?: string;
  stale_reason?: string;
  data_source?: string;
}

function escTitle(s: string): string {
  return s;
}

export function priceFreshnessMeta(row: PriceFreshnessInput, sessionLive = false) {
  const stale = Boolean(row.stale);
  const asOfDate = row.as_of_date || row.as_of || '';
  const quoteTime = row.quote_time || '';
  const ds = String(row.data_source || '');
  const isIntraday = ds.startsWith('yahoo_intraday_');

  if (stale) {
    return {
      mode: 'stale' as const,
      label: 'Stale',
      detail: row.stale_reason || 'Stale chart',
      title: row.stale_reason || 'Stale chart — refresh daily closes.',
    };
  }

  if (isIntraday) {
    if (row.live) {
      const detail = asOfDate || quoteTime || 'now';
      return {
        mode: 'last_bar' as const,
        label: row.live ? 'Live' : 'Last bar',
        detail,
        title: `Yahoo intraday bar · ${detail}`,
      };
    }
    const detail = asOfDate || quoteTime || 'session';
    return {
      mode: 'last_bar' as const,
      label: 'Last bar',
      detail,
      title: `Last intraday bar · ${detail}`,
    };
  }

  if (row.live && sessionLive) {
    const detail = quoteTime || 'now';
    return {
      mode: 'live' as const,
      label: 'Live',
      detail,
      title: `Yahoo live quote · ${detail}${asOfDate ? ` · EOD ${asOfDate}` : ''}`,
    };
  }

  const detail = asOfDate ? `close ${asOfDate}` : quoteTime;
  return {
    mode: 'close' as const,
    label: 'EOD',
    detail,
    title: `Yahoo daily close${asOfDate ? ` · close ${asOfDate}` : ''}`,
  };
}

export function PriceFreshness({
  row,
  sessionLive = false,
}: {
  row: PriceFreshnessInput;
  sessionLive?: boolean;
}) {
  const meta = priceFreshnessMeta(row, sessionLive);
  return (
    <>
      <span className={`pf-badge pf-${meta.mode}`} title={escTitle(meta.title)}>
        {meta.label}
      </span>
      {meta.detail ? (
        <span className="pf-detail" title={escTitle(meta.title)}>
          {meta.detail}
        </span>
      ) : null}
    </>
  );
}

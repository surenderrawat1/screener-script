import { useEffect, useRef } from 'react';
import { PriceFreshness } from './PriceFreshness';

function fmtRs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PositionPriceCell({
  price,
  ok,
  error,
  live,
  stale,
  asOfDate,
  quoteTime,
  dataSource,
  staleReason,
  sessionLive,
}: {
  price: number | null;
  ok: boolean;
  error?: string;
  live?: boolean;
  stale?: boolean;
  asOfDate?: string;
  quoteTime?: string;
  dataSource?: string;
  staleReason?: string;
  sessionLive: boolean;
}) {
  const prevPrice = useRef<number | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (price == null || !ok) return;
    if (prevPrice.current != null && prevPrice.current !== price && cellRef.current) {
      cellRef.current.classList.remove('swing-price-flash');
      void cellRef.current.offsetWidth;
      cellRef.current.classList.add('swing-price-flash');
      const t = window.setTimeout(() => cellRef.current?.classList.remove('swing-price-flash'), 650);
      prevPrice.current = price;
      return () => window.clearTimeout(t);
    }
    prevPrice.current = price;
  }, [price, ok]);

  return (
    <td ref={cellRef} className="swing-uni-price">
      {ok && price != null ? (
        <>
          {fmtRs(price)}
          <br />
          <PriceFreshness
            row={{
              live,
              stale,
              as_of_date: asOfDate,
              quote_time: quoteTime,
              data_source: dataSource,
              stale_reason: staleReason,
            }}
            sessionLive={sessionLive}
          />
        </>
      ) : (
        <span className="swing-pnl-neg">{error || 'No data'}</span>
      )}
    </td>
  );
}

export function sourceBadgeLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source === 'manual') return 'Manual';
  if (source === 'auto_radar' || source === 'swing_auto') return 'Swing Auto';
  if (source === 'php_import') return 'Legacy';
  if (source.includes('etf')) return 'ETF';
  if (source.includes('universe')) return 'Universe';
  if (source.includes('symbol')) return 'Symbol scan';
  return source.replace(/_/g, ' ');
}

export function sourceBadgeClass(source: string | null | undefined): string {
  if (!source || source === 'manual') return 'swing-src-manual';
  if (source === 'auto_radar' || source === 'swing_auto') return 'swing-src-auto';
  if (source.includes('etf')) return 'swing-src-etf';
  if (source.includes('universe') || source.includes('symbol')) return 'swing-src-scan';
  if (source === 'php_import') return 'swing-src-legacy';
  return 'swing-src-other';
}

import type { ReactNode } from 'react';
import { fmtNum, fmtPct, type ScreenerRow } from '../../lib/screener-export';

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `₹${fmtNum(n, 2)}`;
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="screener-detail-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function ScreenerRowDetail({ row }: { row: ScreenerRow }) {
  const scoreBasis =
    row.score_basis === 'full_scorecard' ? 'Full scorecard' : 'Engine quality proxy';
  const zLabel = row.altman_skip
    ? 'Skipped'
    : row.z_score_source === 'unreliable' && row.altman_z
      ? `${fmtNum(row.altman_z, 2)} · Unreliable`
      : row.altman_z && row.altman_z > 0
        ? `${fmtNum(row.altman_z, 2)}${row.altman_zone ? ` · ${row.altman_zone}` : ''}`
        : '—';

  return (
    <div className="screener-detail-inner">
      <DetailItem label="Quality score">
        {row.composite_score}/100 <small className="muted">({scoreBasis})</small>
      </DetailItem>
      <DetailItem label="Verify pts">{row.verify_score != null ? `${row.verify_score}/56` : '—'}</DetailItem>
      <DetailItem label="DCF">{money(row.dcf_value)}</DetailItem>
      <DetailItem label="P/E intrinsic">{money(row.pe_intrinsic)}</DetailItem>
      <DetailItem label="Intrinsic">{money(row.intrinsic)}</DetailItem>
      {row.parity_from_cache && row.verify_iv ? (
        <DetailItem label="Verify IV (cache)">
          {money(row.verify_iv)}
          {row.iv_delta_pct != null ? (
            <small className={row.iv_drift_warn ? 'neg' : 'muted'}> Δ {fmtNum(row.iv_delta_pct, 1)}%</small>
          ) : null}
        </DetailItem>
      ) : null}
      <DetailItem label="Graham">
        {money(row.graham)}
        <small className="muted"> {row.graham_credible ? 'credible' : 'N/A'}</small>
      </DetailItem>
      <DetailItem label="Graham MOS">{row.graham_mos != null ? fmtPct(row.graham_mos) : '—'}</DetailItem>
      <DetailItem label="Z-Score">{zLabel}</DetailItem>
      <DetailItem label="Sector">{row.sector_key ?? 'general'}</DetailItem>
      <DetailItem label="Model">{row.method || '—'}</DetailItem>
      <DetailItem label="Rating">{row.final_rating || row.recommendation || '—'}</DetailItem>
      <DetailItem label="MOS">{fmtPct(row.mos)}</DetailItem>
      <DetailItem label="Fair P/E">{row.fair_pe > 0 ? fmtNum(row.fair_pe, 1) : '—'}</DetailItem>
      <DetailItem label="Promoter %">
        {row.promoter_holding != null && row.promoter_holding > 0 ? fmtPct(row.promoter_holding) : '—'}
        {row.promoter_holding_change_pp != null ? (
          <small className={row.promoter_holding_trend === 'declining' ? 'neg' : 'muted'}>
            {' '}
            · {row.promoter_holding_change_pp >= 0 ? '+' : ''}
            {fmtNum(row.promoter_holding_change_pp, 2)} pp QoQ
          </small>
        ) : null}
      </DetailItem>
      <DetailItem label="Promoter pledge">
        {row.promoter_pledge != null ? (
          <>
            {fmtPct(row.promoter_pledge)}
            {row.promoter_pledge > 25 ? <small className="neg"> · critical</small> : null}
            {row.promoter_pledge_as_of ? (
              <small className="muted"> · {row.promoter_pledge_as_of}</small>
            ) : null}
          </>
        ) : (
          '—'
        )}
      </DetailItem>
      <DetailItem label="Market cap">
        {row.market_cap_cr != null && row.market_cap_cr > 0 ? `${fmtNum(row.market_cap_cr, 0)} Cr` : '—'}
      </DetailItem>
      <DetailItem label="Sales YoY">{row.sales_yoy != null ? fmtPct(row.sales_yoy) : '—'}</DetailItem>
      <DetailItem label="Div yield">{row.div_yield != null && row.div_yield > 0 ? fmtPct(row.div_yield) : '—'}</DetailItem>
      <DetailItem label="Moat">
        {row.moat_tier || '—'}
        {row.moat_count ? <small className="muted"> · {row.moat_count} signals</small> : null}
      </DetailItem>
      {row.ta_ready ? (
        <>
          <DetailItem label="RSI-14">{row.ta_rsi14 != null ? fmtNum(row.ta_rsi14, 1) : '—'}</DetailItem>
          <DetailItem label="52w range">
            {row.ta_pct_52w != null ? `${fmtNum(row.ta_pct_52w, 0)}%` : '—'}
            {row.ta_52w_chart_zone ? <small className="muted"> · {row.ta_52w_chart_zone}</small> : null}
          </DetailItem>
          <DetailItem label="MACD hist">{row.ta_macd_hist != null ? fmtNum(row.ta_macd_hist, 3) : '—'}</DetailItem>
          <DetailItem label="BB %B">{row.ta_bb_pct_b != null ? `${fmtNum(row.ta_bb_pct_b, 1)}%` : '—'}</DetailItem>
          <DetailItem label="Bottom-out">
            {row.ta_bottom_out_hint ? 'Yes' : '—'}
            {row.ta_bottom_out_score != null ? ` · ${row.ta_bottom_out_score}/5` : ''}
          </DetailItem>
        </>
      ) : null}
      {row.screener_warnings && row.screener_warnings.length > 0 ? (
        <div className="screener-detail-warnings">
          <span>Screener flags</span>
          <ul className="screener-insights-list">
            {row.screener_warnings.slice(0, 4).map((w) => (
              <li
                key={`${w.label}-${w.text.slice(0, 40)}`}
                className={`screener-insight screener-insight-${w.severity}`}
              >
                <span className="screener-insight-label">{w.label}</span>
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

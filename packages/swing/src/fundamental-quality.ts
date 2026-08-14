/** CFA quality floor for swing live / HC — ROE & ROCE both ≥ 15% (ROE-only for banks/NBFCs/insurance). */

import { lookupSectorHint } from '@sv/shared';

export const MIN_ROE_PCT = 15;
export const MIN_ROCE_PCT = 15;

/** Sectors where ROCE is not a meaningful capital-efficiency screen (deposit/leverage businesses). */
export const FINANCIAL_QUALITY_SECTORS = ['banking', 'nbfc', 'insurance'] as const;

export type FundamentalQualityStatus = 'pass' | 'fail' | 'unknown';

export interface FundamentalQualityInput {
  roe?: number | null;
  roce?: number | null;
  sector?: string | null;
  industry?: string | null;
  symbol?: string | null;
}

export interface FundamentalQualityResult {
  ok: boolean;
  status: FundamentalQualityStatus;
  roe: number;
  roce: number;
  roe_ok: boolean;
  roce_ok: boolean;
  roce_waived: boolean;
  financial_sector: boolean;
  min_roe_pct: number;
  min_roce_pct: number;
  summary: string;
  risk_flags: string[];
}

/** Align with CFA sector routing: banking / NBFC / insurance skip ROCE floor. */
export function isFinancialQualitySector(
  sector?: string | null,
  industry?: string | null,
  symbol?: string | null,
): boolean {
  const hint = symbol ? lookupSectorHint(String(symbol)) : undefined;
  if (hint && (FINANCIAL_QUALITY_SECTORS as readonly string[]).includes(hint)) return true;

  const s = `${sector ?? ''} ${industry ?? ''}`.toLowerCase().trim();
  if (!s) return false;
  if (s.includes('nbfc') || s.includes('non-bank') || s.includes('housing finance')) return true;
  if (s.includes('insurance') || s.includes('life ins') || s.includes('insurer')) return true;
  if (s.includes('bank')) return true;
  if (s.includes('finance') || s.includes('financial')) return true;
  return FINANCIAL_QUALITY_SECTORS.some((k) => s === k || s.includes(k));
}

export function fundamentalQuality(metrics?: FundamentalQualityInput | null): FundamentalQualityResult {
  const roe = Number(metrics?.roe ?? 0);
  const roce = Number(metrics?.roce ?? 0);
  const financial = isFinancialQualitySector(metrics?.sector, metrics?.industry, metrics?.symbol);
  const hasRoe = Number.isFinite(roe) && roe > 0;
  const hasRoce = Number.isFinite(roce) && roce > 0;
  const roeOk = hasRoe && roe >= MIN_ROE_PCT;
  const roceWaived = financial;
  const roceOk = roceWaived || (hasRoce && roce >= MIN_ROCE_PCT);
  const flags: string[] = [];

  if (!hasRoe || (!roceWaived && !hasRoce)) {
    flags.push('QUALITY_UNKNOWN');
    return {
      ok: false,
      status: 'unknown',
      roe: hasRoe ? Math.round(roe * 10) / 10 : 0,
      roce: hasRoce ? Math.round(roce * 10) / 10 : 0,
      roe_ok: roeOk,
      roce_ok: roceOk,
      roce_waived: roceWaived,
      financial_sector: financial,
      min_roe_pct: MIN_ROE_PCT,
      min_roce_pct: MIN_ROCE_PCT,
      summary: roceWaived
        ? `ROE unknown — banks/NBFCs need ROE ≥ ${MIN_ROE_PCT}% (ROCE waived)`
        : `ROE/ROCE unknown — need both ≥ ${MIN_ROE_PCT}%`,
      risk_flags: flags,
    };
  }

  if (!roeOk) flags.push('LOW_ROE');
  if (!roceWaived && !roceOk) flags.push('LOW_ROCE');
  if (!roeOk || !roceOk) flags.push('QUALITY_FAIL');

  const ok = roeOk && roceOk;
  const roceBit = hasRoce ? `${roce.toFixed(1)}%` : 'n/a';
  return {
    ok,
    status: ok ? 'pass' : 'fail',
    roe: Math.round(roe * 10) / 10,
    roce: hasRoce ? Math.round(roce * 10) / 10 : 0,
    roe_ok: roeOk,
    roce_ok: roceOk,
    roce_waived: roceWaived,
    financial_sector: financial,
    min_roe_pct: MIN_ROE_PCT,
    min_roce_pct: MIN_ROCE_PCT,
    summary: ok
      ? roceWaived
        ? `ROE ${roe.toFixed(1)}% (≥${MIN_ROE_PCT}%) · ROCE waived (financial)`
        : `ROE ${roe.toFixed(1)}% · ROCE ${roceBit} (≥${MIN_ROE_PCT}%)`
      : roceWaived
        ? `ROE ${roe.toFixed(1)}% — banks/NBFCs need ROE ≥ ${MIN_ROE_PCT}% (ROCE waived)`
        : `ROE ${roe.toFixed(1)}% / ROCE ${roceBit} — need both ≥ ${MIN_ROE_PCT}%`,
    risk_flags: flags,
  };
}

/** Attach quality fields onto a swing hit (mutates copy). */
export function applyFundamentalQuality(
  hit: Record<string, unknown>,
  metrics?: FundamentalQualityInput | null,
): Record<string, unknown> {
  const hasExplicit =
    metrics != null ||
    hit.roe != null ||
    hit.roce != null ||
    hit.fundamental_quality_ok != null;

  // Leave pre-enrich / unit-test hits unchanged until fundamentals are attached.
  if (!hasExplicit) return hit;

  const symbol = String(metrics?.symbol ?? hit.symbol ?? '');
  const q = fundamentalQuality({
    roe: (metrics?.roe ?? hit.roe) as number | undefined,
    roce: (metrics?.roce ?? hit.roce) as number | undefined,
    sector: (metrics?.sector ?? hit.sector) as string | undefined,
    industry: (metrics?.industry ?? hit.industry) as string | undefined,
    symbol,
  });

  const out: Record<string, unknown> = {
    ...hit,
    roe: q.roe,
    roce: q.roce,
    sector: metrics?.sector ?? hit.sector ?? lookupSectorHint(symbol) ?? null,
    industry: metrics?.industry ?? hit.industry ?? null,
    fundamental_quality_ok: q.ok,
    fundamental_quality_status: q.status,
    fundamental_quality_summary: q.summary,
    fundamental_roce_waived: q.roce_waived,
    fundamental_financial_sector: q.financial_sector,
  };

  // Demote strict ENTER when quality fails or is unknown — keep discovery for research.
  if (!q.ok && String(out.strict_verdict ?? '') === 'ENTER') {
    out.strict_verdict = 'WATCH';
    out.strict_enter_ready = false;
  }

  const flags = Array.isArray(out.risk_flags) ? [...(out.risk_flags as string[])] : [];
  for (const f of q.risk_flags) {
    if (!flags.includes(f)) flags.push(f);
  }
  out.risk_flags = flags;
  return out;
}

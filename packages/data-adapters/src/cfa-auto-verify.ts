import {
  applyCfaScreeningDefaults,
  buildInvestmentMemo,
  CFA_SCREENING_ASSUMPTIONS,
  runVerificationEngine,
  type InvestmentMemo,
  type VerificationResult,
} from '@sv/core';
import type { StockMetrics } from '@sv/shared';
import { lookupSectorHint } from '@sv/shared';
import { CACHE_PREFIX, getCacheTtl } from '@sv/shared';
import { cacheGetJson, cacheKey, cacheSetJson } from '@sv/cache';
import type { VerifierFetchBlob } from './verifier-autofill.js';
import { fetchVerifierData } from './verifier-fetch.js';

export interface CfaVerifyAnalysis {
  intrinsic: number;
  mos: number | null;
  zone: string;
  action: string;
  fair_pe: number;
  method: string;
  graham: number;
  graham_credible?: boolean;
  graham_label?: string;
  altman_z?: number;
  z_score_source?: string;
  eps?: number;
  quality_score: number;
  dcf_value?: number;
  final_rating: string;
  recommendation: string;
  verify_score: number;
  composite_score: number;
  cfa_report: Record<string, unknown>;
  verdict: VerificationResult['verdict'];
  scorecard: VerificationResult['scorecard'];
  investment_ready: VerificationResult['investment_ready'];
}

export interface CfaVerifyResult {
  symbol: string;
  success: boolean;
  company_name?: string;
  metrics: StockMetrics;
  analysis: CfaVerifyAnalysis;
  memo: InvestmentMemo;
  assumptions: string[];
  screening_mode: boolean;
  sources: string[];
  from_cache?: boolean;
}

interface VerifyCachePayload {
  result: CfaVerifyResult;
  cached_at: string;
}

function sectorHintsForSymbol(symbol: string): Record<string, string> {
  const hint = lookupSectorHint(symbol);
  return hint ? { [symbol]: hint } : {};
}

function blobToStockMetrics(blob: VerifierFetchBlob): StockMetrics {
  return {
    symbol: blob.symbol.replace(/\.(NS|BO)$/i, ''),
    name: blob.company_name,
    price: blob.current_price,
    pe: blob.pe_ratio,
    eps: blob.eps,
    book_value: blob.book_value,
    pb_ratio: blob.pb_ratio,
    peg_ratio: blob.peg,
    roe: blob.roe,
    roa: blob.roa,
    roce: blob.roce,
    sales_yoy: blob.revenue_growth,
    profit_yoy: blob.eps_growth,
    eps_growth: blob.eps_growth,
    revenue_growth: blob.revenue_growth,
    sector: blob.sector,
    industry: blob.industry,
    market_cap_cr: blob.market_cap_cr,
    debt_to_equity: blob.debt_to_equity,
    div_yield: blob.dividend_yield,
    fcf_cr: blob.fcf_cr,
    cfo_cr: blob.cfo_cr,
    capex_cr: blob.capex_cr,
    high_52w: blob['52w_high'],
    low_52w: blob['52w_low'],
    gross_margin: blob.gross_margin,
    ebitda_margin: blob.ebitda_margin,
    interest_coverage: blob.interest_coverage,
    total_debt_cr: blob.total_debt_cr,
  };
}

function buildAnalysis(
  result: VerificationResult,
  memo: InvestmentMemo,
): CfaVerifyAnalysis {
  const m = result.metrics;
  return {
    intrinsic: m.intrinsic_value ?? 0,
    mos: m.margin_of_safety ?? null,
    zone: m.mos_zone ?? m.final_rating ?? '',
    action: result.verdict.action,
    fair_pe: m.fair_pe ?? 0,
    method: m.valuation_model ?? m.mos_method ?? 'DCF + Fair P/E',
    graham: m.graham_number ?? 0,
    graham_credible: m.graham_credible,
    graham_label: m.graham_label,
    altman_z: m.altman_z,
    z_score_source: m.z_score_source,
    eps: m.eps,
    quality_score: m.quality_score ?? 0,
    dcf_value: m.dcf_value,
    final_rating: m.final_rating ?? memo.rating,
    recommendation: result.verdict.action,
    verify_score: result.scorecard.total,
    composite_score: m.quality_score ?? 0,
    cfa_report: {
      business_summary: m.business_summary,
      sector: m.sector_label,
      sector_key: m.sector_key,
      valuation_model: m.valuation_model,
      quality_score: m.quality_score,
      quality_breakdown: m.quality_breakdown,
      fair_pe: m.fair_pe,
      dcf_value: m.dcf_value,
      intrinsic: m.intrinsic_value,
      mos: m.margin_of_safety,
      final_rating: m.final_rating,
      method: m.valuation_model,
      graham: m.graham_number,
      graham_credible: m.graham_credible,
      valuation_flags: m.valuation_flags,
      moat_tier: m.moat_strength,
    },
    verdict: result.verdict,
    scorecard: result.scorecard,
    investment_ready: result.investment_ready,
  };
}

export async function runCfaAutoVerify(symbol: string, refresh = false): Promise<CfaVerifyResult> {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!baseSymbol) {
    throw new Error('Empty symbol');
  }

  const verifyKey = cacheKey(CACHE_PREFIX.VERIFY, baseSymbol);
  if (!refresh) {
    const cached = await cacheGetJson<VerifyCachePayload>(verifyKey);
    if (cached?.result?.success) {
      return { ...cached.result, from_cache: true };
    }
  }

  const fetched = await fetchVerifierData(baseSymbol, refresh);
  if (!fetched.success || !fetched.auto || !fetched.blob) {
    throw new Error(fetched.error ?? `Could not fetch data for ${baseSymbol}`);
  }

  const blob = fetched.blob;
  const input = applyCfaScreeningDefaults(fetched.auto.input, {
    sector: blob.sector,
    market_cap_cr: blob.market_cap_cr,
    revenue_growth: blob.revenue_growth,
    roe: blob.roe,
    summary: blob.summary,
    current_price: blob.current_price,
    gross_margin: blob.gross_margin,
    roa: blob.roa,
  });

  const hints = { ...sectorHintsForSymbol(baseSymbol) };
  if (blob.sector && blob.sector !== 'general') {
    hints[baseSymbol] = blob.sector;
  }

  const result = runVerificationEngine(input, {
    sectorHints: hints,
    screening_mode: true,
    cacheMeta: { created_at: Math.floor(Date.now() / 1000) },
  });

  const memo = buildInvestmentMemo(result, blob, input);
  const metrics = blobToStockMetrics(blob);
  const analysis = buildAnalysis(result, memo);

  const payload: CfaVerifyResult = {
    symbol: baseSymbol,
    success: true,
    company_name: blob.company_name,
    metrics,
    analysis,
    memo,
    assumptions: [...CFA_SCREENING_ASSUMPTIONS],
    screening_mode: true,
    sources: fetched.sources,
    from_cache: fetched.from_cache,
  };

  await cacheSetJson(
    verifyKey,
    { result: payload, cached_at: new Date().toISOString() } satisfies VerifyCachePayload,
    getCacheTtl().verify,
  ).catch(() => undefined);

  return payload;
}

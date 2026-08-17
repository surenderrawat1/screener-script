import { cacheGetJson, cacheKey } from '@sv/cache';
import type { ScreenerRow } from '@sv/shared';
import { CACHE_PREFIX } from '@sv/shared';

import type { CfaVerifyResult } from './cfa-auto-verify.js';
import { ivDriftHint } from './live-parity.js';

interface VerifyCachePayload {
  result?: CfaVerifyResult;
}

export interface ScreenerParityFields {
  verify_iv?: number;
  iv_delta_pct?: number;
  iv_drift_warn?: boolean;
  parity_from_cache?: boolean;
  verify_decision?: string;
  verify_cached?: boolean;
}

/** Overlay sv:verify cache + IV drift — PHP NseStockScreener::attachParityHint parity. */
export async function attachScreenerParityHint(
  row: ScreenerRow,
  symbol: string,
): Promise<ScreenerRow & ScreenerParityFields> {
  const baseSymbol = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  if (!baseSymbol) return row;

  const cached = await cacheGetJson<VerifyCachePayload>(cacheKey(CACHE_PREFIX.VERIFY, baseSymbol));
  const verify = cached?.result;
  if (!verify?.success) return row;

  const analysis = verify.analysis;
  const merged: ScreenerRow & ScreenerParityFields = { ...row };

  const verifyScore = analysis?.verify_score;
  if (typeof verifyScore === 'number' && verifyScore > 0) {
    merged.verify_score = verifyScore;
  }

  const decision = analysis?.recommendation ?? analysis?.action;
  if (decision) {
    merged.verify_decision = decision;
    merged.verify_cached = true;
  }

  const screenerIv = Number(row.intrinsic ?? 0);
  const verifyIv = Number(analysis?.intrinsic ?? 0);
  if (screenerIv > 0 && verifyIv > 0) {
    const hint = ivDriftHint(screenerIv, verifyIv);
    if (hint) {
      merged.verify_iv = hint.full_iv;
      merged.iv_delta_pct = hint.drift_pct;
      merged.iv_drift_warn = hint.iv_drift_warn;
      merged.parity_from_cache = true;
    }
  }

  return merged;
}

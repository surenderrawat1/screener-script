/** PHP CfaAutoVerifier::cachedPriceStale — >1% live vs cached verify price → invalidate. */

export const VERIFY_PRICE_STALE_PCT = 1;

export function verifyPriceDriftPct(cachedPrice: number, livePrice: number): number | null {
  if (!(cachedPrice > 0) || !(livePrice > 0)) return null;
  return (Math.abs(livePrice - cachedPrice) / cachedPrice) * 100;
}

/** True when live stock price has drifted enough to invalidate sv:verify. */
export function isVerifyCachePriceStale(
  cachedPrice: number | null | undefined,
  livePrice: number | null | undefined,
  thresholdPct = VERIFY_PRICE_STALE_PCT,
): boolean {
  const drift = verifyPriceDriftPct(Number(cachedPrice ?? 0), Number(livePrice ?? 0));
  if (drift === null) return false;
  return drift > thresholdPct;
}

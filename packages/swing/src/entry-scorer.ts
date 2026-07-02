export const MIN_STRICT_SCORE = 88;
export const MIN_STRONG_BUY = 93;
export const MIN_BUY = 88;
export const MIN_WATCHLIST = 72;

export function strictFloor(regime?: Record<string, unknown> | null): number {
  if (regime?.strong_bear) return 100;
  if (regime?.sideways) return 90;
  if (regime?.bull) return 88;
  return MIN_STRICT_SCORE;
}

export function scoreEntry(
  entry: { rules?: { id?: string; passed?: boolean | null }[]; r_multiple_ok?: boolean; r_multiple?: number; price_action?: Record<string, unknown> },
  ta: Record<string, unknown>,
  regime?: Record<string, unknown> | null,
) {
  const rules = entry.rules ?? [];
  const passed: string[] = [];
  const failed: string[] = [];
  for (const rule of rules) {
    const id = String(rule.id ?? '');
    if (!id) continue;
    if (rule.passed === true) passed.push(id);
    else if (rule.passed === false) failed.push(id);
  }

  const trend = trendScore(rules);
  const momentum = momentumScore(rules, entry);
  const volume = volumeScore(rules, ta);
  const priceAction = priceActionScore(entry);
  const volatility = volatilityScore(rules);
  const risk = riskScore(entry);

  let total = trend + momentum + volume + priceAction + volatility + risk;
  if (regime?.strong_bear) total = Math.max(0, total - 20);
  if (regime?.sideways) total = Math.max(0, total - 5);
  if (regime?.high_vol) total = Math.max(0, total - 8);
  total = Math.max(0, Math.min(100, total));

  return { total, tier: tierLabel(total), trend, momentum, volume, price_action: priceAction, volatility, risk, passed_rules: passed, failed_rules: failed };
}

function rulePassed(rules: { id?: string; passed?: boolean | null }[], id: string) {
  return rules.some((r) => r.id === id && r.passed === true);
}

function trendScore(rules: { id?: string; passed?: boolean | null }[]) {
  const e1 = rulePassed(rules, 'E1');
  const e7 = rulePassed(rules, 'E7');
  let score = 0;
  if (e1) score += 12;
  if (e7) score += 13;
  if (rulePassed(rules, 'E11')) score += 5;
  if (e1 && e7) score = Math.min(25, score);
  else if (e1 || e7) score = Math.min(18, score);
  return score;
}

function momentumScore(rules: { id?: string; passed?: boolean | null }[], entry: { price_action?: Record<string, unknown> }) {
  let score = 0;
  if (rulePassed(rules, 'E3')) score += 12;
  if (rulePassed(rules, 'E11')) score += 6;
  if (rulePassed(rules, 'E2')) score += 8;
  if (entry.price_action?.higher_low) score += 4;
  return Math.min(20, score);
}

function volumeScore(rules: { id?: string; passed?: boolean | null }[], ta: Record<string, unknown>) {
  if (!rulePassed(rules, 'E6')) return 0;
  const liq = Number(ta.ta_avg_value_cr ?? 0);
  if (liq >= 25) return 15;
  if (liq >= 15) return 12;
  if (liq >= 8) return 10;
  return 6;
}

function priceActionScore(entry: { price_action?: Record<string, unknown> }) {
  const pa = entry.price_action ?? {};
  if (!pa.has_data) return 8;
  if (pa.entry_signal) return 20;
  let score = 0;
  if (pa.higher_low) score += 8;
  if (pa.bullish_candle || pa.support_rejection) score += 6;
  return Math.min(20, score);
}

function volatilityScore(rules: { id?: string; passed?: boolean | null }[]) {
  let score = 0;
  if (rulePassed(rules, 'E4')) score += 6;
  if (rulePassed(rules, 'E5')) score += 4;
  return Math.min(10, score);
}

function riskScore(entry: { r_multiple_ok?: boolean; r_multiple?: number }) {
  let score = 0;
  if (entry.r_multiple_ok) score += 6;
  if (Number(entry.r_multiple ?? 0) >= 3) score += 4;
  return Math.min(10, score);
}

export function tierLabel(score: number): string {
  if (score >= MIN_STRONG_BUY) return 'Strong Buy';
  if (score >= MIN_BUY) return 'Buy';
  if (score >= MIN_WATCHLIST) return 'Watchlist';
  return 'Reject';
}

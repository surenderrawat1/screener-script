const GRAHAM_SKIP_SECTORS = ['banking', 'nbfc', 'insurance', 'reit'];
const ALTMAN_SKIP_SECTORS = ['banking', 'nbfc', 'insurance', 'reit'];

export const ALTMAN_ESTIMATED_Z_MIN = 0.5;
export const ALTMAN_ESTIMATED_Z_MAX = 15;

export function altmanSanityOk(z: number, source: string): boolean {
  if (source !== 'estimated') return true;
  return z >= ALTMAN_ESTIMATED_Z_MIN && z <= ALTMAN_ESTIMATED_Z_MAX;
}

export function altmanUsableForScoring(source: string): boolean {
  return !['unreliable', 'missing', 'skipped', ''].includes(source);
}

export function grahamCredible(sectorKey: string, ctx: Record<string, unknown>): boolean {
  if (GRAHAM_SKIP_SECTORS.includes(sectorKey)) return false;

  const eps = Number(ctx.normalized_eps ?? ctx.eps ?? 0);
  const bv = Number(ctx.book_value ?? 0);
  if (eps <= 0 || bv <= 0) return false;

  const price = Number(ctx.price ?? ctx.current_price ?? 0);
  let pb = Number(ctx.pb_ratio ?? 0);
  if (pb <= 0 && bv > 0 && price > 0) pb = price / bv;
  if (pb < 0.5 || pb > 5) return false;

  const profitYoy = Number(ctx.profit_yoy ?? ctx.eps_growth ?? 0);
  const salesYoy = Number(ctx.sales_yoy ?? ctx.revenue_growth ?? 0);
  const rev3y = Number(ctx.revenue_growth_3yr ?? 0);
  if (rev3y <= 0 && Math.abs(profitYoy - salesYoy) > 25) return false;

  const mcap = Number(ctx.market_cap_cr ?? 0);
  if (mcap > 0 && mcap < 500) return false;

  return true;
}

export function grahamLabel(credible: boolean): string {
  return credible
    ? 'Classic Graham floor — secondary to DCF/Fair P/E'
    : 'Not applicable (sector / asset-light / data)';
}

export function altmanApplicable(sectorKey: string): boolean {
  return !ALTMAN_SKIP_SECTORS.includes(sectorKey);
}

export function altmanSkip(sectorKey: string): boolean {
  return !altmanApplicable(sectorKey);
}

export function altmanZone(z: number): string {
  if (z <= 0) return 'unknown';
  if (z > 2.99) return 'safe';
  if (z >= 1.81) return 'grey';
  return 'distress';
}

export function resolveAltmanMeta(sectorKey: string, ctx: Record<string, unknown>) {
  const skip = altmanSkip(sectorKey) || Boolean(ctx.altman_skip);
  const z = Number(ctx.altman_z ?? 0);
  const source = String(ctx.z_score_source ?? 'missing');
  const unreliable = source === 'estimated' && !altmanSanityOk(z, source);

  return {
    altman_z: z,
    altman_skip: skip,
    altman_zone: skip ? 'skipped' : altmanZone(z),
    z_score_source: skip ? 'skipped' : source,
    altman_unreliable: unreliable,
  };
}

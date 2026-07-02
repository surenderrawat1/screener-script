export function entry52wBand(regime?: Record<string, unknown> | null) {
  const min = Number(regime?.pct_52w_min ?? 32);
  const max = Number(regime?.pct_52w_max ?? 68);
  return { min, max };
}

export function defaultRegime(): Record<string, unknown> {
  return { key: 'sideways', label: 'Sideways (default)', sideways: true, pct_52w_min: 32, pct_52w_max: 68 };
}

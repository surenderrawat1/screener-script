export function fmtMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtNum(v: unknown, suffix = '', digits?: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const d = digits ?? (suffix === '%' ? 1 : 2);
  return `${n.toFixed(d)}${suffix}`;
}

export function verdictTone(v: string): 'enter' | 'watch' | 'avoid' | 'neutral' {
  const k = v.toLowerCase();
  if (k === 'enter' || k === 'strong buy' || k === 'buy' || k === 'setup') return 'enter';
  if (k === 'watch' || k === 'watchlist' || k === 'setup+') return 'watch';
  if (k === 'avoid' || k === 'reject') return 'avoid';
  return 'neutral';
}

export function verdictClass(v: string): string {
  const tone = verdictTone(v);
  if (tone === 'enter') return 'swing-verdict-enter';
  if (tone === 'watch') return 'swing-verdict-watch';
  if (tone === 'avoid') return 'swing-verdict-avoid';
  return '';
}

export function regimeClass(regime: Record<string, unknown>): string {
  if (regime.bull) return 'swing-regime-bull';
  if (regime.bear) return 'swing-regime-bear';
  if (regime.sideways) return 'swing-regime-sideways';
  if (regime.high_vol) return 'swing-regime-vol';
  return 'swing-regime-neutral';
}

export function formatRegimeLabel(regime: Record<string, unknown> | null | undefined): string {
  if (!regime?.label) return '—';
  const label = String(regime.label);
  const proxy = String(regime.proxy ?? 'NIFTYBEES');
  return `${label} (${proxy})`;
}

export function zoneClass(zone: string): string {
  const k = zone.toLowerCase();
  if (k === 'green') return 'swing-zone-green';
  if (k === 'red') return 'swing-zone-red';
  if (k === 'mid') return 'swing-zone-mid';
  return '';
}

export function emaStackFromTa(ta: Record<string, unknown>): { label: string; tone: 'bull' | 'bear' | 'mixed' | 'na' } {
  if (ta.ta_ema_bull_stack === true) return { label: 'bull', tone: 'bull' };
  if (ta.ta_ema_bear_stack === true) return { label: 'bear', tone: 'bear' };
  const ema9 = Number(ta.ta_ema9);
  const ema21 = Number(ta.ta_ema21);
  const ema50 = Number(ta.ta_ema50);
  if (![ema9, ema21, ema50].every(Number.isFinite)) return { label: '—', tone: 'na' };
  if (ema9 > ema21 && ema21 > ema50) return { label: 'bull', tone: 'bull' };
  if (ema9 < ema21 && ema21 < ema50) return { label: 'bear', tone: 'bear' };
  return { label: 'mixed', tone: 'mixed' };
}

export function paStructureLabel(pa: Record<string, unknown>): string {
  if (!pa.has_data) return '—';
  if (pa.higher_low) return 'HL';
  if (pa.exit_signal) return 'LH/LL';
  return '—';
}

export function paCandleLabel(pa: Record<string, unknown>): string {
  if (!pa.has_data) return '—';
  if (pa.bullish_candle) return 'Bullish';
  const detail = String(pa.candle_detail ?? '').toLowerCase();
  if (detail.includes('bearish')) return 'Bearish';
  return 'Neutral';
}

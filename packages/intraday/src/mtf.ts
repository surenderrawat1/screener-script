export function confluence(analysis5m: Record<string, unknown>, analysis15m: Record<string, unknown>) {
  const d5 = directionBucket(analysis5m);
  const d15 = directionBucket(analysis15m);
  const label5 = String(analysis5m.direction_label ?? '—');
  const label15 = String(analysis15m.direction_label ?? '—');
  const conf5 = Number(analysis5m.confidence ?? 0);
  const conf15 = Number(analysis15m.confidence ?? 0);

  const aligned = d5 === d15 && d5 !== 'neutral';
  const conflict = (d5 === 'bull' && d15 === 'bear') || (d5 === 'bear' && d15 === 'bull');

  let key = 'mixed';
  let tone = 'warning';
  let title = 'Mixed timeframes';
  let message = '5m and 15m disagree — trade the active chart only or wait for alignment.';
  let deployPct = 40;

  if (aligned && d5 === 'bull') {
    key = 'strong_bull';
    tone = 'success';
    title = 'MTF aligned bullish';
    message = '5m and 15m both favour longs — higher conviction; prefer 15m plan, use 5m for timing.';
    deployPct = Math.min(100, 55 + Math.round((conf5 + conf15) / 4));
  } else if (aligned && d5 === 'bear') {
    key = 'strong_bear';
    tone = 'danger';
    title = 'MTF aligned bearish';
    message = '5m and 15m both favour shorts / cash — higher conviction.';
    deployPct = Math.min(100, 55 + Math.round((conf5 + conf15) / 4));
  } else if (d5 === 'neutral' && d15 === 'neutral') {
    key = 'range';
    tone = 'warning';
    title = 'MTF range / chop';
    message = 'Both timeframes sideways — fade extremes only or stand aside.';
    deployPct = 25;
  } else if (!conflict && (d5 === 'neutral' || d15 === 'neutral')) {
    key = 'partial';
    tone = 'warning';
    title = 'Partial MTF signal';
    message = `${d15 !== 'neutral' ? '15m' : '5m'} has bias; other timeframe is range-bound — reduce size.`;
    deployPct = 50;
  } else if (conflict) {
    key = 'conflict';
    tone = 'danger';
    title = 'MTF conflict';
    message = `5m ${label5.toLowerCase()} vs 15m ${label15.toLowerCase()} — no trade until one timeframe wins.`;
    deployPct = 0;
  }

  const plan5 = (analysis5m.trade_plan as Record<string, unknown>) ?? {};
  const plan15 = (analysis15m.trade_plan as Record<string, unknown>) ?? {};

  return {
    ok: Boolean(analysis5m.ok) || Boolean(analysis15m.ok),
    key,
    tone,
    title,
    message,
    deploy_pct: deployPct,
    aligned,
    conflict,
    preferred_tf: preferredTf(d5, d15, conf15, conf5),
    timeframes: {
      '5m': tfSummary('5m', analysis5m, plan5),
      '15m': tfSummary('15m', analysis15m, plan15),
    },
  };
}

function directionBucket(analysis: Record<string, unknown>): string {
  const d = String(analysis.direction ?? 'unknown');
  if (['bullish', 'lean_bull'].includes(d)) return 'bull';
  if (['bearish', 'lean_bear'].includes(d)) return 'bear';
  return 'neutral';
}

function preferredTf(d5: string, d15: string, conf15: number, conf5: number): string {
  if (d5 === d15 && d5 !== 'neutral') return conf15 >= conf5 ? '15m' : '5m';
  if (d15 !== 'neutral') return '15m';
  if (d5 !== 'neutral') return '5m';
  return '15m';
}

function tfSummary(tf: string, analysis: Record<string, unknown>, plan: Record<string, unknown>) {
  const trigger = (plan.trigger as Record<string, unknown>) ?? {};
  return {
    interval: tf,
    direction: String(analysis.direction ?? 'unknown'),
    direction_label: String(analysis.direction_label ?? '—'),
    confidence: Number(analysis.confidence ?? 0),
    price: num(analysis.price),
    bias: String(plan.bias ?? 'wait'),
    action_label: String(plan.action_label ?? '—'),
    trigger_status: String(trigger.status ?? ''),
    trigger_label: String(trigger.label ?? ''),
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

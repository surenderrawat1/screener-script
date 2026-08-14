import { passes, preflightChecklist, preset, presetOptionsForInstrument } from './entry-filter.js';
import { resolveExitProfile, targetsFromProfile } from './exit-profile.js';
import { TIME_STOP_IST, TIME_STOP_MIN, formatMinutes } from './session-clock.js';

export const SCALP_PRESET_ID = 'trend_scalp_5m';
export const SCALP_SOURCE = 'nifty_scalp_5m';

export function applyScalpExitProfile(
  basePlan: Record<string, unknown>,
  exitProfileId = 'quick_scalp',
): Record<string, unknown> {
  const plan = { ...basePlan };
  const isLong = plan.bias === 'long';
  const entry = (plan.entry as Record<string, unknown> | undefined) ?? {};
  const stopBlock = (plan.stop_loss as Record<string, unknown> | undefined) ?? {};
  const entryPx = Number(entry.price ?? 0);
  const stopPx = Number(stopBlock.price ?? 0);
  if (!(entryPx > 0) || !(stopPx > 0)) return plan;

  const profile = resolveExitProfile(exitProfileId);
  const riskPts = Math.round(Math.abs(entryPx - stopPx) * 100) / 100;
  const prices = targetsFromProfile(entryPx, stopPx, isLong, profile);
  const exits = prices.map((price, i) => {
    const pts = Math.round(Math.abs(price - entryPx) * 100) / 100;
    const rr = profile.rr[i] ?? Math.round((pts / Math.max(0.01, riskPts)) * 100) / 100;
    const book = profile.partial_pcts[i] ?? 0;
    const tier = `T${i + 1}`;
    return {
      tier,
      price,
      pts,
      pct: Math.round((pts / entryPx) * 1000) / 10,
      rr,
      action: `Book ${book}%`,
      label: `${tier} @ ${rr}R`,
    };
  });
  const t3 = Number(exits[exits.length - 1]?.price ?? entryPx);
  const interval = String(plan.interval ?? '5m');
  const side = isLong ? 'long' : 'short';

  return {
    ...plan,
    stop_loss: {
      ...stopBlock,
      price: stopPx,
      pts: riskPts,
      pct: Math.round((riskPts / entryPx) * 1000) / 10,
      basis: `${String(stopBlock.basis ?? 'Structure stop')} · ${profile.label} profile`,
    },
    risk_points: riskPts,
    risk_pct: Math.round((riskPts / entryPx) * 1000) / 10,
    exits,
    reward_points: Math.round(Math.abs(t3 - entryPx) * 100) / 100,
    risk_reward: riskPts > 0 ? Math.round((Math.abs(t3 - entryPx) / riskPts) * 100) / 100 : 0,
    exit_profile: profile.id,
    exit_profile_label: profile.label,
    time_stop_ist: TIME_STOP_IST,
    exit_rules: [
      `Hard stop: exit 100% if ${interval} closes ${isLong ? 'below' : 'above'} stop.`,
      ...profile.rr.map((r, i) => `T${i + 1} (${r}R): book ${profile.partial_pcts[i]}%`),
      'Move stop to breakeven after T1.',
      `Time stop: flatten open ${side} by ${formatMinutes(TIME_STOP_MIN)} IST.`,
    ],
    chart_levels: [
      { kind: 'entry', price: Math.round(entryPx * 100) / 100, label: 'Entry', color: '#60a5fa' },
      { kind: 'stop', price: Math.round(stopPx * 100) / 100, label: 'Stop', color: '#ef4444' },
      ...exits.map((e) => ({
        kind: 'target',
        price: e.price,
        label: e.tier,
        color: '#22c55e',
      })),
    ],
  };
}

function blocked(
  presetLabel: string,
  exitProfileId: string,
  exitLabel: string,
  message: string,
  gateReasons: string[],
  preflight: Record<string, unknown>,
) {
  return {
    ok: false,
    preset_id: SCALP_PRESET_ID,
    preset_label: presetLabel,
    exit_profile: exitProfileId,
    exit_label: exitLabel,
    entry_allowed: false,
    gate_pass: false,
    gate_reasons: gateReasons.length ? gateReasons : [message],
    preflight,
    summary: message,
    tone: 'neutral',
    source: SCALP_SOURCE,
    plan: null,
  };
}

/** Live 5m trend scalp — entry gate + quick_scalp exits (PHP NiftyIntradayScalpSetup). */
export function buildScalpSetup(
  analysis5: Record<string, unknown>,
  analysis15: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  instrument?: Record<string, unknown> | null,
) {
  const meta = preset(SCALP_PRESET_ID);
  const presetLabel = meta?.label ?? '5m Trend scalp';
  const opts: Record<string, unknown> = {
    ...presetOptionsForInstrument(SCALP_PRESET_ID, instrument),
    analysis_5m: analysis5,
    analysis_15m: analysis15,
  };
  const exitProfileId = String(opts.exit_profile ?? 'quick_scalp');
  const exitMeta = resolveExitProfile(exitProfileId);
  const basePlan = ((analysis5.trade_plan as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const gate = passes(analysis5, basePlan, mtf, opts);
  const preflight = preflightChecklist(
    analysis5,
    basePlan,
    mtf,
    analysis5,
    SCALP_PRESET_ID,
    '5m',
    instrument,
    analysis15,
  );

  const bias = String(basePlan.bias ?? '');
  if (!basePlan.ok || !['long', 'short'].includes(bias)) {
    return blocked(
      presetLabel,
      exitProfileId,
      exitMeta.label,
      String(basePlan.message ?? 'No valid 5m directional plan — stand aside.'),
      gate.reasons,
      preflight,
    );
  }

  const plan = applyScalpExitProfile({ ...basePlan, interval: basePlan.interval ?? '5m' }, exitProfileId);
  const entryAllowed = gate.pass;
  return {
    ok: true,
    preset_id: SCALP_PRESET_ID,
    preset_label: presetLabel,
    exit_profile: exitProfileId,
    exit_label: exitMeta.label,
    exit_desc: '60/30/10 book at 0.8R / 1.5R / 2.2R — flatten by 14:30 IST.',
    entry_allowed: entryAllowed,
    gate_pass: entryAllowed,
    gate_reasons: gate.reasons,
    preflight,
    summary: entryAllowed
      ? '5m trend scalp entry cleared — use quick scalp exits below.'
      : '5m trend scalp blocked — fix gate checks before entry.',
    tone: entryAllowed ? 'success' : 'warning',
    plan,
    direction: String(analysis5.direction_label ?? analysis5.direction ?? '—'),
    confidence: Number(analysis5.confidence ?? 0),
    source: SCALP_SOURCE,
  };
}

import { preflightChecklist } from './entry-filter.js';

export function build(
  plan: Record<string, unknown> | null,
  analysis: Record<string, unknown>,
  analysis5: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  presetEval: Record<string, unknown>[],
  recommendedPreset: string,
  activeTf = '15m',
) {
  const price = Number(analysis.price ?? 0);
  const interval = String(analysis.interval ?? activeTf);

  if (!plan?.ok) {
    return standAside(String(plan?.message ?? analysis.message ?? 'No actionable setup — stand aside.'), price, interval);
  }

  if (plan.bias === 'range' && Array.isArray(plan.setups)) {
    return buildRange(plan, analysis, price, interval);
  }

  return buildDirectional(plan, analysis, analysis5, mtf, presetEval, recommendedPreset, price, interval);
}

function buildDirectional(
  plan: Record<string, unknown>,
  analysis: Record<string, unknown>,
  analysis5: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  presetEval: Record<string, unknown>[],
  recommendedPreset: string,
  price: number,
  interval: string,
) {
  const isLong = plan.bias === 'long';
  const entry = (plan.entry as Record<string, unknown>) ?? {};
  const stop = (plan.stop_loss as Record<string, unknown>) ?? {};
  const exits = (plan.exits as Record<string, unknown>[]) ?? [];
  const trigger = (plan.trigger as Record<string, unknown>) ?? {};
  const entryType = String(entry.type ?? 'market');
  const entryPx = Number(entry.price ?? 0);
  const stopPx = Number(stop.price ?? 0);
  const timeStop = String(plan.time_stop_ist ?? '15:15');

  const preflight = preflightChecklist(analysis, plan, mtf, analysis5, recommendedPreset, interval);
  const preflightOk = preflight.ok;

  const entryStep = entryStepFn(entryType, entryPx, entry, trigger, isLong, price, preflightOk);
  const exitSteps = exitStepsFn(stop, exits, stopPx, isLong, price, timeStop, interval, (plan.trail as Record<string, unknown>) ?? null);
  const manageStep = manageStepFn(plan, isLong, interval);

  const t1 = exits[0] ?? {};
  const t1Px = Number(t1.price ?? 0);

  const steps = [
    step(1, 'preflight', 'Pre-flight', preflight.summary, preflight.status, null, preflight.details),
    step(2, 'entry', isLong ? 'Enter long' : 'Enter short', entryStep.instruction, entryStep.status, entryPx > 0 ? entryPx : null, [entryStep.detail]),
    step(3, 'exit', 'Set stop loss', exitSteps.stop.instruction, 'info', stopPx > 0 ? stopPx : null, [exitSteps.stop.detail]),
    step(4, 'exit', 'T1 — partial + breakeven', exitSteps.targets.t1_instruction, exitSteps.targets.status, t1Px > 0 ? t1Px : null, exitSteps.targets.t1_details),
    step(5, 'exit', 'T2/T3 — scale & trail', exitSteps.targets.rest_instruction, 'info', null, exitSteps.targets.rest_details),
    step(6, 'exit', 'Time exit', exitSteps.time.instruction, 'info', null, [exitSteps.time.detail]),
    step(7, 'manage', 'If thesis breaks', manageStep.instruction, 'warn', null, [manageStep.detail]),
  ];

  const presetBlock = presetEval.find((p) => p.id === recommendedPreset);
  const presetPass = presetBlock?.pass_15m !== false;
  const effectivePreflight = preflightOk && presetPass;

  const headline = headlineFn(effectivePreflight, entryStep, isLong, String(plan.bias_label ?? ''));

  return {
    ok: true,
    headline: headline.text,
    headline_tone: headline.tone,
    bias: plan.bias ?? 'wait',
    bias_label: plan.bias_label ?? '',
    current_price: price > 0 ? Math.round(price * 100) / 100 : null,
    interval,
    actionable: effectivePreflight && Boolean(entryStep.actionable),
    steps,
  };
}

function buildRange(plan: Record<string, unknown>, analysis: Record<string, unknown>, price: number, interval: string) {
  void plan;
  void analysis;
  return standAside('Range mode not implemented in v2 MVP — use directional plan.', price, interval);
}

function entryStepFn(
  entryType: string,
  entryPx: number,
  entry: Record<string, unknown>,
  trigger: Record<string, unknown>,
  isLong: boolean,
  price: number,
  preflightOk: boolean,
) {
  const instruction = entryInstruction(entryType, entryPx, isLong, String(entry.condition ?? ''));
  let status = triggerStatus(trigger, preflightOk);
  let actionable = preflightOk && Boolean(trigger.actionable);
  let detail = String(trigger.label ?? '');
  if (price > 0 && entryPx > 0) {
    detail += `${detail ? ' · ' : ''}LTP ${fmtRs(price)} · entry ${fmtRs(entryPx)}`;
  }
  if (!preflightOk) {
    status = 'blocked';
    actionable = false;
    return { instruction: 'Do not enter yet — clear pre-flight checks first.', detail, status, actionable };
  }
  return { instruction, detail, status, actionable };
}

function exitStepsFn(
  stop: Record<string, unknown>,
  exits: Record<string, unknown>[],
  stopPx: number,
  isLong: boolean,
  price: number,
  timeStop: string,
  interval: string,
  trail: Record<string, unknown> | null,
) {
  const riskPts = Number(stop.pts ?? 0);
  const riskPct = Number(stop.pct ?? 0);
  const stopVerb = isLong ? 'SELL stop-loss' : 'BUY stop-loss (cover)';
  const bookVerb = isLong ? 'SELL limit / market' : 'BUY to cover';
  const stopInstruction = `Immediately after fill: place ${stopVerb} at ${fmtRs(stopPx)} (risk ${fmtNum(riskPts)} pts, ${fmtNum(riskPct)}%). Exit 100% on ${interval} close beyond this level.`;

  const t1 = exits[0];
  const t1Px = t1 ? Number(t1.price ?? 0) : 0;
  const t1Tier = t1 ? String(t1.tier ?? 'T1') : 'T1';
  const t1Action = t1 ? String(t1.action ?? 'Book 40%') : 'Book 40%';
  const t1Rr = t1 && t1.rr !== undefined ? Number(t1.rr) : 1;
  const t1Details: string[] = [];
  const restDetails: string[] = [];
  let t1Status = 'info';
  let t1Instruction = 'Scale out at planned targets.';
  let restInstruction = 'Trail remainder per plan.';

  if (t1Px > 0) {
    t1Instruction = `At ${t1Tier} (${fmtNum(t1Rr)}R): ${bookVerb} at ${fmtRs(t1Px)} — ${t1Action}. Then move stop to breakeven (+0.5 pt buffer).`;
    if (price > 0) {
      const toT1 = isLong ? t1Px - price : price - t1Px;
      if (toT1 <= 0) {
        t1Status = 'now';
        t1Details.push(`${t1Tier} level reached — book partial and raise stop to breakeven if in trade.`);
      } else {
        t1Details.push(`${toT1.toFixed(1)} pts to ${t1Tier} from LTP.`);
      }
    }
  }

  if (trail?.label) restDetails.push(String(trail.label));
  const timeInstruction = `Square off any remainder by ${timeStop} IST — no overnight hold.`;
  const timeDetail = `Hard time stop at ${timeStop} IST regardless of P&L.`;

  return {
    stop: { instruction: stopInstruction, detail: `Initial risk ${fmtNum(riskPts)} pts (${fmtNum(riskPct)}%).` },
    targets: {
      t1_instruction: t1Instruction,
      rest_instruction: restInstruction,
      status: t1Status,
      t1_details: t1Details,
      rest_details: restDetails,
    },
    time: { instruction: timeInstruction, detail: timeDetail },
  };
}

function manageStepFn(plan: Record<string, unknown>, isLong: boolean, interval: string) {
  const invalidation = String(plan.invalidation ?? 'Thesis breaks on stop or structure loss.');
  const verb = isLong ? 'below' : 'above';
  return {
    instruction: `If ${interval} closes ${verb} invalidation level — exit full position.`,
    detail: invalidation,
  };
}

function headlineFn(preflightOk: boolean, entryStep: Record<string, unknown>, isLong: boolean, biasLabel: string) {
  if (!preflightOk) return { text: 'WAIT — clear pre-flight before entering', tone: 'warning' };
  if (entryStep.actionable) {
    const verb = isLong ? 'BUY / go long' : 'SELL / go short';
    return { text: `GO — ${verb} now`, tone: 'success' };
  }
  if (entryStep.status === 'blocked') return { text: 'BLOCKED — do not enter', tone: 'danger' };
  return { text: `SET UP — ${biasLabel} · wait for entry trigger`, tone: 'warning' };
}

function entryInstruction(entryType: string, entryPx: number, isLong: boolean, note: string) {
  const side = isLong ? 'BUY' : 'SELL short';
  const px = fmtRs(entryPx);
  if (entryType === 'limit') return `${side} limit at ${px}${note ? ` — ${note}` : ''}`;
  return `${side} at market (~${px})${note ? ` — ${note}` : ''}`;
}

function triggerStatus(trigger: Record<string, unknown>, preflightOk: boolean) {
  if (!preflightOk) return 'blocked';
  if (trigger.actionable || trigger.status === 'READY') return 'ready';
  if (trigger.status === 'TRIGGERED') return 'now';
  return 'wait';
}

function standAside(message: string, price: number, interval: string) {
  return {
    ok: false,
    headline: 'STAND ASIDE',
    headline_tone: 'neutral',
    bias: 'wait',
    bias_label: 'No trade',
    current_price: price > 0 ? Math.round(price * 100) / 100 : null,
    interval,
    actionable: false,
    steps: [
      step(1, 'preflight', 'No setup', message, 'fail', null, [
        `Wait for clearer ${interval} structure or higher confidence.`,
        'Check entry window 10:15–14:45 IST before any new trade.',
      ]),
    ],
  };
}

function step(
  n: number,
  kind: string,
  title: string,
  instruction: string,
  status: string,
  price: number | null,
  details: string[],
) {
  return { step: n, kind, title, instruction, status, price, details };
}

function fmtRs(n: number) {
  return `₹${n.toFixed(2)}`;
}

function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

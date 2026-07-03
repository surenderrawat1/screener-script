import type { CriticalFail, Gate, PhaseResult } from './types.js';

export interface GateContext {
  criticalFails: CriticalFail[];
  gateWarnings: string[];
}

export function gate(
  ctx: GateContext,
  id: string,
  label: string,
  pass: boolean,
  points = 1,
  critical = false,
  note = '',
): Gate {
  const status = pass ? 'pass' : critical ? 'critical' : 'fail';
  if (critical && !pass) {
    ctx.criticalFails.push({ id, label, note });
  }
  return {
    id,
    label,
    status,
    points: pass ? points : 0,
    max: points,
    critical,
    note,
  };
}

export function yesNoGate(
  ctx: GateContext,
  id: string,
  label: string,
  value: boolean | null,
  points = 1,
  critical = false,
  note = '',
): Gate {
  if (value === null) {
    return {
      id,
      label,
      status: 'warn',
      points: 0,
      max: points,
      critical: false,
      note: 'Not answered',
    };
  }
  return gate(ctx, id, label, value, points, critical, note);
}

export function phaseResult(
  num: number,
  title: string,
  gates: Gate[],
  maxPts: number,
  gateNote: string | null = null,
  blocked = false,
): PhaseResult {
  const score = Math.min(maxPts, gates.reduce((sum, g) => sum + g.points, 0));
  const criticalInPhase = gates.some((g) => g.status === 'critical');

  return {
    number: num,
    title,
    gates,
    score,
    max: maxPts,
    critical_fail: criticalInPhase,
    gate_note: gateNote,
    investor_gate_blocked: blocked,
  };
}

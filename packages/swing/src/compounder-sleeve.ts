import {
  economicEdgeGateStatus,
  GRADE_FAIL,
  GRADE_WEAK,
  type BacktestTruthCompact,
} from './auto-backtest-truth.js';

/** Minimum 3y buy-and-hold return to prefer compounder over swing (research: BSE/INDIGO). */
export const COMPOUNDER_MIN_BUY_HOLD_PCT = 25;
/** Do not run Swing paper / X1–X9 on compounder-routed names. */
export const COMPOUNDER_BLOCKS_SWING_PAPER = true;
/** Soft minimum hold before thesis review (≈3 months of sessions). */
export const COMPOUNDER_MIN_HOLD_SESSIONS = 60;
/** Ignore classic ~8% swing targets — let the re-rating run. */
export const COMPOUNDER_IGNORE_SWING_TARGET = true;
/** Peak-to-trough pullback that triggers thesis review (not an auto cut). */
export const COMPOUNDER_PEAK_DD_REVIEW_PCT = 35;
/** Catastrophic loss vs entry before capital cut on a compounder journal. */
export const COMPOUNDER_CATASTROPHIC_LOSS_PCT = -25;
/** Marker stamped on research-journal notes for held compounder names. */
export const COMPOUNDER_NOTES_MARKER = 'sleeve:compounder';

export type CompounderHoldAction = 'HOLD' | 'REVIEW_THESIS' | 'EXIT_THESIS' | 'CUT_LOSS';

export type CompounderHoldResult = {
  action: CompounderHoldAction;
  label: string;
  summary: string;
  reasons: string[];
  ignore_swing_target: boolean;
  min_hold_sessions: number;
  sessions_held: number;
  peak_dd_pct: number | null;
};

export type SleeveKind = 'swing' | 'compounder' | 'research' | 'avoid';

export type CompounderSleeveResult = {
  sleeve: SleeveKind;
  eligible: boolean;
  blocks_swing_paper: boolean;
  label: string;
  summary: string;
  reasons: string[];
  policy: {
    min_hold_sessions: number;
    ignore_swing_target: boolean;
    strategy_preset: string;
    strategy_key: string;
  };
};

function qualityOk(hit: Record<string, unknown>): boolean | null {
  if (hit.fundamental_quality_ok === true) return true;
  if (hit.fundamental_quality_ok === false) return false;
  const roe = Number(hit.roe ?? 0);
  const roce = Number(hit.roce ?? 0);
  if (roe > 0 && roce > 0) return roe >= 15 && roce >= 15;
  if (roe > 0 && hit.fundamental_roce_waived === true) return roe >= 15;
  return null;
}

function swingEdgeFailed(truth?: BacktestTruthCompact | Record<string, unknown> | null): boolean {
  if (!truth) return false;
  const edge = economicEdgeGateStatus(truth as never);
  if (edge === 'fail') return true;
  const grade = String(truth.grade ?? '').toUpperCase();
  return grade === GRADE_FAIL || grade === GRADE_WEAK;
}

function swingEdgePassed(truth?: BacktestTruthCompact | Record<string, unknown> | null): boolean {
  if (!truth) return false;
  return economicEdgeGateStatus(truth as never) === 'pass';
}

/**
 * Route names that swing ENTER cannot harvest (BSE/INDIGO research) into a
 * positional compounder sleeve — separate from Auto paper / X1–X9 exits.
 */
export function evaluateCompounderSleeve(
  hit: Record<string, unknown>,
  _regime?: Record<string, unknown> | null,
): CompounderSleeveResult {
  const policy = {
    min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
    ignore_swing_target: COMPOUNDER_IGNORE_SWING_TARGET,
    strategy_preset: 'moat_compounders',
    strategy_key: 'pos_moat_compounders',
  };
  const reasons: string[] = [];
  const truth = (hit.backtest_truth ?? null) as BacktestTruthCompact | null;
  const q = qualityOk(hit);
  const buyHold =
    truth && truth.buy_hold_pct != null && Number.isFinite(Number(truth.buy_hold_pct))
      ? Number(truth.buy_hold_pct)
      : null;

  if (q === false) {
    return {
      sleeve: 'avoid',
      eligible: false,
      blocks_swing_paper: false,
      label: 'Avoid',
      summary: 'Fails CFA quality floor — neither swing nor compounder sleeve.',
      reasons: [String(hit.fundamental_quality_summary ?? 'ROE/ROCE below floor')],
      policy,
    };
  }

  if (swingEdgePassed(truth) && hit.high_conviction === true) {
    return {
      sleeve: 'swing',
      eligible: false,
      blocks_swing_paper: false,
      label: 'Swing',
      summary: 'Swing Auto sleeve — economic edge + high conviction.',
      reasons: ['BT edge pass', 'high conviction'],
      policy,
    };
  }

  if (swingEdgePassed(truth)) {
    return {
      sleeve: 'swing',
      eligible: false,
      blocks_swing_paper: false,
      label: 'Swing',
      summary: 'Swing path has economic edge — keep on Auto / paper gates.',
      reasons: ['BT edge pass'],
      policy,
    };
  }

  const edgeFail = swingEdgeFailed(truth);
  if (edgeFail) reasons.push(`Swing edge ${String(truth?.grade ?? 'fail')}`);
  if (q === true) reasons.push('Quality floor pass');
  if (buyHold != null && buyHold >= COMPOUNDER_MIN_BUY_HOLD_PCT) {
    reasons.push(`Buy&hold ${buyHold.toFixed(0)}% ≥ ${COMPOUNDER_MIN_BUY_HOLD_PCT}%`);
  }

  const buyHoldOk = buyHold == null || buyHold >= COMPOUNDER_MIN_BUY_HOLD_PCT;
  // Prefer compounder when quality holds and swing path is economically weak,
  // and buy-hold (when known) still compounds.
  if (q === true && edgeFail && buyHoldOk) {
    return {
      sleeve: 'compounder',
      eligible: true,
      blocks_swing_paper: COMPOUNDER_BLOCKS_SWING_PAPER,
      label: 'Compounder',
      summary:
        buyHold != null
          ? `Route to positional compounder sleeve — swing ENTER misses buy&hold (+${buyHold.toFixed(0)}%).`
          : 'Route to positional compounder sleeve — swing ENTER edge fails quality name.',
      reasons,
      policy,
    };
  }

  if (q === true && !truth) {
    return {
      sleeve: 'research',
      eligible: false,
      blocks_swing_paper: false,
      label: 'Research',
      summary: 'Quality OK — await BT truth before sleeve routing.',
      reasons: ['Quality floor pass', 'BT truth missing'],
      policy,
    };
  }

  return {
    sleeve: 'research',
    eligible: false,
    blocks_swing_paper: false,
    label: 'Research',
    summary: 'Not routed — keep on setup/research radar only.',
    reasons: reasons.length ? reasons : ['No compounder mismatch detected'],
    policy,
  };
}

function peakDrawdownPct(row: Record<string, unknown>): number | null {
  const high = Number(row.high_water ?? 0);
  const price = Number(row.current_price ?? row.price ?? 0);
  if (!(high > 0) || !(price > 0) || price > high) return price > 0 && high > 0 ? 0 : null;
  return Math.round(((high - price) / high) * 1000) / 10;
}

/** True when an open journal / hit should use the compounder hold book. */
export function isCompounderManaged(
  row?: Record<string, unknown> | null,
  hitMatch?: Record<string, unknown> | null,
): boolean {
  if (hitMatch && (hitMatch.sleeve === 'compounder' || hitMatch.sleeve_eligible === true)) return true;
  if (!row) return false;
  if (row.sleeve === 'compounder' || row.sleeve_eligible === true) return true;
  const notes = String(row.notes ?? '');
  return notes.includes(COMPOUNDER_NOTES_MARKER) || /\bsleeve\s*[:=]\s*compounder\b/i.test(notes);
}

/**
 * Positional hold book for compounder-routed names (BSE/INDIGO research).
 * Does not harvest ~8% swing targets; reviews on quality / deep peak DD only.
 */
export function evaluateCompounderHold(
  row: Record<string, unknown>,
  hitMatch?: Record<string, unknown> | null,
): CompounderHoldResult {
  const sessions = Math.max(0, Number(row.sessions_held ?? 0));
  const gain = Number(row.gain_pct);
  const gainOk = Number.isFinite(gain);
  const peakDd = peakDrawdownPct({
    ...row,
    high_water: row.high_water ?? hitMatch?.high_water,
    current_price: row.current_price ?? row.price ?? hitMatch?.price,
  });
  const reasons: string[] = [];
  const quality =
    hitMatch?.fundamental_quality_ok ?? row.fundamental_quality_ok ?? null;

  if (quality === false) {
    reasons.push(String(hitMatch?.fundamental_quality_summary ?? row.fundamental_quality_summary ?? 'Quality floor broken'));
    return {
      action: 'EXIT_THESIS',
      label: 'Exit thesis',
      summary: 'Compounder thesis broken — ROE/ROCE no longer clears the CFA floor.',
      reasons,
      ignore_swing_target: true,
      min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
      sessions_held: sessions,
      peak_dd_pct: peakDd,
    };
  }

  if (gainOk && gain <= COMPOUNDER_CATASTROPHIC_LOSS_PCT) {
    reasons.push(`Loss ${gain.toFixed(1)}% ≤ ${COMPOUNDER_CATASTROPHIC_LOSS_PCT}% vs entry`);
    return {
      action: 'CUT_LOSS',
      label: 'Cut loss',
      summary: 'Catastrophic drawdown vs entry — protect capital even on compounder sleeve.',
      reasons,
      ignore_swing_target: true,
      min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
      sessions_held: sessions,
      peak_dd_pct: peakDd,
    };
  }

  if (peakDd != null && peakDd >= COMPOUNDER_PEAK_DD_REVIEW_PCT) {
    reasons.push(`Peak drawdown ${peakDd}% ≥ ${COMPOUNDER_PEAK_DD_REVIEW_PCT}%`);
    return {
      action: 'REVIEW_THESIS',
      label: 'Review thesis',
      summary: 'Deep pullback from highs — re-check moat / earnings, do not auto-trim like a swing.',
      reasons,
      ignore_swing_target: true,
      min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
      sessions_held: sessions,
      peak_dd_pct: peakDd,
    };
  }

  if (sessions < COMPOUNDER_MIN_HOLD_SESSIONS) {
    reasons.push(
      `Min hold ${sessions}/${COMPOUNDER_MIN_HOLD_SESSIONS} sessions — ignore swing X2/trim/time stops`,
    );
    if (COMPOUNDER_IGNORE_SWING_TARGET) reasons.push('Swing profit target ignored on compounder sleeve');
    return {
      action: 'HOLD',
      label: 'Hold (min period)',
      summary: `Compounder min-hold active — let the re-rating run (≥${COMPOUNDER_MIN_HOLD_SESSIONS} sessions).`,
      reasons,
      ignore_swing_target: true,
      min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
      sessions_held: sessions,
      peak_dd_pct: peakDd,
    };
  }

  if (quality === true) {
    reasons.push('Quality floor intact');
  }
  if (COMPOUNDER_IGNORE_SWING_TARGET) {
    reasons.push('Ignore classic ~8% swing target — positional hold');
  }
  if (gainOk && gain >= 8) {
    reasons.push(`Unrealized +${gain.toFixed(1)}% — do not trim as swing X2`);
  }

  return {
    action: 'HOLD',
    label: 'Hold compounder',
    summary: 'Thesis intact — manage as positional moat compounder, not X1–X9 swing.',
    reasons: reasons.length ? reasons : ['Compounder hold book'],
    ignore_swing_target: true,
    min_hold_sessions: COMPOUNDER_MIN_HOLD_SESSIONS,
    sessions_held: sessions,
    peak_dd_pct: peakDd,
  };
}

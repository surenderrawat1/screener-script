import { DEFAULT_LAST_ENTRY_MIN, DEFAULT_MIN_ENTRY_MIN, entryWindow, gateReasons as clockGateReasons } from './session-clock.js';
import { gateReasons as ema50GateReasons, fromAnalysis as ema50FromAnalysis } from './ema50-bias.js';
import { gateReasons as gc9GateReasons, fromAnalysis as gc9FromAnalysis } from './gc9-dc9.js';
import { gateReasons as regimeGateReasons } from './session-regime.js';
import { gateReasons as qualityGateReasons } from './signal-quality.js';

const DEFAULT_OPTIONS = {
  require_5m_ema50_bias: true,
  require_5m_gc9_dc9: true,
};

export const PRESETS: Record<string, { label: string; description: string; options: Record<string, unknown> }> = {
  baseline: {
    label: 'Baseline',
    description: 'Directional plans only — no range fades',
    options: { skip_range: true, require_5m_ema50_bias: false, require_5m_gc9_dc9: false },
  },
  quality: {
    label: 'Quality',
    description: '5m EMA-50 + GC9/DC9 · conf ≥50 · skip chop · cooldown 6',
    options: { skip_range: true, min_confidence: 50, skip_chop: true, cooldown_bars: 6 },
  },
  strict_mtf: {
    label: 'Strict MTF',
    description: '5m+15m aligned · conf ≥55 · deploy ≥60% · 1 trade/session',
    options: {
      skip_range: true,
      require_mtf: true,
      min_confidence: 55,
      min_mtf_deploy: 60,
      skip_chop: true,
      max_trades_per_session: 1,
      cooldown_bars: 6,
    },
  },
  sniper: {
    label: 'Sniper',
    description: 'MTF aligned · conf ≥60 · deploy ≥70% · actionable trigger only',
    options: {
      skip_range: true,
      require_mtf: true,
      min_confidence: 60,
      min_mtf_deploy: 70,
      skip_chop: true,
      require_actionable_trigger: true,
      max_trades_per_session: 1,
      cooldown_bars: 8,
    },
  },
  trend_day: {
    label: 'Trend day',
    description: 'Trade only with session trend · skip range/chop days',
    options: {
      skip_range: true,
      skip_range_regime: true,
      require_trend_regime: true,
      min_confidence: 45,
      cooldown_bars: 6,
    },
  },
  trend_scalp_5m: {
    label: '5m Trend scalp',
    description: 'Trend day · 10:15 gate · skip chop/trend-up · quick scalp exits',
    options: {
      skip_range: true,
      skip_range_regime: true,
      require_trend_regime: true,
      skip_chop: true,
      min_confidence: 48,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      skip_regime_keys: ['unknown', 'trend_up'],
      cooldown_bars: 6,
      max_trades_per_session: 2,
      exit_profile: 'quick_scalp',
    },
  },
  trend_mtf: {
    label: 'Trend + MTF',
    description: 'Session trend + 5m/15m aligned · conf ≥50',
    options: {
      skip_range: true,
      skip_range_regime: true,
      require_trend_regime: true,
      require_mtf: true,
      min_confidence: 50,
      max_trades_per_session: 1,
      cooldown_bars: 6,
    },
  },
  after_or: {
    label: 'After OR (10:15)',
    description: 'No entries before 10:15 IST · skip warming-up regime',
    options: {
      skip_range: true,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      cooldown_bars: 4,
    },
  },
  after_or_mtf: {
    label: 'After OR + MTF',
    description: '10:15 IST gate · MTF aligned · conf ≥50',
    options: {
      skip_range: true,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      require_mtf: true,
      min_confidence: 50,
      skip_chop: true,
      max_trades_per_session: 1,
      cooldown_bars: 6,
    },
  },
  analytics_tuned: {
    label: 'Analytics tuned',
    description: '10:15 gate · block warming-up & trend-up regimes',
    options: {
      skip_range: true,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      skip_regime_keys: ['unknown', 'trend_up'],
      min_confidence: 45,
      cooldown_bars: 6,
    },
  },
  production: {
    label: 'Production',
    description: 'Analytics tuned entry · as-planned exits',
    options: {
      skip_range: true,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      skip_regime_keys: ['unknown', 'trend_up'],
      min_confidence: 45,
      cooldown_bars: 6,
      exit_profile: 'as_planned',
    },
  },
  banknifty_tuned: {
    label: 'Bank Nifty tuned',
    description: '10:15 gate · wide stop · 3pt slippage · 1 trade/session',
    options: {
      skip_range: true,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      skip_warming_regime: true,
      skip_regime_keys: ['unknown', 'trend_up'],
      min_confidence: 50,
      max_trades_per_session: 1,
      cooldown_bars: 8,
      slippage_pts: 3.0,
      exit_profile: 'wide_stop',
    },
  },
  cfa_precision: {
    label: 'CFA Precision',
    description: '5m EMA-50 + GC9/DC9 · MTF · regime map · precision exits',
    options: {
      skip_range: true,
      min_entry_min_ist: 10 * 60 + 30,
      last_entry_min_ist: 14 * 60 + 30,
      skip_warming_regime: true,
      skip_regime_keys: ['unknown', 'range'],
      regime_long_keys: ['mixed', 'lean_up', 'trend_up'],
      regime_short_keys: ['mixed', 'lean_down', 'trend_down', 'chop'],
      require_mtf: true,
      min_mtf_deploy: 55,
      min_confidence: 48,
      require_actionable_trigger: true,
      min_net_score: 16,
      max_trades_per_session: 1,
      cooldown_bars: 6,
      exit_profile: 'cfa_precision',
    },
  },
};

export function presetIds(): string[] {
  return Object.keys(PRESETS);
}

export function preset(id: string) {
  return PRESETS[id] ?? null;
}

export function presetOptions(id: string): Record<string, unknown> {
  const p = preset(id);
  return { ...DEFAULT_OPTIONS, ...(p?.options ?? {}) };
}

export function presetOptionsForInstrument(id: string, _instrument?: Record<string, unknown> | null) {
  return presetOptions(id);
}

export function passes(
  analysis: Record<string, unknown>,
  plan: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  options: Record<string, unknown>,
) {
  const reasons: string[] = [];
  if (!plan.ok) {
    return { pass: false, reasons: ['No valid trade plan'] };
  }

  const bias = String(plan.bias ?? '');
  const skipRange = !('skip_range' in options) || Boolean(options.skip_range);
  if (skipRange && bias === 'range') reasons.push('Range-bound session — stand aside');
  if (!['long', 'short'].includes(bias)) reasons.push(`Bias is not directional (${bias})`);

  const barMin = Number(analysis.bar_minutes_ist ?? 0);
  if (barMin > 0) {
    reasons.push(
      ...clockGateReasons(barMin, {
        min_entry_min_ist: Number(options.min_entry_min_ist ?? 0),
        last_entry_min_ist: Number(options.last_entry_min_ist ?? DEFAULT_LAST_ENTRY_MIN),
      }),
    );
  }

  const minConf = Number(options.min_confidence ?? 0);
  const conf = Number(analysis.confidence ?? 0);
  if (minConf > 0 && conf < minConf) reasons.push(`Confidence ${conf}% below minimum ${minConf}%`);

  if (options.skip_chop) {
    const dir = String(analysis.direction ?? '');
    if (dir === 'sideways') reasons.push('Sideways / chop — no trend edge');
    if (bias === 'long' && dir === 'lean_bear') reasons.push('Long plan vs lean-bear direction');
    if (bias === 'short' && dir === 'lean_bull') reasons.push('Short plan vs lean-bull direction');
  }

  if (options.require_actionable_trigger) {
    const trigger = (plan.trigger as Record<string, unknown>) ?? {};
    const status = String(trigger.status ?? '');
    const actionable =
      Boolean(trigger.actionable) || ['READY', 'TRIGGERED', 'AT_ENTRY'].includes(status);
    if (!actionable) reasons.push(`Entry trigger not actionable (${status || 'unknown'})`);
  }

  const needsMtf = Boolean(options.require_mtf) || Number(options.min_mtf_deploy ?? 0) > 0;
  if (needsMtf) {
    if (!mtf?.ok) {
      reasons.push('MTF data unavailable');
    } else {
      if (options.require_mtf) {
        if (!mtf.aligned) reasons.push('5m and 15m not aligned');
        if (mtf.conflict) reasons.push('MTF conflict between timeframes');
      }
      const minDeploy = Number(options.min_mtf_deploy ?? 0);
      const deploy = Number(mtf.deploy_pct ?? 0);
      if (minDeploy > 0 && deploy < minDeploy) {
        reasons.push(`MTF deploy ${deploy}% below minimum ${minDeploy}%`);
      }
    }
  }

  const regime = analysis.session_regime as Record<string, unknown> | undefined;
  if (regime && ['long', 'short'].includes(bias)) {
    reasons.push(...regimeGateReasons(regime, bias, options));
  }

  reasons.push(...qualityGateReasons(analysis, plan, mtf, options));

  if (options.require_5m_ema50_bias) {
    const analysis5 = options.analysis_5m as Record<string, unknown> | undefined;
    reasons.push(...ema50GateReasons(analysis5, bias));
  }
  if (options.require_5m_gc9_dc9) {
    const analysis5 = options.analysis_5m as Record<string, unknown> | undefined;
    reasons.push(...gc9GateReasons(analysis5, bias));
  }

  return { pass: reasons.length === 0, reasons };
}

export function preflightChecklist(
  analysis: Record<string, unknown>,
  plan: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
  analysis5: Record<string, unknown>,
  presetId: string,
  activeTf: string,
  instrument?: Record<string, unknown> | null,
) {
  const meta = preset(presetId);
  const label = meta?.label ?? presetId;
  const opts: Record<string, unknown> = { ...presetOptionsForInstrument(presetId, instrument), analysis_5m: analysis5 };
  const details: string[] = [];

  const barMin = Number(analysis.bar_minutes_ist ?? 0);
  if (barMin > 0) {
    const window = entryWindow(barMin, {
      min_entry_min_ist: Number(opts.min_entry_min_ist ?? 0),
      last_entry_min_ist: Number(opts.last_entry_min_ist ?? DEFAULT_LAST_ENTRY_MIN),
    });
    details.push(`${window.open ? '✓' : '✗'} ${window.message}`);
  } else {
    const ew = (analysis.entry_window as Record<string, unknown>) ?? {};
    details.push(`${ew.open ? '✓' : '✗'} ${String(ew.message ?? 'Entry window')}`);
  }

  if (opts.require_5m_ema50_bias) {
    const state = ema50FromAnalysis(analysis5);
    const emaOk = ema50GateReasons(analysis5, String(plan.bias ?? '')).length === 0;
    details.push(`${emaOk ? '✓' : '✗'} ${state.label}`);
  }
  if (opts.require_5m_gc9_dc9) {
    const state = gc9FromAnalysis(analysis5);
    const gcOk = gc9GateReasons(analysis5, String(plan.bias ?? '')).length === 0;
    details.push(`${gcOk ? '✓' : '✗'} ${state.label}`);
  }
  if (opts.require_mtf || Number(opts.min_mtf_deploy ?? 0) > 0) {
    if (mtf?.ok) {
      const aligned = Boolean(mtf.aligned) && !mtf.conflict;
      const deploy = Number(mtf.deploy_pct ?? 0);
      const minDeploy = Number(opts.min_mtf_deploy ?? 0);
      const mtfOk = aligned && (minDeploy <= 0 || deploy >= minDeploy);
      details.push(`${mtfOk ? '✓' : '✗'} MTF ${aligned ? 'aligned' : 'not aligned'} · deploy ${deploy}%`);
    } else {
      details.push('✗ MTF data unavailable');
    }
  }

  const trigger = (plan.trigger as Record<string, unknown>) ?? {};
  if (opts.require_actionable_trigger) {
    const actionable =
      Boolean(trigger.actionable) ||
      ['READY', 'TRIGGERED', 'AT_ENTRY'].includes(String(trigger.status ?? ''));
    details.push(`${actionable ? '✓' : '✗'} Entry trigger ${trigger.label ?? 'not ready'}`);
  }

  const gate = passes(analysis, plan, mtf, opts);
  if (gate.pass) {
    details.push(`✓ «${label}» preset passes on ${activeTf}`);
  } else {
    for (const reason of gate.reasons) details.push(`✗ ${reason}`);
  }

  const failures = details.filter((line) => line.startsWith('✗')).length;
  return {
    ok: gate.pass,
    status: gate.pass ? 'pass' : 'fail',
    summary: gate.pass
      ? 'All preset checks passed — proceed if entry trigger is live.'
      : failures > 0
        ? `${failures} check(s) failed — do not enter until cleared.`
        : 'Preset blocked.',
    details,
  };
}

export function evaluatePresets(
  analysis5: Record<string, unknown>,
  analysis15: Record<string, unknown>,
  mtf: Record<string, unknown>,
) {
  const out: Record<string, unknown>[] = [];
  for (const [id, meta] of Object.entries(PRESETS)) {
    const plan5 = (analysis5.trade_plan as Record<string, unknown>) ?? {};
    const plan15 = (analysis15.trade_plan as Record<string, unknown>) ?? {};
    const opts = { ...presetOptions(id), analysis_5m: analysis5 };
    const pass5 = passes(analysis5, plan5, mtf, opts);
    const pass15 = passes(analysis15, plan15, mtf, opts);
    out.push({
      id,
      label: meta.label,
      description: meta.description,
      recommended: id === 'production',
      pass_5m: pass5.pass,
      pass_15m: pass15.pass,
      reasons_5m: pass5.reasons,
      reasons_15m: pass15.reasons,
    });
  }
  return out;
}

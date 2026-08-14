import { DEFAULT_LAST_ENTRY_MIN, DEFAULT_MIN_ENTRY_MIN, entryWindow, gateReasons as clockGateReasons } from './session-clock.js';
import { gateReasons as ema50GateReasons, fromAnalysis as ema50FromAnalysis } from './ema50-bias.js';
import { gateReasons as gc9GateReasons, fromAnalysis as gc9FromAnalysis } from './gc9-dc9.js';
import { gateReasons as sma20GateReasons, fromAnalysis as sma20FromAnalysis } from './sma20-bias.js';
import { gateReasons as regimeGateReasons } from './session-regime.js';
import { gateReasons as qualityGateReasons } from './signal-quality.js';
import { entryFilterOverrides, pickLiveRecommendedPreset } from './instruments.js';

const INSTRUMENT_FLOOR_KEYS = ['min_confidence', 'min_mtf_deploy', 'min_net_score', 'min_confluence', 'min_setup_score'] as const;

const DEFAULT_OPTIONS = {
  require_5m_ema50_bias: true,
  require_5m_gc9_dc9: true,
  require_5m_sma20_bias: false,
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
      last_entry_min_ist: 14 * 60,
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
  ma20_stratzy: {
    label: '20 MA Stratzy',
    description:
      'SMA-20 bias · pullback (≤0.30% from MA) · EMA stack · grade≥B · MTF ≥65% · conf≥58 · 10:15–13:30 · 1/day · Stratzy 70/20/10 @0.6R T1',
    options: {
      skip_range: true,
      require_5m_ema50_bias: false,
      require_5m_gc9_dc9: false,
      require_5m_sma20_bias: true,
      require_15m_sma20_bias: true,
      require_ema_stack: true,
      require_strong_direction: true,
      min_setup_grade: 'B',
      max_sma20_extension_pct: 0.3,
      min_entry_min_ist: DEFAULT_MIN_ENTRY_MIN,
      // 13:30 last entry: runway to 14:30 time stop for 0.6R T1 on 15m index paper book.
      last_entry_min_ist: 13 * 60 + 30,
      skip_warming_regime: true,
      skip_range_regime: true,
      skip_chop: true,
      require_mtf: true,
      min_mtf_deploy: 65,
      require_actionable_trigger: true,
      min_confidence: 58,
      min_net_score: 18,
      cooldown_bars: 10,
      max_trades_per_session: 1,
      exit_profile: 'stratzy_trend',
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

type InstrumentLike = { id?: string; kind?: string } | null | undefined;

export function presetOptionsForInstrument(id: string, instrument?: InstrumentLike) {
  const opts: Record<string, unknown> = { ...presetOptions(id) };
  if (!instrument) return opts;
  const over: Record<string, unknown> = { ...entryFilterOverrides(instrument) };
  for (const key of INSTRUMENT_FLOOR_KEYS) {
    if (key in over && key in opts) {
      opts[key] = Math.max(Number(opts[key] ?? 0), Number(over[key] ?? 0));
      delete over[key];
    }
  }
  return { ...opts, ...over };
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

  const stopMeta = (plan.stop_loss as Record<string, unknown> | undefined) ?? {};
  const minStopPct = Number(options.min_stop_pct ?? 0);
  if (minStopPct > 0) {
    const stopPct = Number(stopMeta.pct ?? 0);
    if (!(stopPct >= minStopPct)) {
      reasons.push(
        `Stop ${stopPct || 0}% too tight vs min ${minStopPct}% (cost floor would crush expectancy)`,
      );
    }
  }

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

  if (options.require_strong_direction) {
    const dir = String(analysis.direction ?? '');
    if (bias === 'long' && dir !== 'bullish') {
      reasons.push(`Long requires strong bullish direction (got ${dir || 'unknown'})`);
    }
    if (bias === 'short' && dir !== 'bearish') {
      reasons.push(`Short requires strong bearish direction (got ${dir || 'unknown'})`);
    }
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
  if (options.require_5m_sma20_bias) {
    const analysis5 = options.analysis_5m as Record<string, unknown> | undefined;
    reasons.push(
      ...sma20GateReasons(analysis5, bias, {
        max_sma20_extension_pct: Number(options.max_sma20_extension_pct ?? 0),
      }),
    );
  }
  if (options.require_15m_sma20_bias) {
    const analysis15 = options.analysis_15m as Record<string, unknown> | undefined;
    reasons.push(
      ...sma20GateReasons(analysis15, bias, {
        // 15m only needs side agreement — extension check stays on 5m.
        max_sma20_extension_pct: 0,
      }),
    );
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
  analysis15?: Record<string, unknown> | null,
) {
  const meta = preset(presetId);
  const label = meta?.label ?? presetId;
  const opts: Record<string, unknown> = {
    ...presetOptionsForInstrument(presetId, instrument),
    analysis_5m: analysis5,
    analysis_15m: analysis15 ?? undefined,
  };
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
  if (opts.require_5m_sma20_bias) {
    const state = sma20FromAnalysis(analysis5);
    const smaOk =
      sma20GateReasons(analysis5, String(plan.bias ?? ''), {
        max_sma20_extension_pct: Number(opts.max_sma20_extension_pct ?? 0),
      }).length === 0;
    details.push(`${smaOk ? '✓' : '✗'} ${state.label}`);
  }
  if (opts.require_15m_sma20_bias) {
    const analysis15 = (opts.analysis_15m as Record<string, unknown> | undefined) ?? {};
    const state15 = sma20FromAnalysis(analysis15);
    const sma15Ok = sma20GateReasons(analysis15, String(plan.bias ?? '')).length === 0;
    details.push(`${sma15Ok ? '✓' : '✗'} 15m ${state15.label}`);
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
  instrument?: InstrumentLike,
  interval: '5m' | '15m' = '15m',
) {
  const instId = String(instrument?.id ?? 'nifty50');
  const out: Record<string, unknown>[] = [];
  for (const [id, meta] of Object.entries(PRESETS)) {
    const plan5 = (analysis5.trade_plan as Record<string, unknown>) ?? {};
    const plan15 = (analysis15.trade_plan as Record<string, unknown>) ?? {};
    const opts = {
      ...presetOptionsForInstrument(id, instrument),
      analysis_5m: analysis5,
      analysis_15m: analysis15,
    };
    const pass5 = passes(analysis5, plan5, mtf, opts);
    const pass15 = passes(analysis15, plan15, mtf, opts);
    out.push({
      id,
      label: meta.label,
      description: meta.description,
      recommended: false,
      pass_5m: pass5.pass,
      pass_15m: pass15.pass,
      reasons_5m: pass5.reasons,
      reasons_15m: pass15.reasons,
    });
  }
  const rec = pickLiveRecommendedPreset(instId, interval, out);
  for (const row of out) row.recommended = row.id === rec;
  return out;
}

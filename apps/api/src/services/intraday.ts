import { buildLivePlaybook } from '@sv/intraday';

/** Demo intraday state — wire live Nifty 15m feed in a later phase. */
export function getNiftyIntradayState() {
  const plan = {
    ok: true,
    bias: 'long',
    bias_label: 'Long bias',
    time_stop_ist: '15:15',
    entry: { type: 'market', price: 24_850, condition: 'Pullback to VWAP support' },
    stop_loss: { price: 24_820, pts: 30, pct: 0.12, label: 'Structural stop' },
    exits: [
      { tier: 'T1', price: 24_880, rr: 1, action: 'Book 40%' },
      { tier: 'T2', price: 24_910, rr: 2, action: 'Book 40%' },
      { tier: 'T3', price: 24_940, rr: 3, action: 'Book 20%' },
    ],
    trigger: { status: 'WAIT', label: 'Awaiting trigger', distance_pts: 8, actionable: false },
    invalidation: '15m close below stop',
    trail: { trail_pts: 25, label: 'Trail after T2' },
  };

  const analysis = {
    ok: true,
    price: 24_842,
    interval: '15m',
    direction: 'bullish',
    confidence: 58,
    net_score: 22,
    bar_minutes_ist: 11 * 60 + 15,
    entry_window: { open: true, message: 'Entry window open until 14:45 IST' },
    setup_quality: { grade: 'B', score: 64 },
    session_regime: { key: 'lean_up', label: 'Mild up' },
    ema_stack_bull: true,
  };

  const analysis5 = {
    ok: true,
    price: 24_842,
    ema50: 24_835,
    sma9: 24_845,
    sma50: 24_838,
    gc9_active: true,
  };

  const mtf = { ok: true, aligned: true, deploy_pct: 72, conflict: false };
  const presetEval = [
    { id: 'cfa_precision', label: 'CFA Precision', pass_15m: false, reasons_15m: ['Entry trigger not actionable (WAIT)'] },
    { id: 'production', label: 'Production', pass_15m: true, reasons_15m: [] },
  ];

  const playbook = buildLivePlaybook(plan, analysis, analysis5, mtf, presetEval, 'cfa_precision', '15m');

  return {
    ok: true,
    index: 'NIFTY50',
    interval: '15m',
    analysis,
    analysis_5m: analysis5,
    mtf,
    plan,
    playbook,
    preset_eval: presetEval,
    server_time: new Date().toISOString(),
    note: 'MVP state — connect live 5m/15m Nifty feed for production radar.',
  };
}

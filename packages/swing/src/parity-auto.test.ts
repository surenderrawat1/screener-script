import { describe, expect, it } from 'vitest';
import {
  ACTION_BUY,
  ACTION_STRONG_BUY,
  categorizeHits,
  enrichHit,
  evaluatePositionAction,
  overlayOpenPositionsOnTiers,
  POS_CUT,
  POS_HOLD,
  POS_TIGHTEN,
  regimeGuidance,
} from './auto-decision.js';
import {
  checkAddPosition,
  POSITION_REFRESH_INTERVAL_SEC,
  scanInput,
  SCAN_INTERVAL_SEC,
  serializeHit,
  suggestedSharesForHit,
} from './auto-screener.js';
import { suggestedShares } from './portfolio-risk.js';

describe('swing auto parity', () => {
  it('scan input uses nifty250 and swing_rank', () => {
    const input = scanInput();
    expect(input.universe).toBe('nifty250');
    expect(input.sort_by).toBe('swing_rank');
    expect(input.rank_hits).toBe(true);
  });

  it('categorizes hits into tiers', () => {
    const hits = [
      { symbol: 'A', verdict: 'SETUP', strict_verdict: 'ENTER', broke_swing_high: true, ta_volume_ratio: 1.2 },
      { symbol: 'B', verdict: 'SETUP', strict_verdict: 'SETUP', broke_swing_high: false, ta_volume_ratio: 0.9 },
      { symbol: 'C', verdict: 'WATCH', strict_verdict: 'AVOID', broke_swing_high: true, ta_volume_ratio: 1.15 },
    ];
    const tiers = categorizeHits(hits, null, false);
    expect(tiers.strict_enter).toHaveLength(1);
    expect(tiers.setup_radar).toHaveLength(2);
    expect(tiers.breakout_surge).toHaveLength(2);
  });

  it('serializeHit includes decision score and suggested shares', () => {
    const hit = enrichHit(
      {
        symbol: 'A',
        verdict: 'SETUP',
        strict_verdict: 'ENTER',
        strict_enter_ready: true,
        r_multiple_ok: true,
        net_edge_ok: true,
        price: 100,
        stop_loss: 95,
        swing_rank: 70,
      },
      { bull: true },
    );
    const serialized = serializeHit(hit, { bull: true });
    expect(serialized.symbol).toBe('A');
    expect(serialized.broke_swing_high).toBe(false);
    expect(serialized.decision_score).toBeGreaterThan(0);
    expect(serialized.suggested_shares).toBeGreaterThan(0);
  });

  it('serializeHit blocks live Add for SETUP without strict ENTER', () => {
    const hit = enrichHit(
      {
        symbol: 'SETUPCO',
        verdict: 'SETUP',
        strict_verdict: 'SETUP',
        r_multiple_ok: true,
        net_edge_ok: true,
        price: 100,
        stop_loss: 95,
        swing_rank: 70,
        entry_score: 80,
      },
      { bull: true },
    );
    const row = serializeHit(hit, { bull: true });
    expect(row.add_allowed).toBe(false);
    expect(row.research_add_allowed).toBe(row.decision_action !== 'SKIP');
    expect(row.add_block_reasons.some((r) => /strict/i.test(r))).toBe(true);
  });

  it('refresh intervals match PHP', () => {
    expect(POSITION_REFRESH_INTERVAL_SEC).toBe(60);
    expect(SCAN_INTERVAL_SEC).toBe(300);
  });

  it('heat gate blocks add in strong bear', () => {
    const blocked = checkAddPosition(
      {
        symbol: 'TCS',
        entry_price: 4000,
        stop_loss: 3800,
        strict_verdict: 'ENTER',
        r_multiple_ok: true,
        net_edge_ok: true,
        strict_enter_ready: true,
      },
      [],
      { blocks_strict_enter: true, strong_bear: true },
    );
    expect(blocked.ok).toBe(false);
  });

  it('heat gate allows add in bull with room when Ch.93 gate passes', () => {
    const ok = checkAddPosition(
      {
        symbol: 'INFY',
        entry_price: 1500,
        stop_loss: 1425,
        strict_verdict: 'ENTER',
        r_multiple_ok: true,
        net_edge_ok: true,
        strict_enter_ready: true,
        decision_action: 'BUY',
        backtest_truth: {
          trades_closed: 20,
          win_rate_pct: 75,
          profit_factor: 1.6,
          expectancy_pct: 1.5,
          compounded_return_pct: 12,
          max_drawdown_pct: 8,
        },
      },
      [],
      { bull: true },
    );
    expect(ok.ok).toBe(true);
  });

  it('blocks live add when backtest evidence is missing or unproven', () => {
    const base = {
      symbol: 'INFY',
      entry_price: 1500,
      stop_loss: 1425,
      strict_verdict: 'ENTER',
      r_multiple_ok: true,
      net_edge_ok: true,
      strict_enter_ready: true,
      decision_action: 'BUY',
    };
    expect(checkAddPosition(base, [], { bull: true }).ok).toBe(false);
    expect(
      checkAddPosition(
        { ...base, backtest_truth: { trades_closed: 4, win_rate_pct: 100 } },
        [],
        { bull: true },
      ).ok,
    ).toBe(false);
  });

  it('rejects SETUP live add without research_add', () => {
    const blocked = checkAddPosition(
      {
        symbol: 'XYZ',
        entry_price: 100,
        stop_loss: 95,
        strict_verdict: 'SETUP',
        r_multiple_ok: true,
        net_edge_ok: true,
        decision_action: 'BUY',
      },
      [],
      { bull: true },
    );
    expect(blocked.ok).toBe(false);
    expect(String(blocked.error)).toMatch(/strict|Ch\.93/i);
  });

  it('research_add allows SETUP with heat room', () => {
    const ok = checkAddPosition(
      {
        symbol: 'XYZ',
        entry_price: 100,
        stop_loss: 95,
        strict_verdict: 'SETUP',
        decision_action: 'BUY',
        research_add: true,
      },
      [],
      { bull: true },
    );
    expect(ok.ok).toBe(true);
    expect(ok.research_add).toBe(true);
  });

  it('suggested shares shrink in bear via deploy_scale × deploy_pct', () => {
    const hit = { price: 1000, stop_loss: 950, deploy_scale: 0.8 };
    const base = suggestedShares(1000, 950);
    const bear = suggestedSharesForHit(hit, { bear: true }, { deploy_pct: 70 });
    expect(bear).toBe(Math.max(1, Math.floor(base * 0.8 * 0.7)));
    expect(bear).toBeLessThan(base);
  });

  it('enrichHit high conviction and chase flags', () => {
    const hit = {
      symbol: 'TCS',
      verdict: 'SETUP',
      strict_verdict: 'ENTER',
      strict_enter_ready: true,
      entry_score: 92,
      swing_rank: 78,
      r_multiple_ok: true,
      ta_avg_value_cr: 30,
      volume_surge: true,
      broke_swing_high: true,
      ta_rsi14: 58,
      ta_pct_52w: 45,
      backtest_truth: {
        trades_closed: 20,
        win_rate_pct: 75,
        profit_factor: 1.6,
        expectancy_pct: 1.8,
        compounded_return_pct: 15,
        max_drawdown_pct: 7,
        grade: 'STRONG',
      },
    };
    const enriched = enrichHit(hit, { bull: true, key: 'bull' });
    expect(enriched.high_conviction).toBe(true);
    expect([ACTION_STRONG_BUY, ACTION_BUY]).toContain(enriched.decision_action);

    const chase = enrichHit({ ...hit, ta_rsi14: 78, ta_pct_52w: 92 }, { bear: true });
    expect(chase.risk_flags).toContain('RSI_CHASE');
  });

  it('evaluatePositionAction uses compounder hold book (ignores swing trim)', () => {
    const held = evaluatePositionAction(
      {
        exit_verdict: 'HOLD',
        gain_pct: 10,
        sessions_held: 15,
        entry_price: 100,
        current_price: 110,
        notes: 'sleeve:compounder',
        fundamental_quality_ok: true,
      },
      { sleeve: 'compounder', fundamental_quality_ok: true },
      { sideways: true },
    );
    expect(held.action).toBe(POS_HOLD);
    expect(held.reasons.some((r) => /min hold|compounder/i.test(r))).toBe(true);
  });

  it('evaluatePositionAction cut and tighten', () => {
    const cut = evaluatePositionAction({
      symbol: 'TCS',
      exit_verdict: 'HOLD',
      gain_pct: -5,
      sessions_held: 4,
      current_price: 95,
      active_stop: 92,
      position: { entry_price: 100, entry_date: '2025-01-01' },
    });
    expect(cut.action).toBe(POS_CUT);

    const tighten = evaluatePositionAction(
      {
        symbol: 'SUZLON',
        exit_verdict: 'HOLD',
        gain_pct: -2.5,
        sessions_held: 3,
        current_price: 48,
        effective_stop: 47.1,
        position: { entry_price: 52, entry_date: '2025-01-01' },
      },
      { high_conviction: true, decision_action: ACTION_BUY },
    );
    expect(tighten.action).toBe(POS_TIGHTEN);
  });

  it('overlayOpenPositionsOnTiers demotes held symbols', () => {
    const tiers = {
      high_conviction: [{ symbol: 'SUZLON', decision_action: 'BUY', add_allowed: true }],
      strict_enter: [{ symbol: 'SUZLON', decision_action: 'BUY', add_allowed: true }],
      setup_radar: [] as Record<string, unknown>[],
      breakout_surge: [] as Record<string, unknown>[],
    };
    const positions = [
      { symbol: 'SUZLON', position_action: POS_TIGHTEN, action_label: 'Tighten stop', stop_distance_pct: 1.5 },
    ];
    const overlay = overlayOpenPositionsOnTiers(tiers, positions);
    expect(overlay.high_conviction).toHaveLength(0);
    expect(overlay.strict_enter[0].already_held).toBe(true);
    expect(overlay.strict_enter[0].add_allowed).toBe(false);
  });

  it('strong bear halves deploy guidance', () => {
    expect(regimeGuidance({ blocks_strict_enter: true, strong_bear: true }).deploy_pct).toBe(50);
  });
});

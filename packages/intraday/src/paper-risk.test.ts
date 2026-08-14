import { describe, expect, it } from 'vitest';
import {
  PAPER_MAX_NOTIONAL_INR,
  PAPER_OPENING_BALANCE_INR,
  PAPER_SOURCE,
  PAPER_STRATEGY_PRESET,
  applySlippage,
  canOpenPaperTrade,
  chartCloseMatchesInstrument,
  isCompatibleMarkPrice,
  computePaperEquityRisk,
  computePaperSampleProgress,
  countPaperRegimeCloses,
  mergePaperRegimeCounts,
  PAPER_SAMPLE_MIN_PER_REGIME,
  sizePaperShares,
  summarizePaperProof,
} from './paper-risk.js';

describe('paper-risk', () => {
  it('rejects NIFTYBEES-scale marks against Nifty index entries', () => {
    expect(isCompatibleMarkPrice(24359.22, 277.8)).toBe(false);
    expect(isCompatibleMarkPrice(24359.22, 24380)).toBe(true);
    expect(chartCloseMatchesInstrument('NIFTY50', 277.8)).toBe(false);
    expect(chartCloseMatchesInstrument('NIFTY50', 24359)).toBe(true);
    expect(chartCloseMatchesInstrument('BANKNIFTY', 600)).toBe(false);
    expect(chartCloseMatchesInstrument('SENSEX', 860)).toBe(false);
    expect(chartCloseMatchesInstrument('SENSEX', 86159)).toBe(true);
    expect(chartCloseMatchesInstrument('FINNIFTY', 33)).toBe(false);
    expect(chartCloseMatchesInstrument('FINNIFTY', 26598)).toBe(true);
    expect(chartCloseMatchesInstrument('TCS', 3200)).toBe(true);
  });

  it('funds default opening balance at 1 lakh', () => {
    expect(PAPER_OPENING_BALANCE_INR).toBe(100_000);
  });

  it('locks Stratzy paper proof to ma20_stratzy', () => {
    expect(PAPER_STRATEGY_PRESET).toBe('ma20_stratzy');
  });

  it('routes Stratzy paper to Nifty + Bank Nifty 15m index book', async () => {
    const { PAPER_STRATZY_INSTRUMENT_IDS, PAPER_STRATZY_INTERVAL } = await import('./paper-risk.js');
    const { stratzyPaperInstrumentIds } = await import('./instruments.js');
    expect(PAPER_STRATZY_INTERVAL).toBe('15m');
    expect([...PAPER_STRATZY_INSTRUMENT_IDS]).toEqual(['nifty50', 'banknifty']);
    expect(stratzyPaperInstrumentIds()).toEqual(['nifty50', 'banknifty']);
  });

  it('pauses Stratzy paper when index proof is uneconomic', async () => {
    const { stratzyPaperEconomicPauseReasons } = await import('./paper-risk.js');
    expect(stratzyPaperEconomicPauseReasons({ trades: 5, expectancy_inr: -10, profit_factor: 0.8 })).toEqual(
      [],
    );
    const paused = stratzyPaperEconomicPauseReasons({
      trades: 12,
      expectancy_inr: -5,
      profit_factor: 0.9,
    });
    expect(paused.length).toBeGreaterThan(0);
    expect(paused[0]).toMatch(/expectancy/i);
    expect(
      stratzyPaperEconomicPauseReasons({ trades: 12, expectancy_inr: 20, profit_factor: 1.4 }),
    ).toEqual([]);
  });

  it('caps notional at 30k and respects 1% risk', () => {
    const sized = sizePaperShares({
      entryPrice: 1000,
      stopLoss: 980,
      equityInr: PAPER_OPENING_BALANCE_INR,
    });
    // risk budget ₹1000 / ₹20 = 50 shares; notional cap 30 shares
    expect(sized.shares).toBe(30);
    expect(sized.notional).toBeLessThanOrEqual(PAPER_MAX_NOTIONAL_INR);
  });

  it('blocks when max positions reached', () => {
    const gate = canOpenPaperTrade({
      openCount: 10,
      heatPct: 0,
      newRiskInr: 500,
      equityInr: 100_000,
      cashBalance: 100_000,
      notional: 10_000,
      sessionDayRealizedPnl: 0,
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/Max open/);
  });

  it('applies adverse slippage on long entry', () => {
    const px = applySlippage(100, 'long', true);
    expect(px).toBeGreaterThan(100);
  });

  it('summarizes Stratzy paper proof scorecard', () => {
    const s = summarizePaperProof([
      { realized_pnl: 500, source: PAPER_SOURCE, evidence: { preset: PAPER_STRATEGY_PRESET } },
      { realized_pnl: -200, source: PAPER_SOURCE, evidence: { preset: PAPER_STRATEGY_PRESET } },
      { realized_pnl: 100, source: PAPER_SOURCE, evidence: { preset: PAPER_STRATEGY_PRESET } },
      { realized_pnl: 50, source: PAPER_SOURCE, evidence: { preset: PAPER_STRATEGY_PRESET } },
      { realized_pnl: -10, source: PAPER_SOURCE, evidence: { preset: PAPER_STRATEGY_PRESET } },
    ]);
    expect(s.trades).toBe(5);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.win_rate_pct).toBe(60);
    expect(s.net_pnl_inr).toBe(440);
    expect(s.expectancy_inr).toBe(88);
    expect(s.profit_factor).toBe(3.1); // 650 / 210
    expect(s.stratzy_trades).toBe(5);
    expect(s.sample_ok).toBe(true);
    expect(s.by_regime.find((r) => r.regime === 'unknown')?.trades).toBe(5);
  });

  it('slices paper proof expectancy and PF by entry regime', () => {
    const s = summarizePaperProof([
      { realized_pnl: 300, notional_inr: 10_000, evidence: { regime_key: 'bull' } },
      { realized_pnl: -100, notional_inr: 10_000, evidence: { regime_key: 'bull' } },
      { realized_pnl: 50, notional_inr: 10_000, evidence: { regime: { key: 'sideways' } } },
      { realized_pnl: -200, notional_inr: 10_000, evidence: { regime_key: 'bear' } },
    ]);
    const bull = s.by_regime.find((r) => r.regime === 'bull')!;
    expect(bull.trades).toBe(2);
    expect(bull.expectancy_inr).toBe(100);
    expect(bull.profit_factor).toBe(3);
    expect(bull.expectancy_pct).toBe(1);
    const bear = s.by_regime.find((r) => r.regime === 'bear')!;
    expect(bear.trades).toBe(1);
    expect(bear.profit_factor).toBe(0);
    expect(s.expectancy_inr).toBe(12.5);
  });

  it('computes max DD and downside deviation on equity curve', () => {
    const risk = computePaperEquityRisk(100_000, [
      { realized_pnl: 2_000, closed_at: '2024-01-01' },
      { realized_pnl: -5_000, closed_at: '2024-01-02' },
      { realized_pnl: -3_000, closed_at: '2024-01-03' },
      { realized_pnl: 1_000, closed_at: '2024-01-04' },
    ]);
    // Peak 102k → trough 94k → DD 8k / 102k ≈ 7.84%
    expect(risk.max_drawdown_inr).toBe(8000);
    expect(risk.max_drawdown_pct).toBe(7.84);
    expect(risk.equity_end_inr).toBe(95_000);
    expect(risk.downside_deviation_pct).not.toBeNull();
    expect(risk.downside_deviation_pct!).toBeGreaterThan(0);
    expect(risk.rolling_window_trades).toBe(4);
  });

  it('rolling max DD uses last N trades only', () => {
    const risk = computePaperEquityRisk(
      100_000,
      [
        { realized_pnl: -20_000, closed_at: '2024-01-01' },
        { realized_pnl: 5_000, closed_at: '2024-01-02' },
        { realized_pnl: 5_000, closed_at: '2024-01-03' },
        { realized_pnl: -1_000, closed_at: '2024-01-04' },
      ],
      2,
    );
    // Last 2: start 85k (= end − sum), +5k→90k, −1k→89k → DD 1k / 90k ≈ 1.11%
    expect(risk.rolling_window_trades).toBe(2);
    expect(risk.rolling_max_drawdown_pct).toBe(1.11);
    expect(risk.max_drawdown_pct).toBe(20);
  });

  it('tracks CFA paper sample progress toward 30/50', () => {
    const covered = { bull: 10, sideways: 10, bear: 10, unknown: 0 };
    const early = computePaperSampleProgress({
      current_closed_trades: 12,
      archived_closed_trades: 5,
      regime_counts: covered,
    });
    expect(early.total_trades).toBe(17);
    expect(early.min_ready).toBe(false);
    expect(early.status).toBe('insufficient');

    const mid = computePaperSampleProgress({
      current_closed_trades: 10,
      archived_closed_trades: 25,
      regime_counts: covered,
    });
    expect(mid.min_ready).toBe(true);
    expect(mid.target_ready).toBe(false);
    expect(mid.status).toBe('minimum_met');
    expect(mid.cycle_ready).toBe(true);

    const done = computePaperSampleProgress({
      current_closed_trades: 20,
      archived_closed_trades: 35,
      regime_counts: { bull: 20, sideways: 20, bear: 15 },
    });
    expect(done.target_ready).toBe(true);
    expect(done.status).toBe('target_met');
  });

  it('blocks sample readiness until bull/sideways/bear each meet min_per_regime', () => {
    const headcountOnly = computePaperSampleProgress({
      current_closed_trades: 40,
      archived_closed_trades: 10,
      regime_counts: { bull: 40, sideways: 10, bear: 0 },
    });
    expect(headcountOnly.total_trades).toBe(50);
    expect(headcountOnly.cycle_ready).toBe(false);
    expect(headcountOnly.min_ready).toBe(false);
    expect(headcountOnly.target_ready).toBe(false);
    expect(headcountOnly.cycle_gaps.some((g) => g.startsWith('bear'))).toBe(true);
    expect(headcountOnly.summary).toContain('cycle coverage');
  });

  it('counts entry regime stamps from evidence', () => {
    const counts = countPaperRegimeCloses([
      { evidence: { regime_key: 'bull' } },
      { evidence: { regime: { key: 'bear' } } },
      { evidence: { regime_key: 'neutral' } },
      { evidence: {} },
    ]);
    expect(counts).toEqual({ bull: 1, sideways: 1, bear: 1, unknown: 1 });
    expect(mergePaperRegimeCounts(counts, { bull: 2 }).bull).toBe(3);
    expect(PAPER_SAMPLE_MIN_PER_REGIME).toBe(5);
  });
});

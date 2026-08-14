import { describe, expect, it } from 'vitest';
import {
  flattenClosedTradesForAnalysis,
  INTRADAY_STRATZY_PRESET,
  INTRADAY_STRATZY_SOURCE,
  isIntradayStratzyPosition,
  isSwingPaperPosition,
  mapPositionRow,
  tradesToCsv,
  type StratzyPaperExportBundle,
} from './stratzy-paper-export.js';
import { SWING_PAPER_SOURCE } from './swing-paper-trader.js';

describe('stratzy-paper-export', () => {
  it('identifies intraday Stratzy positions', () => {
    expect(isIntradayStratzyPosition('paper_auto', { preset: 'ma20_stratzy' })).toBe(true);
    expect(isIntradayStratzyPosition('other', { preset: 'ma20_stratzy' })).toBe(true);
    expect(isIntradayStratzyPosition('other', { preset: 'production' })).toBe(false);
  });

  it('identifies swing paper positions', () => {
    expect(isSwingPaperPosition('swing_paper_auto')).toBe(true);
    expect(isSwingPaperPosition('paper_auto')).toBe(false);
  });

  it('flattens closed trades for CSV analysis', () => {
    const bundle = {
      exported_at: '2026-01-01',
      restrictions: 'none — full DB export for analysis',
      intraday_source: INTRADAY_STRATZY_SOURCE,
      intraday_preset: INTRADAY_STRATZY_PRESET,
      swing_source: SWING_PAPER_SOURCE,
      users: [
        {
          user_id: 'u1',
          email: 'a@b.com',
          wallet: null,
          swing_paper_armed: false,
          swing_paper_period: null,
          swing_paper_archives: [],
          intraday_stratzy: {
            open: [],
            closed: [
              mapPositionRow({
                id: 'p1',
                userId: 'u1',
                walletId: 'w1',
                instrumentId: 'nifty50',
                symbol: 'NIFTY',
                instrumentLabel: 'Nifty',
                status: 'closed',
                side: 'long',
                timeframe: '15m',
                quantity: 1,
                originalQty: 1,
                remainingPct: 0,
                t1Booked: true,
                t2Booked: false,
                breakevenArmed: true,
                entryPrice: 100,
                entryTime: new Date('2026-01-02T04:00:00Z'),
                sessionDate: new Date('2026-01-02'),
                stopLoss: 99,
                effectiveStop: 100,
                targetT1: 101,
                targetT2: 102,
                targetT3: 103,
                notionalInr: 100,
                reservedCash: 0,
                realizedPnl: 50,
                feesInr: 5,
                closedAt: new Date('2026-01-02T10:00:00Z'),
                closedPrice: 101,
                closedReason: 'PARTIAL_T1',
                source: 'paper_auto',
                evidence: { preset: 'ma20_stratzy', regime_key: 'bull' },
                createdAt: new Date('2026-01-02T04:00:00Z'),
                updatedAt: new Date('2026-01-02T10:00:00Z'),
              }),
            ],
            all: [],
            proof_all_closed: { trades: 1, wins: 1, losses: 0, win_rate_pct: 100, net_pnl_inr: 50, expectancy_inr: 50, profit_factor: null, stratzy_trades: 1, sample_ok: false, by_regime: [] },
            proof_open_count: 0,
          },
          swing_paper: {
            open: [],
            closed: [],
            all: [],
            proof_all_closed: { trades: 0, wins: 0, losses: 0, win_rate_pct: null, net_pnl_inr: 0, expectancy_inr: null, profit_factor: null, stratzy_trades: 0, sample_ok: false, by_regime: [] },
            proof_open_count: 0,
          },
        },
      ],
      totals: {
        intraday_stratzy_positions: 1,
        intraday_stratzy_closed: 1,
        swing_paper_positions: 0,
        swing_paper_closed: 0,
        orders: 0,
        fills: 0,
        ledger_entries: 0,
      },
    } satisfies StratzyPaperExportBundle;
    const flat = flattenClosedTradesForAnalysis(bundle);
    expect(flat).toHaveLength(1);
    expect(flat[0].book).toBe('intraday_stratzy');
    expect(flat[0].preset).toBe('ma20_stratzy');
    const csv = tradesToCsv(flat);
    expect(csv.split('\n').length).toBe(2);
  });
});

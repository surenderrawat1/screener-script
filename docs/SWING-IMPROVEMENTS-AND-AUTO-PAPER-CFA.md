# Swing Trading and Swing Auto Radar — CFA Improvement and Paper-Trading Standard

## Learning Objectives

After reading this document, you should be able to:

- distinguish signal accuracy from economic profitability;
- apply portfolio-level risk limits to Swing Auto Radar;
- explain why non-overlapping walk-forward trades are required;
- understand the automatic live paper-entry and paper-exit gates; and
- interpret paper results without treating them as evidence of future returns.

## Introduction

Swing Auto Radar is suitable for disciplined research and paper execution only when signal selection, position sizing, portfolio heat, execution costs, and exit rules are evaluated together. A reported win rate above 70% is not sufficient on its own. The sample must be large enough, trades must be non-overlapping, expectancy must be positive, and profit factor must remain acceptable after realistic exits.

This review approves the system for **automatic live paper trading**, subject to the controls in this document. It does not approve broker connectivity or live-money execution.

## Core Concepts

### CFA Assessment

| Area | Assessment | Required standard |
|---|---|---|
| Entry discipline | Strong | Strict ENTER, 3R geometry, net edge, fresh data |
| Exit discipline | Strong after modification | X1–X9 simulator and live position refresh |
| Backtest validity | Improved | Non-overlapping trades with actual exit simulation |
| Accuracy gate | Economic-edge first | Expectancy >0, PF≥1.25, compound≥0, max DD≤20%; soft WR≥70% diagnostic only; ≥10 trades for paper |
| Portfolio risk | Strong | ≤1% risk/trade, 4% heat, 10-position cap |
| Execution realism | Adequate for paper | Market fill, slippage and fee estimate |
| Regime control | Strong | Strong-bear entry block and deploy scaling |
| Automation safety | Strong | Separate Swing arm, stale-snapshot block, idempotent orders |
| Live-money readiness | Not approved | Requires out-of-sample proof and operational controls |

### Implemented Improvements

1. **Dedicated Swing paper arm:** Swing automation can be enabled independently of intraday paper automation.
2. **Strict automatic entry gate:** Only fresh High Conviction / Strict ENTER candidates are eligible. 3R geometry and ≥70% WR are soft diagnostics for paper (recorded, not hard blockers).
3. **Evidence gate:** At least 10 completed backtest trades (hard). Soft WR ≥70% is diagnostic only. Maximum 2 new paper positions per worker tick.
4. **Walk-forward correction:** Backtest truth now uses non-overlapping strict-ENTER simulated trades rather than overlapping SETUP+ forward windows.
5. **Conservative daily-bar handling:** When stop and target occur in the same daily bar, the stop is assumed to occur first.
6. **Portfolio controls:** Position sizing is stop-based, with 1% maximum equity risk, ₹30,000 notional cap, 4% heat and 10 total open paper positions.
7. **Automatic exit management:** Open Swing paper positions are re-evaluated with live price, daily bars, hourly confirmation, regime and X1–X9 exits.
8. **Execution isolation:** Intraday end-of-session logic now manages only intraday paper positions and cannot force-close Swing paper positions.
9. **Audit trail:** Paper orders, fills, cash ledger and signal evidence are stored in PostgreSQL.
10. **Freshness and idempotency:** Entries require a snapshot no older than 15 minutes; repeat worker ticks cannot duplicate the same order.
11. **Server-owned evidence:** Check-add re-fetches the radar hit and backtest truth server-side; client-supplied backtest data cannot approve an entry.
12. **Direct-create protection:** `auto_radar` position creation is revalidated server-side, while explicitly labeled `research_radar` journal rows remain separate.

### Remaining Improvements Before Live Money

- Accumulate at least 30–50 independent out-of-sample paper trades across bull, sideways and bear regimes. **Tracked** — `sample` on Swing paper state / Dashboard (`computePaperSampleProgress`: min 30, target 50, ≥5 closes per bull/sideways/bear; entry `regime_key` stamped on paper evidence; archives store `regime_counts`). Period `proof.by_regime` reports expectancy / profit factor / net by entry regime.
- **Compounder / position sleeve (research)** — **Done (routing + paper gate + hold book)** — quality names with failed swing ENTER edge + strong buy&hold are flagged `sleeve=compounder`; HC stripped and Swing paper hard-blocked; Auto **Compounder** tier + `evaluateCompounderHold` (min 60 sessions, ignore X2/trim, exit on quality break / catastrophic −25%, review on ≥35% peak DD). Journal notes stamp `sleeve:compounder`. Use `pos_moat_compounders` / moat presets. BT truth includes `buy_hold_pct` (`bt_truth:v8-compounder-sleeve`).
- Add rolling maximum drawdown and downside deviation to the paper dashboard. **Done** — `computePaperEquityRisk` on Swing paper state (`risk.max_drawdown_pct`, `rolling_max_drawdown_pct`, `downside_deviation_pct`).
- Add sector concentration limits, such as no more than 25% notional in one sector. **Done** — `MAX_SECTOR_NOTIONAL_PCT=25` on live Add (`checkAddPosition`) and Swing paper auto-entry.
- Add a paper-wallet reset/archive workflow for clearly separated evaluation periods. **Done** — `POST /api/v1/swing/paper/archive` snapshots period proof/risk, starts a new period; optional `reset_wallet` restores opening cash when the book is flat.
- Replace simplified fees with the exact broker, STT, exchange, GST and stamp-duty model. **Done** — `estimateFillCharges` (delivery for Swing, intraday for Stratzy paper): brokerage ₹20/order, STT, stamp (buy), NSE txn, SEBI, GST on services, DP on delivery sell.
- Add alerting for stale quotes, worker downtime, rejected writes and abnormal price gaps. **Done** — `GET /api/v1/ops/alerts` + Dashboard Ops alerts card (`evaluateOpsAlerts` / `collectOpsAlerts`).
- Introduce a broker adapter only after formal approval; keep paper and live credentials physically separate.

## Formula & Explanation

### Position Size

```text
Risk budget = Paper equity × 1%
Risk per share = Entry price − Stop-loss price
Shares by risk = floor(Risk budget ÷ Risk per share)
Final shares = min(Shares by risk, floor(₹30,000 ÷ Entry price))
```

### Portfolio Heat

```text
Portfolio heat = Σ[(Entry − Effective stop) × Shares] ÷ Paper equity
```

New positions are blocked when portfolio heat is at or above 4%, or when the proposed trade would breach the permitted heat boundary.

### Expectancy

```text
Expectancy = (Win rate × Average win) + (Loss rate × Average loss)
```

Average loss is entered as a negative number. A 70% win rate with very small wins and large losses can still produce negative expectancy.

### Profit Factor

```text
Profit factor = Gross profits ÷ Absolute gross losses
```

The automatic Swing paper gate requires a profit factor of at least 1.25.

## Visual Guide

```text
Fresh Swing Auto snapshot
          ↓
High Conviction + Strict ENTER (fresh)?
          ↓ yes
≥10 BT trades (hard)? Soft 3R / soft WR≥70% recorded only
          ↓ yes
Cash, position-count and heat gates pass?
          ↓ yes
Create paper order (max 2 opens / tick)
          ↓
Worker evaluates X1–X9 exits every minute
          ↓
Close paper position and record realized P&L
```

## Worked Example — Indian Market

Assume the paper wallet has ₹1,00,000 equity and Swing Auto Radar identifies TCS:

- live paper entry: ₹4,000;
- stop-loss: ₹3,900;
- target: ₹4,300;
- risk per share: ₹100;
- risk budget: ₹1,000; and
- shares by risk: 10.

The notional is ₹40,000, which exceeds the ₹30,000 cap. Shares by notional are `floor(30,000 ÷ 4,000) = 7`. The paper order is therefore limited to seven shares, with ₹700 initial risk.

The order is still rejected if TCS fails the backtest evidence gate, the snapshot is stale, the market is in a strong-bear block, or portfolio heat is too high.

## Real World Example

A strategy with an 80% win rate can lose money if eight trades earn 1% each and two trades lose 6% each:

```text
Gross gains = 8 × 1% = 8%
Gross losses = 2 × 6% = 12%
Net before compounding and costs = −4%
```

This is why Swing paper entry requires positive expectancy and a minimum profit factor in addition to the 70% accuracy threshold.

## Case Study

An earlier walk-forward report counted a qualifying signal on several consecutive sessions and measured each signal’s return 20 sessions later. Those outcomes overlapped and were not independent. A stopped trade could also appear profitable if the share recovered before the twentieth session.

The revised method opens one simulated trade at a time and applies the strategy’s exit engine. It waits until the prior trade and cooldown are complete before accepting another signal. This generally reduces trade count and may reduce reported win rate, but the resulting evidence is more decision-useful.

## CFA Exam Tip

Win rate is not a complete performance measure. Evaluate expected return, payoff ratio, variance, drawdown, sample size and transaction costs. High hit rates can coexist with negative expected value.

## Common Mistakes

- Treating a 70% backtest win rate as a guarantee.
- Counting overlapping forward-return windows as independent trades.
- Ignoring same-bar stop/target ambiguity in daily data.
- Sizing from conviction instead of stop distance.
- Using the original stop after a valid trailing stop has ratcheted upward.
- Arming automation without confirming the worker, database and price feed are healthy.
- Mixing paper results with manually entered or live-money positions.
- Evaluating only one market regime.

## Key Takeaways

- Swing Auto Radar is approved for controlled automatic paper trading, not live-money execution.
- A paper entry requires Strict ENTER, fresh data, valid risk/reward and proven backtest quality.
- The primary gate is economic edge (Expectancy → compound → max DD → PF). Soft WR ≥70% is diagnostic only.
- Walk-forward exit simulation books a **scaled 40/40/20 book at 1R/2R/3R** (breakeven after T1) with X1–X9 on the runner — not all-or-nothing at the frozen 3R target.
- Paper trades share a ₹1 lakh test wallet and are governed by cash, heat and position-count limits.
- Paper performance must be accumulated out of sample before any live-money decision.

## Practice Questions

1. Why is an 80% win rate not enough to approve a strategy?
2. What is the maximum initial rupee risk per trade for a ₹1,00,000 paper wallet?
3. Why does the backtest assume stop-first when both stop and target print in one daily bar?
4. Which four backtest evidence conditions must an automatic Swing paper candidate satisfy?
5. Does arming Swing paper trading authorize broker orders?

## Answer Key

1. Payoff asymmetry, costs, sample size and drawdown can make a high-win-rate strategy unprofitable.
2. ₹1,000, subject to the lower ₹30,000 notional constraint.
3. Daily OHLC does not reveal event order; stop-first is the conservative assumption.
4. At least 10 completed trades plus economic edge: expectancy >0, PF ≥1.25, compound ≥0, max DD ≤20%.
5. No. The implementation writes only to the internal paper wallet and database ledger.

## FAQ

### When does the worker enter a Swing paper position?

Only during an open NSE session, from a Swing Auto snapshot no older than 15 minutes, while the separate Swing paper switch is armed.

### How often are positions evaluated?

The worker ticks every 60 seconds. Swing exits use current price plus the daily and hourly rule context.

### Are positions closed at the end of the day?

No. Swing paper positions remain open overnight. Intraday session-close logic is source-filtered and cannot close them.

### Why might no paper trade be opened?

No current candidate may satisfy all strict entry, backtest, regime, freshness, cash and heat requirements. No trade is a valid risk decision.

### Is 10 trades statistically conclusive?

No. Ten is only the minimum automatic paper-entry gate. Live-money consideration should require a larger independent out-of-sample sample, preferably 30–50 or more trades across regimes.

## Related Topics

- [Swing Auto Radar](./SWING-AUTO.md)
- [Detailed Swing Auto Rules Verification](./SWING-AUTO-RADAR-RULES-CFA-VERIFICATION.md)
- [Swing Position Management](./SWING-POSITIONS.md)
- [Swing Auto CFA Verification](./SWING-AUTO-CFA-VERIFICATION.md)
- [Intraday Paper Wallet](./INTRADAY-PAPER.md)

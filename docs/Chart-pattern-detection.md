# Chart Pattern Detection — AI Development Prompt

> **MVP shipped (Aug 2026):** Daily reversals, triangles/wedges, flags/pennants, cup & handle, rounding patterns, **rectangle & price channel**, **daily+5m+15m+1H+4H+weekly MTF**, **RSI/MACD confidence boost**, **toggleable chart overlays** (levels + swing markers + structure lines), walk-forward stats, **PostgreSQL persistence** (snapshots + feed API + daily scan).
>
> **Accuracy pass (Aug 2026):** Mandatory volume for `confirmed` (configurable), failed-breakout demotion, EMA-21/SMA-50 trend context in confidence, min R:R floor (1.5), doc §9 weighted confidence, tighter RSI/MACD thresholds, 4H MTF detection wired, twin-peak scan allows one noise swing.

Build a **Chart Pattern Detection module** that analyzes historical OHLCV stock data and automatically identifies bullish, bearish, and neutral technical chart patterns.

## 1. Objective

Given a stock's historical:

* Open
* High
* Low
* Close
* Volume
* Date/Time

detect chart patterns automatically and display:

1. Pattern name
2. Pattern type
3. Detection date
4. Pattern formation range
5. Breakout/breakdown level
6. Current status
7. Target price
8. Stop-loss level
9. Confidence score
10. Supporting technical indicators

The system must avoid claiming that a pattern is confirmed unless the required confirmation conditions are satisfied.

## 2. Patterns to Detect

### Bullish Patterns

* Double Bottom
* Inverse Head & Shoulders
* Ascending Triangle
* Bull Flag
* Bull Pennant
* Cup & Handle
* Falling Wedge
* Rounding Bottom

### Bearish Patterns

* Double Top
* Head & Shoulders
* Descending Triangle
* Bear Flag
* Bear Pennant
* Rising Wedge
* Rounding Top

### Continuation / Neutral Patterns

* Symmetrical Triangle
* Rectangle
* Consolidation
* Channel
* Flag
* Pennant

## 3. Detection Algorithm

Do not rely on simple visual similarity.

Use a combination of:

* Swing High detection
* Swing Low detection
* Local maxima/minima
* Trendline calculation
* Support/resistance levels
* Price distance thresholds
* Pattern symmetry
* Volume confirmation
* Breakout/breakdown confirmation
* ATR-based volatility
* Moving averages
* RSI
* MACD

Use configurable parameters rather than hard-coded thresholds.

Example configuration:

```text
swing_lookback = 5
min_pattern_bars = 20
max_pattern_bars = 150
price_tolerance = 2%
breakout_buffer = 0.5%
volume_confirmation_multiplier = 1.2
```

## 4. Swing Point Detection

First identify significant swing highs and swing lows.

Example:

```text
Swing High:
High[i] > High[i-n ... i-1]
AND
High[i] > High[i+1 ... i+n]

Swing Low:
Low[i] < Low[i-n ... i-1]
AND
Low[i] < Low[i+1 ... i+n]
```

Filter insignificant swings using ATR or percentage movement so that market noise does not create false patterns.

## 5. Pattern Detection

### Double Bottom

Detect:

```text
Low 1
   ↓
Recovery
   ↑
Neckline
   ↓
Low 2
   ↑
Breakout
```

Requirements:

* Two significant lows
* Lows should be reasonably close in price
* A meaningful recovery between the lows
* Second low should not significantly violate the first low
* Neckline must be identifiable
* Pattern becomes confirmed only after neckline breakout

Target:

```text
Target = Neckline + (Neckline - Pattern Low)
```

### Double Top

Requirements:

* Two significant highs
* Highs reasonably close in price
* Meaningful decline between them
* Neckline/support level
* Confirmation only after neckline breakdown

Target:

```text
Target = Neckline - (Pattern High - Neckline)
```

### Head & Shoulders

Detect:

```text
Left Shoulder
       ↓
      Head
       ↓
Right Shoulder
```

Requirements:

* Three major peaks
* Middle peak is highest
* Left and right shoulders are reasonably similar
* Neckline calculated from intervening lows
* Confirmation after neckline breakdown

### Inverse Head & Shoulders

Opposite logic:

```text
Left Shoulder
       ↑
      Head
       ↑
Right Shoulder
```

Confirm after neckline breakout.

## 6. Triangle Detection

Detect:

### Ascending Triangle

* Flat/near-flat resistance
* Rising support trendline
* Decreasing price range
* Breakout above resistance

### Descending Triangle

* Flat/near-flat support
* Falling resistance trendline
* Decreasing price range
* Breakdown below support

### Symmetrical Triangle

* Lower highs
* Higher lows
* Converging trendlines
* Breakout in either direction

## 7. Wedge Detection

### Rising Wedge

* Higher highs
* Higher lows
* Both trendlines rising
* Trendlines converging
* Bearish breakdown confirmation

### Falling Wedge

* Lower highs
* Lower lows
* Both trendlines falling
* Trendlines converging
* Bullish breakout confirmation

## 8. Breakout Confirmation

Do not mark a pattern as confirmed merely because price touches a trendline.

Require:

```text
Close > Resistance + Breakout Buffer
```

for bullish breakouts.

For bearish breakdowns:

```text
Close < Support - Breakdown Buffer
```

Optionally require:

```text
Volume > Average Volume × Volume Confirmation Multiplier
```

Allow the user to configure whether volume confirmation is mandatory.

## 9. Confidence Score

Calculate a score from 0–100.

Example:

```text
Pattern Geometry       30%
Breakout Confirmation  20%
Volume Confirmation    15%
Trend Confirmation     15%
Support/Resistance     10%
RSI/MACD Confirmation  10%
```

Display:

```text
Pattern: Double Bottom
Direction: Bullish
Status: Confirmed
Confidence: 87%
Breakout: ₹1,245
Target: ₹1,310
Stop Loss: ₹1,205
```

Use labels:

```text
0–49   = Weak
50–69  = Moderate
70–84  = Strong
85–100 = Very Strong
```

## 10. False Positive Protection

The detector should reject patterns when:

* Pattern is too small
* Pattern duration is too short
* Swing points are insignificant
* Trendlines do not converge where required
* Peaks/valleys are too irregular
* Breakout is not confirmed
* Volume is extremely weak
* Pattern overlaps heavily with another invalid pattern

Do not generate a pattern simply because a few candles visually resemble it.

## 11. Chart Visualization

Overlay detected patterns directly on the candlestick chart.

Show:

* Pattern boundary
* Swing points
* Support line
* Resistance line
* Neckline
* Breakout point
* Target
* Stop-loss
* Pattern label
* Confidence score

Example:

```text
              Target
                ↑
                │
Resistance ─────┼────────
          \     │
           \___/│
           Pattern
                ↑
             Breakout
```

Allow users to toggle each overlay on/off. **Shipped:** per-pattern “Show on chart” checkbox on Stock Details; support/resistance/breakout/target/stop lines, **swing point markers**, and **neckline/boundary segments** for enabled patterns.

## 12. Multiple Timeframes

Support:

* 5 Minute
* 15 Minute
* 30 Minute
* 1 Hour
* 4 Hour
* Daily
* Weekly
* Monthly

Detect patterns independently for each timeframe.

Also provide:

```text
Multi-Timeframe Confirmation
```

Example:

```text
Daily:   Bullish Double Bottom — Confirmed
Weekly:  Bullish Trend — Strong
4 Hour:  Bullish Breakout — Confirmed

Overall Signal: Bullish
Confidence: 91%
```

## 13. API Response

Return structured data similar to:

```json
{
  "pattern": "Double Bottom",
  "type": "bullish",
  "status": "confirmed",
  "confidence": 87,
  "timeframe": "1D",
  "start_date": "2026-06-15",
  "end_date": "2026-08-10",
  "support": 1205,
  "resistance": 1245,
  "breakout": 1245,
  "target": 1310,
  "stop_loss": 1205,
  "volume_confirmed": true,
  "points": {
    "low_1": 1208,
    "neckline": 1245,
    "low_2": 1212
  }
}
```

## 14. Historical Backtesting

Include a backtesting mode.

For every detected pattern calculate:

* Number of occurrences
* Successful breakouts
* Failed breakouts
* Target hit %
* Stop-loss hit %
* Average return
* Maximum favorable excursion
* Maximum adverse excursion
* Average time to target

Example:

```text
Double Bottom — Daily

Patterns Detected: 126
Confirmed Breakouts: 98
Target Hit: 71
Stop Loss Hit: 27
Success Rate: 72.4%
Average Return: +8.6%
```

## 15. Important Rules

* Never guarantee future price movement.
* Clearly distinguish **forming**, **breakout**, and **confirmed** patterns.
* Use historical data only for detection.
* Prevent look-ahead bias during backtesting.
* Do not use future candles to confirm a signal that would not have been known at that historical point.
* Make all thresholds configurable.
* Write unit tests for every pattern detector.
* Handle missing candles and insufficient historical data gracefully.
* Optimize the algorithm so it can scan thousands of stocks efficiently.

## 16. Deliverables

Build:

1. Pattern detection engine
2. Pattern-specific detection algorithms
3. Confidence scoring engine
4. Breakout confirmation engine
5. Multi-timeframe analysis
6. Chart visualization
7. Pattern API
8. Historical backtesting
9. Pattern detection database tables — **shipped:** `chart_pattern_snapshots`, `chart_pattern_detections`, `chart_pattern_scan_runs`; daily sync step `scan_chart_patterns`; APIs `GET /api/v1/stock/:symbol/patterns/stored` and `GET /api/v1/chart-patterns/feed`.
10. Unit/integration tests
11. Configuration for detection thresholds
12. Clear documentation explaining each detection rule

The final implementation should be production-ready, modular, testable, and designed so that additional chart patterns can be added without rewriting the existing detection engine.

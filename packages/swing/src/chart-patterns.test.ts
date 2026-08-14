import { describe, expect, it } from 'vitest';
import {
  detectChartPatterns,
  detectSwingPoints,
  resampleBarsToWeekly,
  DEFAULT_PATTERN_CONFIG,
} from './chart-patterns.js';
import type { OhlcBar } from './types.js';

function bar(time: string, open: number, high: number, low: number, close: number, volume = 1_000_000): OhlcBar {
  return { time, open, high, low, close, volume };
}

/** Build a flat path then inject a clear double-bottom shape. */
function doubleBottomSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  let day = 1;
  const push = (o: number, h: number, l: number, c: number, v = 1_000_000) => {
    const d = String(day).padStart(2, '0');
    bars.push(bar(`2025-01-${d}`, o, h, l, c, v));
    day += 1;
    if (day > 28) day = 1;
  };

  // Quiet preamble for ATR/swings
  for (let i = 0; i < 40; i++) push(100, 101, 99, 100);

  // First low
  push(100, 100.5, 90, 91);
  push(91, 92, 89.5, 90.5);
  push(90.5, 91, 89, 90); // trough ~89

  // Recovery to neckline
  for (let i = 0; i < 8; i++) push(95 + i * 0.8, 96 + i * 0.8, 94 + i * 0.8, 95.5 + i * 0.8);
  push(102, 105, 101, 104); // neck ~105

  // Second low (similar)
  push(104, 104, 91, 92);
  push(92, 93, 89.2, 90);
  push(90, 91, 89.5, 90.5);

  // Breakout with volume
  for (let i = 0; i < 4; i++) push(98 + i, 100 + i, 97 + i, 99 + i);
  push(104, 108, 103, 107, 2_500_000); // close above neck
  push(107, 109, 106, 108, 2_200_000);

  // Fix dates properly across months
  return bars.map((b, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return { ...b, time: d.toISOString().slice(0, 10) };
  });
}

function doubleTopSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  // Quiet base
  for (let i = 0; i < 30; i++) {
    bars.push(bar(`base-${i}`, 100, 101, 99, 100, 1_000_000));
  }
  // Approach + first peak (clear local high with lookback 5)
  for (let i = 0; i < 5; i++) bars.push(bar(`up1-${i}`, 100 + i, 101 + i, 99 + i, 100 + i));
  bars.push(bar('h1', 108, 120, 107, 118)); // peak 120
  for (let i = 0; i < 5; i++) bars.push(bar(`dn1-${i}`, 115 - i * 3, 116 - i * 3, 112 - i * 3, 114 - i * 3));
  // Neck trough
  bars.push(bar('neck', 98, 99, 94, 95));
  for (let i = 0; i < 5; i++) bars.push(bar(`up2-${i}`, 96 + i * 3, 97 + i * 3, 95 + i * 3, 96 + i * 3));
  bars.push(bar('h2', 108, 119, 107, 117)); // second peak ~119
  for (let i = 0; i < 5; i++) bars.push(bar(`dn2-${i}`, 114 - i * 3, 115 - i * 3, 110 - i * 3, 112 - i * 3));
  // Breakdown below neck with volume
  bars.push(bar('break1', 96, 97, 92, 93, 2_800_000));
  bars.push(bar('break2', 93, 94, 90, 91, 2_400_000));

  return bars.map((b, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return { ...b, time: d.toISOString().slice(0, 10) };
  });
}

function ascendingTriangleSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < 35; i++) {
    bars.push(bar(`base-${i}`, 100, 101, 99, 100));
  }
  const lows = [88, 90, 92, 94];
  for (const low of lows) {
    bars.push(bar(`dip-${low}`, low + 8, low + 10, low, low + 2));
    for (let j = 0; j < 4; j++) {
      const mid = low + 2 + j * 4;
      bars.push(bar(`rise-${low}-${j}`, mid, mid + 2, mid - 1, mid + 1));
    }
    bars.push(bar(`top-${low}`, 108, 110, 107, 109)); // flat resistance ~110
    bars.push(bar(`pull-${low}`, 106, 108, 104, 105));
  }
  bars.push(bar('break', 109, 113, 108, 112, 2_500_000));
  return bars.map((b, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return { ...b, time: d.toISOString().slice(0, 10) };
  });
}

function descendingTriangleSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < 35; i++) bars.push(bar(`base-${i}`, 100, 101, 99, 100));
  const highs = [112, 110, 108, 106];
  for (const high of highs) {
    bars.push(bar(`rip-${high}`, high - 8, high, high - 10, high - 2));
    for (let j = 0; j < 4; j++) {
      const mid = high - 2 - j * 4;
      bars.push(bar(`fall-${high}-${j}`, mid, mid + 1, mid - 2, mid - 1));
    }
    bars.push(bar(`floor-${high}`, 92, 94, 90, 91)); // flat support ~90
    bars.push(bar(`bounce-${high}`, 93, 95, 92, 94));
  }
  bars.push(bar('breakdown', 91, 92, 87, 88, 2_500_000));
  return bars.map((b, idx) => {
    const d = new Date(Date.UTC(2024, 0, 1 + idx));
    return { ...b, time: d.toISOString().slice(0, 10) };
  });
}

function bullFlagSeries(): OhlcBar[] {
  const bars: OhlcBar[] = [];
  for (let i = 0; i < 25; i++) bars.push(bar(`base-${i}`, 100, 101, 99, 100));
  const poleSteps = [102, 105, 108, 112, 115, 116, 117, 118];
  for (let i = 0; i < poleSteps.length; i++) {
    const c = poleSteps[i]!;
    bars.push(bar(`pole-${i}`, c - 1, c + 1, c - 2, c));
  }
  const consolHighs = [117, 116, 115, 114, 113, 112, 111, 110];
  const consolLows = [113, 112, 111, 110, 109, 108, 107, 106];
  for (let i = 0; i < consolHighs.length; i++) {
    const h = consolHighs[i]!;
    const l = consolLows[i]!;
    bars.push(bar(`consol-${i}`, l + 2, h, l, l + 1));
  }
  bars.push(bar('break', 112, 119, 111, 118, 2_500_000));
  return bars.map((b, idx) => {
    const d = new Date(Date.UTC(2024, 0, 1 + idx));
    return { ...b, time: d.toISOString().slice(0, 10) };
  });
}

describe('chart pattern detection', () => {
  it('detects swing highs and lows with lookback', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 30; i++) {
      const mid = 100 + Math.sin(i / 3) * 5;
      bars.push(
        bar(
          `2024-02-${String(i + 1).padStart(2, '0')}`,
          mid,
          mid + 2,
          mid - 2,
          mid,
        ),
      );
    }
    // Sharp peak
    bars[15] = bar('2024-02-16', 110, 120, 109, 118);
    const swings = detectSwingPoints(bars, { ...DEFAULT_PATTERN_CONFIG, swing_lookback: 3, min_swing_atr: 0 });
    expect(swings.some((s) => s.kind === 'high')).toBe(true);
    expect(swings.some((s) => s.kind === 'low')).toBe(true);
  });

  it('detects a double bottom after neckline close', () => {
    const bars = doubleBottomSeries();
    const result = detectChartPatterns(bars);
    expect(result.ready).toBe(true);
    const db = result.patterns.find((p) => p.kind === 'double_bottom');
    expect(db).toBeTruthy();
    expect(db!.type).toBe('bullish');
    expect(['confirmed', 'breakout', 'forming']).toContain(db!.status);
    expect(db!.target).toBeGreaterThan(db!.breakout ?? 0);
    expect(db!.confidence).toBeGreaterThanOrEqual(40);
  });

  it('detects a double top structure', () => {
    const bars = doubleTopSeries();
    const result = detectChartPatterns(bars);
    const dt = result.patterns.find((p) => p.kind === 'double_top');
    expect(dt).toBeTruthy();
    expect(dt!.type).toBe('bearish');
    expect(dt!.stop_loss).toBeGreaterThan(dt!.breakout ?? 0);
  });

  it('returns ready=false when history is too short', () => {
    const bars = [bar('2024-01-01', 100, 101, 99, 100)];
    const result = detectChartPatterns(bars);
    expect(result.ready).toBe(false);
    expect(result.patterns).toHaveLength(0);
  });

  it('detects ascending triangle with flat resistance and rising support', () => {
    const bars = ascendingTriangleSeries();
    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const tri = result.patterns.find((p) => p.kind === 'ascending_triangle');
    expect(tri).toBeTruthy();
    expect(tri!.type).toBe('bullish');
    expect(tri!.resistance).toBeGreaterThan(tri!.support ?? 0);
  });

  it('detects descending triangle with flat support and falling resistance', () => {
    const bars = descendingTriangleSeries();
    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const tri = result.patterns.find((p) => p.kind === 'descending_triangle');
    expect(tri).toBeTruthy();
    expect(tri!.type).toBe('bearish');
    expect(tri!.resistance).toBeGreaterThan(tri!.support ?? 0);
  });

  it('detects bull flag after sharp up-pole and parallel drift', () => {
    const bars = bullFlagSeries();
    const result = detectChartPatterns(bars);
    const flag = result.patterns.find((p) => p.kind === 'bull_flag');
    expect(flag).toBeTruthy();
    expect(flag!.type).toBe('bullish');
    expect(flag!.target).toBeGreaterThan(flag!.breakout ?? 0);
  });

  it('resamples daily bars to weekly buckets', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 70; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      bars.push(bar(d.toISOString().slice(0, 10), 100 + i * 0.1, 101 + i * 0.1, 99, 100 + i * 0.1));
    }
    const weekly = resampleBarsToWeekly(bars);
    expect(weekly.length).toBeGreaterThan(8);
    expect(weekly.length).toBeLessThan(bars.length);
  });

  it('attaches MTF summary when enough daily history', () => {
    const flag = bullFlagSeries();
    const prefix: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      prefix.push(bar(`pre-${i}`, 100, 101, 99, 100));
    }
    const bars = [...prefix, ...flag].map((b, i) => ({
      ...b,
      time: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    const result = detectChartPatterns(bars);
    expect(result.mtf).toBeTruthy();
    expect(result.mtf!.frames.length).toBe(2);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.mtf!.overall_signal);
  });

  it('adds 1H frame when hourly bars are supplied', () => {
    const flag = bullFlagSeries();
    const prefix: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      prefix.push(bar(`pre-${i}`, 100, 101, 99, 100));
    }
    const daily = [...prefix, ...flag].map((b, i) => ({
      ...b,
      time: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    const hourly: OhlcBar[] = [];
    let px = 100;
    for (let i = 0; i < 80; i++) {
      px += 0.15;
      hourly.push({
        time: new Date(Date.UTC(2024, 0, 1, 9, i)).toISOString(),
        open: px,
        high: px + 0.5,
        low: px - 0.5,
        close: px,
        volume: 50_000,
      });
    }
    const result = detectChartPatterns(daily, {}, { hourlyBars: hourly });
    expect(result.mtf?.frames.some((f) => f.timeframe === '1H')).toBe(true);
    expect(result.mtf!.frames.length).toBe(3);
  });

  it('adds 5m and 15m frames when intraday bars are supplied', () => {
    const flag = bullFlagSeries();
    const prefix: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      prefix.push(bar(`pre-${i}`, 100, 101, 99, 100));
    }
    const daily = [...prefix, ...flag].map((b, i) => ({
      ...b,
      time: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    }));

    const bars5m: OhlcBar[] = [];
    const bars15m: OhlcBar[] = [];
    let px5 = 100;
    let px15 = 100;
    for (let i = 0; i < 120; i++) {
      px5 += 0.05;
      const t5 = new Date(Date.UTC(2024, 0, 1, 9, i * 5)).toISOString();
      bars5m.push({ time: t5, open: px5, high: px5 + 0.5, low: px5 - 0.5, close: px5, volume: 10_000 });
    }
    for (let i = 0; i < 60; i++) {
      px15 += 0.08;
      const t15 = new Date(Date.UTC(2024, 0, 1, 9, i * 15)).toISOString();
      bars15m.push({
        time: t15,
        open: px15,
        high: px15 + 0.5,
        low: px15 - 0.5,
        close: px15,
        volume: 10_000,
      });
    }

    const result = detectChartPatterns(daily, {}, { fiveMinBars: bars5m, fifteenMinBars: bars15m });
    expect(result.mtf?.frames.some((f) => f.timeframe === '5m')).toBe(true);
    expect(result.mtf?.frames.some((f) => f.timeframe === '15m')).toBe(true);
    expect(result.mtf!.frames.length).toBe(4); // 1D + 5m + 15m + 1W
  });

  it('adds 4H frame when fourHourBars are supplied', () => {
    const flag = bullFlagSeries();
    const prefix: OhlcBar[] = [];
    for (let i = 0; i < 40; i++) {
      prefix.push(bar(`pre-${i}`, 100, 101, 99, 100));
    }
    const daily = [...prefix, ...flag].map((b, i) => ({
      ...b,
      time: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    const fourHour: OhlcBar[] = [];
    let px = 100;
    for (let i = 0; i < 60; i++) {
      px += 0.2;
      fourHour.push({
        time: new Date(Date.UTC(2024, 0, 1, i * 4)).toISOString(),
        open: px,
        high: px + 0.6,
        low: px - 0.6,
        close: px,
        volume: 80_000,
      });
    }
    const result = detectChartPatterns(daily, {}, { fourHourBars: fourHour });
    expect(result.mtf?.frames.some((f) => f.timeframe === '4H')).toBe(true);
  });

  it('never marks confirmed without close beyond level on a forming twin-low', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      bars.push(bar(d.toISOString().slice(0, 10), 100, 101, 99, 100));
    }
    // Two lows, recovery, but last close still below neck
    bars[30] = bar(bars[30]!.time, 100, 100, 90, 91);
    bars[31] = bar(bars[31]!.time, 91, 92, 89, 90);
    for (let i = 32; i < 40; i++) {
      bars[i] = bar(bars[i]!.time, 95, 100, 94, 98);
    }
    bars[40] = bar(bars[40]!.time, 100, 105, 99, 104); // neck high
    bars[42] = bar(bars[42]!.time, 100, 100, 90, 91);
    bars[43] = bar(bars[43]!.time, 91, 92, 89.5, 90.5);
    // Stay under neck
    for (let i = 44; i < 50; i++) {
      bars[i] = bar(bars[i]!.time, 98, 102, 97, 101);
    }

    const result = detectChartPatterns(bars);
    for (const p of result.patterns.filter((x) => x.kind === 'double_bottom')) {
      if (p.status === 'confirmed') {
        expect(bars[bars.length - 1]!.close).toBeGreaterThanOrEqual(p.breakout! * 1.005);
      }
    }
  });

  it('detects cup and handle with U-shaped base and shallow handle', () => {
    const bars: OhlcBar[] = [];
    const push = (o: number, h: number, l: number, c: number, v = 1_000_000) => {
      const d = new Date(Date.UTC(2024, 0, 1 + bars.length));
      bars.push(bar(d.toISOString().slice(0, 10), o, h, l, c, v));
    };

    for (let i = 0; i < 45; i++) push(100, 101, 99, 100);
    for (let i = 0; i < 5; i++) push(110 + i, 112 + i, 109 + i, 111 + i);
    push(118, 125, 117, 124);

    let price = 124;
    for (let i = 0; i < 22; i++) {
      price -= 1.1;
      push(price + 1, price + 2, price - 1, price);
    }
    for (let i = 0; i < 22; i++) {
      price += 1.05;
      push(price - 1, price + 1, price - 2, price);
    }
    push(123, 126, 122, 125);

    for (let i = 0; i < 10; i++) {
      price -= 0.9;
      push(price + 1, price + 2, price - 1, price);
    }
    for (let i = 0; i < 5; i++) {
      price += 1.5;
      push(price - 1, price + 2, price - 2, price, 2_000_000);
    }

    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const cup = result.patterns.find((p) => p.kind === 'cup_and_handle');
    expect(cup).toBeTruthy();
    expect(cup!.type).toBe('bullish');
    expect(cup!.target).toBeGreaterThan(cup!.breakout ?? 0);
  });

  it('detects rounding bottom on a smooth U-shaped base', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 70; i++) {
      const x = i / 69;
      const low = 85 + 60 * (x - 0.5) * (x - 0.5);
      const close = low + 2;
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      bars.push(bar(d.toISOString().slice(0, 10), close - 0.5, close + 3, low, close));
    }
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(2024, 0, 71 + i));
      bars.push(bar(d.toISOString().slice(0, 10), 104 + i, 108 + i, 103 + i, 107 + i, 2_200_000));
    }

    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3, min_pattern_bars: 24 });
    const rb = result.patterns.find((p) => p.kind === 'rounding_bottom');
    expect(rb).toBeTruthy();
    expect(rb!.type).toBe('bullish');
  });

  it('detects rounding top on an inverted U-shaped peak', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 70; i++) {
      const x = i / 69;
      const high = 100 - 60 * (x - 0.5) * (x - 0.5);
      const close = high - 2;
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      bars.push(bar(d.toISOString().slice(0, 10), close + 0.5, high, close - 3, close));
    }
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(2024, 0, 71 + i));
      bars.push(bar(d.toISOString().slice(0, 10), 96 - i, 97 - i, 92 - i, 93 - i, 2_200_000));
    }

    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3, min_pattern_bars: 24 });
    const rt = result.patterns.find((p) => p.kind === 'rounding_top');
    expect(rt).toBeTruthy();
    expect(rt!.type).toBe('bearish');
  });

  it('detects rectangle on flat support and resistance', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 55; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      const close = 100 + 7 * Math.sin(i * 0.55);
      bars.push(bar(d.toISOString().slice(0, 10), close - 0.5, 108, 92, close));
    }

    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const rect = result.patterns.find((p) => p.kind === 'rectangle');
    expect(rect).toBeTruthy();
    expect(rect!.support).toBeGreaterThan(85);
    expect(rect!.resistance).toBeGreaterThan(rect!.support!);
    expect(rect!.resistance! - rect!.support!).toBeGreaterThan(10);
  });

  it('detects ascending price channel with parallel rising trendlines', () => {
    const bars: OhlcBar[] = [];
    for (let i = 0; i < 55; i++) {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      const base = i * 0.35;
      const wave = Math.sin(i * 0.5) * 3;
      const close = 100 + base + wave;
      const high = 108 + base + wave * 0.2;
      const low = 92 + base - wave * 0.2;
      bars.push(bar(d.toISOString().slice(0, 10), close - 0.5, high, low, close));
    }

    const result = detectChartPatterns(bars, { min_swing_atr: 0, swing_lookback: 3 });
    const ch = result.patterns.find((p) => p.kind === 'price_channel');
    expect(ch).toBeTruthy();
    expect(ch!.pattern).toMatch(/Channel/i);
    expect(ch!.type).toBe('bullish');
    expect(ch!.support).toBeLessThan(ch!.resistance!);
  });
});

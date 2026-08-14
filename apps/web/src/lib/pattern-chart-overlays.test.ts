import { describe, expect, it } from 'vitest';
import { patternChartOverlays } from './pattern-chart-overlays';

const BAR_TIMES = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1 + i));
  return d.toISOString().slice(0, 10);
});

describe('patternChartOverlays', () => {
  it('builds double-bottom swing markers and neckline segment', () => {
    const o = patternChartOverlays(
      {
        id: 'db',
        pattern: 'Double Bottom',
        kind: 'double_bottom',
        type: 'bullish',
        start_date: BAR_TIMES[5]!,
        end_date: BAR_TIMES[35]!,
        support: 90,
        resistance: 105,
        points: {
          low_1_date: BAR_TIMES[8]!,
          low_2_date: BAR_TIMES[20]!,
          neckline: 105,
        },
      },
      BAR_TIMES,
    );
    expect(o.markers).toHaveLength(2);
    expect(o.markers.every((m) => m.shape === 'arrowUp')).toBe(true);
    expect(o.segments).toHaveLength(1);
    expect(o.segments[0]!.price1).toBe(105);
    expect(o.segments[0]!.price2).toBe(105);
  });

  it('builds sloped triangle boundaries from slopes', () => {
    const o = patternChartOverlays(
      {
        id: 'tri',
        pattern: 'Ascending Triangle',
        kind: 'ascending_triangle',
        type: 'bullish',
        start_date: BAR_TIMES[10]!,
        end_date: BAR_TIMES[30]!,
        support: 100,
        resistance: 110,
        points: { high_slope: 0, low_slope: 0.5 },
      },
      BAR_TIMES,
    );
    expect(o.segments).toHaveLength(2);
    expect(o.segments[0]!.price1).toBe(110);
    expect(o.segments[1]!.price1).toBe(90);
  });

  it('builds H&S shoulder and head markers with neckline', () => {
    const o = patternChartOverlays(
      {
        id: 'hs',
        pattern: 'Head & Shoulders',
        kind: 'head_and_shoulders',
        type: 'bearish',
        start_date: BAR_TIMES[5]!,
        end_date: BAR_TIMES[35]!,
        support: 95,
        resistance: 120,
        points: {
          left_shoulder_date: BAR_TIMES[8]!,
          head_date: BAR_TIMES[18]!,
          right_shoulder_date: BAR_TIMES[28]!,
          neckline: 98,
        },
      },
      BAR_TIMES,
    );
    expect(o.markers).toHaveLength(3);
    expect(o.segments).toHaveLength(1);
    expect(o.segments[0]!.time1).toBe(BAR_TIMES[8]);
    expect(o.segments[0]!.time2).toBe(BAR_TIMES[28]);
  });
});

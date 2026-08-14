import type { ChartOverlayMarker, ChartOverlaySegment } from '../components/StockDailyChart';

export interface PatternOverlaySource {
  id: string;
  pattern: string;
  kind: string;
  type: string;
  start_date: string;
  end_date: string;
  support: number | null;
  resistance: number | null;
  points?: Record<string, number | string>;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function dateStr(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, 10);
}

function resolveBarTime(barTimes: string[], date: string): string | null {
  if (barTimes.includes(date)) return date;
  const prefix = date.slice(0, 10);
  const hit = barTimes.find((t) => String(t).startsWith(prefix) || prefix.startsWith(String(t).slice(0, 10)));
  return hit ? String(hit) : null;
}

function barIndex(barTimes: string[], date: string): number {
  const t = resolveBarTime(barTimes, date);
  if (!t) return -1;
  return barTimes.indexOf(t);
}

function accentColor(type: string): string {
  if (type === 'bullish') return '#22c55e';
  if (type === 'bearish') return '#ef4444';
  return '#94a3b8';
}

function shortLabel(name: string): string {
  return name.length > 14 ? `${name.slice(0, 12)}…` : name;
}

function marker(
  time: string,
  position: ChartOverlayMarker['position'],
  shape: ChartOverlayMarker['shape'],
  color: string,
  text?: string,
): ChartOverlayMarker {
  return { time, position, shape, color, text };
}

function segment(
  time1: string,
  price1: number,
  time2: string,
  price2: number,
  color: string,
  lineStyle: ChartOverlaySegment['lineStyle'] = 'solid',
  title?: string,
): ChartOverlaySegment {
  return { time1, price1, time2, price2, color, lineStyle, title };
}

function addNecklineSegment(
  out: ChartOverlaySegment[],
  barTimes: string[],
  startDate: string,
  endDate: string,
  neckPrice: number,
  color: string,
  title: string,
) {
  const t1 = resolveBarTime(barTimes, startDate);
  const t2 = resolveBarTime(barTimes, endDate);
  if (!t1 || !t2 || neckPrice <= 0) return;
  out.push(segment(t1, neckPrice, t2, neckPrice, color, 'dashed', title));
}

function addSlopedBounds(
  out: ChartOverlaySegment[],
  barTimes: string[],
  pattern: PatternOverlaySource,
  color: string,
) {
  const pts = pattern.points ?? {};
  const hiSlope = num(pts.high_slope);
  const loSlope = num(pts.low_slope);
  const resEnd = pattern.resistance;
  const supEnd = pattern.support;
  if (hiSlope == null || loSlope == null || resEnd == null || supEnd == null) return;

  const startIdx = barIndex(barTimes, pattern.start_date);
  const endIdx = barIndex(barTimes, pattern.end_date);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return;

  const tStart = barTimes[startIdx]!;
  const tEnd = barTimes[endIdx]!;
  const span = endIdx - startIdx;
  const resStart = resEnd - hiSlope * span;
  const supStart = supEnd - loSlope * span;

  out.push(segment(tStart, resStart, tEnd, resEnd, color, 'solid', `${shortLabel(pattern.pattern)} top`));
  out.push(segment(tStart, supStart, tEnd, supEnd, color, 'solid', `${shortLabel(pattern.pattern)} base`));
}

/** Build swing markers, necklines, and pattern boundary segments for chart overlays. */
export function patternChartOverlays(
  pattern: PatternOverlaySource,
  barTimes: string[],
): { markers: ChartOverlayMarker[]; segments: ChartOverlaySegment[] } {
  const markers: ChartOverlayMarker[] = [];
  const segmentsOut: ChartOverlaySegment[] = [];
  if (!barTimes.length) return { markers, segments: segmentsOut };

  const color = accentColor(pattern.type);
  const pts = pattern.points ?? {};
  const label = shortLabel(pattern.pattern);

  switch (pattern.kind) {
    case 'double_bottom': {
      const d1 = dateStr(pts.low_1_date);
      const d2 = dateStr(pts.low_2_date);
      const neck = num(pts.neckline);
      if (d1) {
        const t = resolveBarTime(barTimes, d1);
        if (t) markers.push(marker(t, 'belowBar', 'arrowUp', color, 'L1'));
      }
      if (d2) {
        const t = resolveBarTime(barTimes, d2);
        if (t) markers.push(marker(t, 'belowBar', 'arrowUp', color, 'L2'));
      }
      if (neck != null) {
        addNecklineSegment(segmentsOut, barTimes, pattern.start_date, pattern.end_date, neck, '#38bdf8', `${label} neck`);
      }
      break;
    }
    case 'double_top': {
      const d1 = dateStr(pts.high_1_date);
      const d2 = dateStr(pts.high_2_date);
      const neck = num(pts.neckline);
      if (d1) {
        const t = resolveBarTime(barTimes, d1);
        if (t) markers.push(marker(t, 'aboveBar', 'arrowDown', color, 'H1'));
      }
      if (d2) {
        const t = resolveBarTime(barTimes, d2);
        if (t) markers.push(marker(t, 'aboveBar', 'arrowDown', color, 'H2'));
      }
      if (neck != null) {
        addNecklineSegment(segmentsOut, barTimes, pattern.start_date, pattern.end_date, neck, '#38bdf8', `${label} neck`);
      }
      break;
    }
    case 'head_and_shoulders':
    case 'inverse_head_and_shoulders': {
      const ls = dateStr(pts.left_shoulder_date);
      const hd = dateStr(pts.head_date);
      const rs = dateStr(pts.right_shoulder_date);
      const neck = num(pts.neckline);
      const below = pattern.kind === 'inverse_head_and_shoulders';
      if (ls) {
        const t = resolveBarTime(barTimes, ls);
        if (t) markers.push(marker(t, below ? 'belowBar' : 'aboveBar', 'circle', color, 'LS'));
      }
      if (hd) {
        const t = resolveBarTime(barTimes, hd);
        if (t) markers.push(marker(t, below ? 'belowBar' : 'aboveBar', below ? 'arrowUp' : 'arrowDown', color, 'Head'));
      }
      if (rs) {
        const t = resolveBarTime(barTimes, rs);
        if (t) markers.push(marker(t, below ? 'belowBar' : 'aboveBar', 'circle', color, 'RS'));
      }
      if (neck != null && ls && rs) {
        addNecklineSegment(segmentsOut, barTimes, ls, rs, neck, '#38bdf8', `${label} neck`);
      }
      break;
    }
    case 'cup_and_handle': {
      const tStart = resolveBarTime(barTimes, pattern.start_date);
      const tEnd = resolveBarTime(barTimes, pattern.end_date);
      const rim = pattern.resistance;
      if (tStart && rim != null && rim > 0) {
        markers.push(marker(tStart, 'aboveBar', 'circle', color, 'Rim'));
      }
      if (tStart && tEnd && rim != null && rim > 0) {
        segmentsOut.push(segment(tStart, rim, tEnd, rim, color, 'dashed', `${label} rim`));
      }
      const handle = num(pts.handle_low);
      if (tEnd && handle != null && handle > 0) {
        markers.push(marker(tEnd, 'belowBar', 'circle', '#a78bfa', 'Handle'));
      }
      break;
    }
    case 'rounding_bottom':
    case 'rounding_top': {
      const tStart = resolveBarTime(barTimes, pattern.start_date);
      const tEnd = resolveBarTime(barTimes, pattern.end_date);
      const rim = num(pts.rim);
      const extreme = num(pts.extreme);
      const bullish = pattern.kind === 'rounding_bottom';
      if (tStart && rim != null) {
        markers.push(marker(tStart, bullish ? 'aboveBar' : 'belowBar', 'circle', color, 'Rim'));
      }
      if (tStart && tEnd && rim != null) {
        segmentsOut.push(segment(tStart, rim, tEnd, rim, color, 'dotted', `${label} rim`));
      }
      const midIdx = Math.floor((barIndex(barTimes, pattern.start_date) + barIndex(barTimes, pattern.end_date)) / 2);
      if (midIdx >= 0 && extreme != null) {
        markers.push(
          marker(
            barTimes[midIdx]!,
            bullish ? 'belowBar' : 'aboveBar',
            bullish ? 'arrowUp' : 'arrowDown',
            color,
            'Base',
          ),
        );
      }
      break;
    }
    case 'ascending_triangle':
    case 'descending_triangle':
    case 'symmetrical_triangle':
    case 'rising_wedge':
    case 'falling_wedge':
    case 'rectangle':
    case 'price_channel':
    case 'bull_flag':
    case 'bear_flag':
    case 'bull_pennant':
    case 'bear_pennant':
      if (pattern.points?.high_slope != null && pattern.points?.low_slope != null) {
        addSlopedBounds(segmentsOut, barTimes, pattern, color);
      } else if (pattern.support != null && pattern.resistance != null) {
        const t1 = resolveBarTime(barTimes, pattern.start_date);
        const t2 = resolveBarTime(barTimes, pattern.end_date);
        if (t1 && t2) {
          segmentsOut.push(segment(t1, pattern.resistance, t2, pattern.resistance, color, 'solid', `${label} top`));
          segmentsOut.push(segment(t1, pattern.support, t2, pattern.support, color, 'solid', `${label} base`));
        }
      }
      break;
    default:
      break;
  }

  return { markers, segments: segmentsOut };
}

export function mergePatternOverlays(
  patterns: PatternOverlaySource[],
  barTimes: string[],
): { markers: ChartOverlayMarker[]; segments: ChartOverlaySegment[] } {
  const markers: ChartOverlayMarker[] = [];
  const segments: ChartOverlaySegment[] = [];
  for (const p of patterns) {
    const o = patternChartOverlays(p, barTimes);
    markers.push(...o.markers);
    segments.push(...o.segments);
  }
  return { markers, segments };
}

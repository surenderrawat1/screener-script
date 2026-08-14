import type { ChartPriceLevel } from '../components/StockDailyChart';

export interface PatternLevelSource {
  id: string;
  pattern: string;
  type: string;
  support: number | null;
  resistance: number | null;
  breakout: number | null;
  target: number | null;
  stop_loss: number | null;
}

function shortLabel(name: string): string {
  return name.length > 20 ? `${name.slice(0, 18)}…` : name;
}

/** Map a detected pattern to horizontal chart price lines (support/resistance/breakout/target/stop). */
export function patternChartPriceLevels(pattern: PatternLevelSource): ChartPriceLevel[] {
  const label = shortLabel(pattern.pattern);
  const accent =
    pattern.type === 'bullish' ? '#22c55e' : pattern.type === 'bearish' ? '#ef4444' : '#94a3b8';
  const levels: ChartPriceLevel[] = [];

  if (pattern.support != null && pattern.support > 0) {
    levels.push({
      price: pattern.support,
      title: `${label} support`,
      color: '#a78bfa',
      lineStyle: 'dashed',
    });
  }
  if (pattern.resistance != null && pattern.resistance > 0) {
    levels.push({
      price: pattern.resistance,
      title: `${label} resistance`,
      color: '#fbbf24',
      lineStyle: 'dashed',
    });
  }
  if (pattern.breakout != null && pattern.breakout > 0) {
    levels.push({
      price: pattern.breakout,
      title: `${label} breakout`,
      color: '#38bdf8',
      lineStyle: 'dashed',
    });
  }
  if (pattern.target != null && pattern.target > 0) {
    levels.push({
      price: pattern.target,
      title: `${label} target`,
      color: accent,
      lineStyle: 'dotted',
    });
  }
  if (pattern.stop_loss != null && pattern.stop_loss > 0) {
    levels.push({
      price: pattern.stop_loss,
      title: `${label} stop`,
      color: '#ef4444',
      lineStyle: 'dotted',
    });
  }

  return levels;
}

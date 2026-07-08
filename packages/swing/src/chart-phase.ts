import {
  lastSeriesValue,
  seriesSlopePct,
  type DailyChartPayload,
  type SmaPoint,
} from './chart-series.js';
import type { TaMetrics } from './types.js';

export interface PhaseCard {
  number: number;
  title: string;
  label: string;
  detail: string;
  signal: string;
}

export interface MaCrossover {
  pair: string;
  type: 'golden' | 'death';
  time: string;
  detail: string;
}

export interface ChartPhaseAnalysis {
  ready: boolean;
  headline: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  phases: PhaseCard[];
  observations: string[];
  crossovers: MaCrossover[];
  timing_note: string;
}

const TIMING_NOTE =
  'Chart phases are timing context only and are not blended into CFA verification scores.';

function phaseCard(
  number: number,
  title: string,
  label: string,
  detail: string,
  signal: string,
): PhaseCard {
  return { number, title, label, detail, signal };
}

function findRecentMaCross(
  fastSeries: SmaPoint[],
  slowSeries: SmaPoint[],
  lookback: number,
  fastLabel: string,
  slowLabel: string,
): MaCrossover | null {
  if (!fastSeries.length || !slowSeries.length) return null;
  const slowByTime = new Map(slowSeries.map((p) => [String(p.time), p.value]));
  const aligned: { time: string; fast: number; slow: number }[] = [];
  for (const point of fastSeries) {
    const slow = slowByTime.get(String(point.time));
    if (slow !== undefined) aligned.push({ time: String(point.time), fast: point.value, slow });
  }
  if (aligned.length < 2) return null;
  const slice = aligned.slice(-Math.max(2, lookback));
  for (let i = slice.length - 1; i >= 1; i--) {
    const prev = slice[i - 1];
    const curr = slice[i];
    if (prev.fast <= prev.slow && curr.fast > curr.slow) {
      return {
        pair: `${fastLabel} / ${slowLabel}`,
        type: 'golden',
        time: curr.time,
        detail: `Golden cross: ${fastLabel} crossed above ${slowLabel} on ${curr.time}.`,
      };
    }
    if (prev.fast >= prev.slow && curr.fast < curr.slow) {
      return {
        pair: `${fastLabel} / ${slowLabel}`,
        type: 'death',
        time: curr.time,
        detail: `Death cross: ${fastLabel} crossed below ${slowLabel} on ${curr.time}.`,
      };
    }
  }
  return null;
}

export function chartPhaseAnalysis(
  price: number,
  ta: TaMetrics,
  chart: DailyChartPayload | null = null,
): ChartPhaseAnalysis {
  const empty: ChartPhaseAnalysis = {
    ready: false,
    headline: 'Chart analysis unavailable',
    bias: 'neutral',
    phases: [],
    observations: ['Yahoo daily chart data required for phase analysis.'],
    crossovers: [],
    timing_note: TIMING_NOTE,
  };

  if (price <= 0 || !ta.ta_ready) return empty;

  const sma9 = lastSeriesValue(chart?.sma9) ?? (typeof ta.ta_sma9 === 'number' ? ta.ta_sma9 : null);
  const sma50 = typeof ta.ta_sma50 === 'number' ? ta.ta_sma50 : null;
  const sma200 = typeof ta.ta_sma200 === 'number' ? ta.ta_sma200 : null;
  const rsiVal = typeof ta.ta_rsi14 === 'number' ? ta.ta_rsi14 : null;
  const pct52 = typeof ta.ta_pct_52w === 'number' ? ta.ta_pct_52w : null;
  const bbPct = typeof ta.ta_bb_pct_b === 'number' ? ta.ta_bb_pct_b : null;
  const macdHist = typeof ta.ta_macd_hist === 'number' ? ta.ta_macd_hist : null;

  const phases: PhaseCard[] = [];
  const observations: string[] = [];
  let bullScore = 0;
  let bearScore = 0;

  const above200 = sma200 !== null && sma200 > 0 ? price >= sma200 : null;
  const sma200Slope = seriesSlopePct(chart?.sma200 ?? null, 20);
  if (above200 === true && (sma50 === null || (sma200 != null && sma50 >= sma200))) {
    let detail = 'Price is above SMA-200';
    const signal = 'bullish';
    bullScore += 2;
    if (sma200Slope !== null && sma200Slope > 0.5) {
      detail += ' and SMA-200 is rising — long-term trend supportive.';
    } else {
      detail += ' — long-term trend intact.';
    }
    phases.push(phaseCard(1, 'Primary Trend', 'Primary uptrend', detail, signal));
  } else if (above200 === false && (sma50 === null || (sma200 != null && sma50 <= sma200))) {
    let detail = 'Price is below SMA-200';
    const signal = 'bearish';
    bearScore += 2;
    if (sma200Slope !== null && sma200Slope < -0.5) {
      detail += ' and SMA-200 is falling — structural weakness.';
    } else {
      detail += ' — long-term trend under pressure.';
    }
    phases.push(phaseCard(1, 'Primary Trend', 'Primary downtrend', detail, signal));
  } else {
    phases.push(
      phaseCard(
        1,
        'Primary Trend',
        'Trend transition',
        'Price and moving averages are mixed around SMA-200 — primary trend is unclear.',
        'watch',
      ),
    );
  }

  if (sma9 !== null && sma50 !== null && sma200 !== null) {
    if (sma9 > sma50 && sma50 > sma200) {
      phases.push(
        phaseCard(
          2,
          'MA Alignment',
          'Bull stack',
          'SMA-9 > SMA-50 > SMA-200 — moving averages aligned for upside.',
          'bullish',
        ),
      );
      bullScore += 2;
      observations.push('Full bullish MA stack on daily chart.');
    } else if (sma9 < sma50 && sma50 < sma200) {
      phases.push(
        phaseCard(
          2,
          'MA Alignment',
          'Bear stack',
          'SMA-9 < SMA-50 < SMA-200 — moving averages aligned for downside.',
          'bearish',
        ),
      );
      bearScore += 2;
      observations.push('Full bearish MA stack on daily chart.');
    } else {
      phases.push(
        phaseCard(
          2,
          'MA Alignment',
          'Mixed / consolidation',
          'Moving averages are intertwined — trend may be ranging or reversing.',
          'neutral',
        ),
      );
    }
  } else {
    phases.push(
      phaseCard(
        2,
        'MA Alignment',
        'MA stack incomplete',
        'Not enough history to compare SMA-9, SMA-50, and SMA-200 together.',
        'neutral',
      ),
    );
  }

  const above9 = sma9 !== null && sma9 > 0 ? price >= sma9 : null;
  if (rsiVal !== null) {
    if (rsiVal >= 70) {
      phases.push(
        phaseCard(
          3,
          'Short-term Momentum',
          'Overbought momentum',
          `RSI-14 at ${Math.round(rsiVal * 10) / 10} — short-term stretch; pullback risk elevated.`,
          'bearish',
        ),
      );
      bearScore += 1;
    } else if (rsiVal <= 30) {
      phases.push(
        phaseCard(
          3,
          'Short-term Momentum',
          'Oversold momentum',
          `RSI-14 at ${Math.round(rsiVal * 10) / 10} — selling may be exhausted; bounce watch only.`,
          'watch',
        ),
      );
    } else if (rsiVal >= 45 && rsiVal < 70 && (above9 === true || above9 === null)) {
      phases.push(
        phaseCard(
          3,
          'Short-term Momentum',
          'Positive short-term drift',
          `RSI-14 at ${Math.round(rsiVal * 10) / 10} with price holding above short-term average.`,
          'bullish',
        ),
      );
      bullScore += 1;
    } else if (rsiVal >= 25 && rsiVal < 45) {
      phases.push(
        phaseCard(
          3,
          'Short-term Momentum',
          'Recovery / base building',
          `RSI-14 at ${Math.round(rsiVal * 10) / 10} — early recovery zone after weakness.`,
          'watch',
        ),
      );
    } else {
      phases.push(
        phaseCard(
          3,
          'Short-term Momentum',
          'Neutral momentum',
          `RSI-14 at ${Math.round(rsiVal * 10) / 10} — no extreme short-term signal.`,
          'neutral',
        ),
      );
    }
  } else {
    const label = above9 === true ? 'Above SMA-9' : above9 === false ? 'Below SMA-9' : 'Momentum unknown';
    const signal = above9 === true ? 'bullish' : above9 === false ? 'bearish' : 'neutral';
    phases.push(
      phaseCard(
        3,
        'Short-term Momentum',
        label,
        'RSI unavailable; using price vs SMA-9 only.',
        signal,
      ),
    );
  }

  if (pct52 !== null) {
    if (pct52 >= 75) {
      phases.push(
        phaseCard(
          4,
          '52-Week Cycle',
          'Upper range / distribution risk',
          `Trading at ${Math.round(pct52)}% of 52-week range — near highs; extension risk.`,
          'bearish',
        ),
      );
      bearScore += 1;
    } else if (pct52 >= 50) {
      phases.push(
        phaseCard(
          4,
          '52-Week Cycle',
          'Mid-to-upper range',
          `At ${Math.round(pct52)}% of 52-week range — trend continuation or late-stage markup.`,
          'bullish',
        ),
      );
      bullScore += 1;
    } else if (pct52 >= 25) {
      phases.push(
        phaseCard(
          4,
          '52-Week Cycle',
          'Mid-range / base',
          `At ${Math.round(pct52)}% of 52-week range — consolidation or early recovery zone.`,
          'neutral',
        ),
      );
    } else {
      phases.push(
        phaseCard(
          4,
          '52-Week Cycle',
          'Lower range / accumulation',
          `At ${Math.round(pct52)}% of 52-week range — closer to 52w low; value timing watch only.`,
          'watch',
        ),
      );
    }
  } else {
    phases.push(
      phaseCard(
        4,
        '52-Week Cycle',
        '52w range unknown',
        '52-week high/low not available for cycle positioning.',
        'neutral',
      ),
    );
  }

  if (bbPct !== null) {
    if (bbPct >= 100) {
      phases.push(
        phaseCard(
          5,
          'Volatility (Bollinger)',
          'Upper band test',
          `Bollinger %B at ${Math.round(bbPct)}% — price at/above upper band; volatility expansion up.`,
          'bearish',
        ),
      );
    } else if (bbPct <= 0) {
      phases.push(
        phaseCard(
          5,
          'Volatility (Bollinger)',
          'Lower band test',
          `Bollinger %B at ${Math.round(bbPct)}% — price at/below lower band; mean-reversion watch.`,
          'watch',
        ),
      );
    } else if (bbPct >= 60) {
      phases.push(
        phaseCard(
          5,
          'Volatility (Bollinger)',
          'Upper half of band',
          `Bollinger %B at ${Math.round(bbPct)}% — bullish volatility bias.`,
          'bullish',
        ),
      );
      bullScore += 1;
    } else if (bbPct <= 40) {
      phases.push(
        phaseCard(
          5,
          'Volatility (Bollinger)',
          'Lower half of band',
          `Bollinger %B at ${Math.round(bbPct)}% — weak volatility bias.`,
          'bearish',
        ),
      );
      bearScore += 1;
    } else {
      phases.push(
        phaseCard(
          5,
          'Volatility (Bollinger)',
          'Band mid-zone',
          'Bollinger %B near middle — no band extreme.',
          'neutral',
        ),
      );
    }
  } else {
    phases.push(
      phaseCard(
        5,
        'Volatility (Bollinger)',
        'Volatility unknown',
        'Bollinger bands unavailable.',
        'neutral',
      ),
    );
  }

  if (macdHist !== null) {
    if (macdHist > 0) {
      phases.push(
        phaseCard(
          6,
          'MACD Momentum',
          'MACD bullish phase',
          'MACD histogram positive — upside momentum building or sustained.',
          'bullish',
        ),
      );
      bullScore += 1;
    } else if (macdHist < 0) {
      phases.push(
        phaseCard(
          6,
          'MACD Momentum',
          'MACD bearish phase',
          'MACD histogram negative — downside momentum dominant.',
          'bearish',
        ),
      );
      bearScore += 1;
    } else {
      phases.push(
        phaseCard(
          6,
          'MACD Momentum',
          'MACD neutral',
          'MACD histogram near zero — momentum crossover zone.',
          'watch',
        ),
      );
    }
  } else {
    phases.push(
      phaseCard(
        6,
        'MACD Momentum',
        'MACD unavailable',
        'Not enough data for MACD phase.',
        'neutral',
      ),
    );
  }

  if (ta.ta_bottom_out_hint) {
    const reasons = Array.isArray(ta.ta_bottom_out_reasons)
      ? ta.ta_bottom_out_reasons.map(String)
      : [];
    observations.push(`Bottom-out hint active: ${reasons.join(', ')}`);
  }

  const crossovers: MaCrossover[] = [];
  if (chart) {
    const cross950 = findRecentMaCross(chart.sma9, chart.sma50, 90, 'SMA-9', 'SMA-50');
    if (cross950) crossovers.push(cross950);
    const cross50200 = findRecentMaCross(chart.sma50, chart.sma200, 120, 'SMA-50', 'SMA-200');
    if (cross50200) crossovers.push(cross50200);
  }
  for (const cross of crossovers) observations.push(cross.detail);

  const above50 = ta.ta_above_sma50 === true;
  if (above200 === true && above50) {
    observations.push('Price above both SMA-50 and SMA-200 — intermediate and primary trends aligned up.');
  } else if (above200 === false && ta.ta_above_sma50 === false) {
    observations.push('Price below both SMA-50 and SMA-200 — intermediate and primary trends aligned down.');
  }

  let bias: ChartPhaseAnalysis['bias'] = 'neutral';
  if (bullScore >= bearScore + 2) bias = 'bullish';
  else if (bearScore >= bullScore + 2) bias = 'bearish';

  const phase0Label = phases[0]?.label ?? 'no clear edge';
  const headline =
    bias === 'bullish'
      ? `Chart bias: constructive — ${phase0Label}`
      : bias === 'bearish'
        ? `Chart bias: defensive — ${phase0Label}`
        : `Chart bias: mixed — ${phase0Label}`;

  return {
    ready: true,
    headline,
    bias,
    phases,
    observations,
    crossovers,
    timing_note: TIMING_NOTE,
  };
}

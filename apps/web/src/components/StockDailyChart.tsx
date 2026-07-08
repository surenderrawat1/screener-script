import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type Time,
} from 'lightweight-charts';

interface OhlcBar {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SmaPoint {
  time: string | number;
  value: number;
}

export interface ChartPayload {
  bars: OhlcBar[];
  sma9: SmaPoint[];
  sma20: SmaPoint[];
  sma50: SmaPoint[];
  sma200: SmaPoint[];
  interval?: string;
  range?: string;
  intraday?: boolean;
  ma_labels?: {
    sma9?: string;
    sma20?: string;
    sma50?: string;
    sma200?: string;
  };
}

export interface ChartPriceLevel {
  price: number;
  title: string;
  color: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

interface Props {
  chart: ChartPayload | null;
  height?: number;
  priceLevels?: ChartPriceLevel[];
}

type ChartTime = Time;
const EMPTY_PRICE_LEVELS: ChartPriceLevel[] = [];

export function StockDailyChart({ chart, height = 420, priceLevels = EMPTY_PRICE_LEVELS }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !chart?.bars?.length) return;

    let chartApi: IChartApi | null = null;

    chartApi = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a2332' },
        textColor: '#e8edf5',
      },
      grid: {
        vertLines: { color: '#2d3a4f' },
        horzLines: { color: '#2d3a4f' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#2d3a4f' },
      timeScale: { borderColor: '#2d3a4f' },
      width: el.clientWidth,
      height,
    });

    const candles = chartApi.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candles.setData(
      chart.bars.map((b) => ({
        time: b.time as ChartTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    const styleMap = {
      solid: LineStyle.Solid,
      dashed: LineStyle.LargeDashed,
      dotted: LineStyle.Dotted,
    } as const;
    for (const level of priceLevels) {
      if (!Number.isFinite(level.price) || level.price <= 0) continue;
      candles.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: styleMap[level.lineStyle ?? 'solid'],
        axisLabelVisible: true,
        title: level.title,
      });
    }

    const addLine = (data: SmaPoint[], color: string) => {
      if (!chartApi || !data.length) return;
      const line = chartApi.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false });
      line.setData(
        data.map((p) => ({
          time: p.time as ChartTime,
          value: p.value,
        })),
      );
    };

    addLine(chart.sma9, '#60a5fa');
    addLine(chart.sma20, '#a78bfa');
    addLine(chart.sma50, '#f59e0b');
    addLine(chart.sma200, '#ef4444');

    chartApi.timeScale().fitContent();

    const onResize = () => {
      if (el && chartApi) chartApi.applyOptions({ width: el.clientWidth });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      chartApi?.remove();
    };
  }, [chart, height, priceLevels]);

  if (!chart?.bars?.length) {
    return <p className="muted">Chart unavailable — insufficient Yahoo history.</p>;
  }
  const maLabels = chart.ma_labels ?? {};

  return (
    <div>
      <div ref={containerRef} className="stock-chart" />
      <div className="chart-legend">
        {chart.sma9.length > 0 ? <span><i className="legend-swatch" style={{ background: '#60a5fa' }} /> {maLabels.sma9 ?? 'SMA-9'}</span> : null}
        {chart.sma20.length > 0 ? <span><i className="legend-swatch" style={{ background: '#a78bfa' }} /> {maLabels.sma20 ?? 'SMA-20'}</span> : null}
        {chart.sma50.length > 0 ? <span><i className="legend-swatch" style={{ background: '#f59e0b' }} /> {maLabels.sma50 ?? 'SMA-50'}</span> : null}
        {chart.sma200.length > 0 ? <span><i className="legend-swatch" style={{ background: '#ef4444' }} /> {maLabels.sma200 ?? 'SMA-200'}</span> : null}
        {priceLevels.map((level) => (
          <span key={`${level.title}-${level.price}`}>
            <i className="legend-swatch" style={{ background: level.color }} /> {level.title}
          </span>
        ))}
      </div>
    </div>
  );
}

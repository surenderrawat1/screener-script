import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
} from 'lightweight-charts';

interface OhlcBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SmaPoint {
  time: string;
  value: number;
}

export interface ChartPayload {
  bars: OhlcBar[];
  sma9: SmaPoint[];
  sma20: SmaPoint[];
  sma50: SmaPoint[];
  sma200: SmaPoint[];
}

interface Props {
  chart: ChartPayload | null;
  height?: number;
}

type ChartTime = `${number}-${number}-${number}`;

export function StockDailyChart({ chart, height = 420 }: Props) {
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
  }, [chart, height]);

  if (!chart?.bars?.length) {
    return <p className="muted">Daily chart unavailable — insufficient Yahoo history.</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="stock-chart" />
      <div className="chart-legend">
        <span><i className="legend-swatch" style={{ background: '#60a5fa' }} /> SMA-9</span>
        <span><i className="legend-swatch" style={{ background: '#a78bfa' }} /> SMA-20</span>
        <span><i className="legend-swatch" style={{ background: '#f59e0b' }} /> SMA-50</span>
        <span><i className="legend-swatch" style={{ background: '#ef4444' }} /> SMA-200</span>
      </div>
    </div>
  );
}

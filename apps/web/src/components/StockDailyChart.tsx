import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesMarkersPluginApi,
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
  /** RSI-14 (0–100). Optional for older cached payloads. */
  rsi14?: SmaPoint[];
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

export interface ChartOverlayMarker {
  time: string;
  position: 'aboveBar' | 'belowBar';
  shape: 'circle' | 'arrowUp' | 'arrowDown';
  color: string;
  text?: string;
}

export interface ChartOverlaySegment {
  time1: string;
  price1: number;
  time2: string;
  price2: number;
  color: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  title?: string;
}

interface Props {
  chart: ChartPayload | null;
  height?: number;
  priceLevels?: ChartPriceLevel[];
  overlayMarkers?: ChartOverlayMarker[];
  overlaySegments?: ChartOverlaySegment[];
}

type ChartTime = Time;
const EMPTY_PRICE_LEVELS: ChartPriceLevel[] = [];
const EMPTY_MARKERS: ChartOverlayMarker[] = [];
const EMPTY_SEGMENTS: ChartOverlaySegment[] = [];
const RSI_COLOR = '#f472b6';

export function StockDailyChart({
  chart,
  height = 420,
  priceLevels = EMPTY_PRICE_LEVELS,
  overlayMarkers = EMPTY_MARKERS,
  overlaySegments = EMPTY_SEGMENTS,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !chart?.bars?.length) return;

    let chartApi: IChartApi | null = null;
    const hasRsi = Boolean(chart.rsi14?.length);
    const chartHeight = hasRsi ? Math.max(height, Math.round(height * 1.22)) : height;

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
      height: chartHeight,
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

    let markersPlugin: ISeriesMarkersPluginApi<ChartTime> | null = null;
    if (overlayMarkers.length > 0) {
      markersPlugin = createSeriesMarkers(
        candles,
        overlayMarkers.map((m) => ({
          time: m.time as ChartTime,
          position: m.position,
          shape: m.shape,
          color: m.color,
          text: m.text,
        })),
      );
    }

    for (const seg of overlaySegments) {
      if (!Number.isFinite(seg.price1) || !Number.isFinite(seg.price2)) continue;
      const line = chartApi.addSeries(LineSeries, {
        color: seg.color,
        lineWidth: 2,
        lineStyle: styleMap[seg.lineStyle ?? 'solid'],
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData([
        { time: seg.time1 as ChartTime, value: seg.price1 },
        { time: seg.time2 as ChartTime, value: seg.price2 },
      ]);
    }

    const addLine = (data: SmaPoint[], color: string, paneIndex = 0) => {
      if (!chartApi || !data.length) return;
      const line = chartApi.addSeries(
        LineSeries,
        { color, lineWidth: 1, priceLineVisible: false },
        paneIndex,
      );
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

    if (hasRsi && chart.rsi14) {
      chartApi.addPane(true);
      const panes = chartApi.panes();
      if (panes.length > 1) {
        const pricePaneHeight = Math.round(chartHeight * 0.72);
        const rsiPaneHeight = Math.max(80, chartHeight - pricePaneHeight);
        panes[0].setHeight(pricePaneHeight);
        panes[1].setHeight(rsiPaneHeight);
      }
      const rsiSeries = chartApi.addSeries(
        LineSeries,
        {
          color: RSI_COLOR,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'RSI-14',
          autoscaleInfoProvider: () => ({
            priceRange: {
              minValue: 0,
              maxValue: 100,
            },
          }),
        },
        1,
      );
      rsiSeries.setData(
        chart.rsi14.map((p) => ({
          time: p.time as ChartTime,
          value: p.value,
        })),
      );
      rsiSeries.createPriceLine({
        price: 70,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '70',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '30',
      });
      rsiSeries.createPriceLine({
        price: 50,
        color: '#64748b',
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: false,
        title: '',
      });
    }

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
      markersPlugin?.setMarkers([]);
      chartApi?.remove();
    };
  }, [chart, height, priceLevels, overlayMarkers, overlaySegments]);

  if (!chart?.bars?.length) {
    return <p className="muted">Chart unavailable — insufficient Yahoo history.</p>;
  }
  const maLabels = chart.ma_labels ?? {};
  const lastRsi = chart.rsi14?.length ? chart.rsi14[chart.rsi14.length - 1]?.value : null;

  return (
    <div>
      <div ref={containerRef} className="stock-chart" />
      <div className="chart-legend">
        {chart.sma9.length > 0 ? <span><i className="legend-swatch" style={{ background: '#60a5fa' }} /> {maLabels.sma9 ?? 'SMA-9'}</span> : null}
        {chart.sma20.length > 0 ? <span><i className="legend-swatch" style={{ background: '#a78bfa' }} /> {maLabels.sma20 ?? 'SMA-20'}</span> : null}
        {chart.sma50.length > 0 ? <span><i className="legend-swatch" style={{ background: '#f59e0b' }} /> {maLabels.sma50 ?? 'SMA-50'}</span> : null}
        {chart.sma200.length > 0 ? <span><i className="legend-swatch" style={{ background: '#ef4444' }} /> {maLabels.sma200 ?? 'SMA-200'}</span> : null}
        {chart.rsi14 && chart.rsi14.length > 0 ? (
          <span>
            <i className="legend-swatch" style={{ background: RSI_COLOR }} /> RSI-14
            {lastRsi != null ? ` ${lastRsi}` : ''}
          </span>
        ) : null}
        {priceLevels.map((level) => (
          <span key={`${level.title}-${level.price}`}>
            <i className="legend-swatch" style={{ background: level.color }} /> {level.title}
          </span>
        ))}
        {overlayMarkers.length > 0 ? (
          <span><i className="legend-swatch" style={{ background: '#38bdf8' }} /> Pattern swings</span>
        ) : null}
        {overlaySegments.length > 0 ? (
          <span><i className="legend-swatch" style={{ background: '#22c55e' }} /> Pattern structure</span>
        ) : null}
      </div>
    </div>
  );
}

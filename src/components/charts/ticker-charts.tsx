import type { Timeframe } from "#/lib/window-series.ts";
import { CandlestickChart } from "./candlestick-chart.tsx";
import { Candlestick } from "./candlestick.tsx";
import { LineChart, Line } from "./line-chart.tsx";
import { Grid } from "./grid.tsx";
import { XAxis } from "./x-axis.tsx";
import { YAxis } from "./y-axis.tsx";
import { ChartTooltip } from "./tooltip/chart-tooltip.tsx";
import { ChartMarkers, type ChartMarker } from "./markers/index.ts";

// Chart trees extracted from the ticker route so motion/@visx/d3 land in a
// lazily-loaded chunk (React.lazy) instead of the route's initial bundle.

type Candle = { date: Date; open: number; high: number; low: number; close: number };
type NormPoint = { date: Date; stock: number; spy: number | null };

export function PriceCandles({
  candles,
  markers,
  timeframe,
}: {
  candles: Candle[];
  markers: ChartMarker[];
  timeframe: Timeframe;
}) {
  return (
    <CandlestickChart data={candles} margin={{ right: 56 }} style={{ height: 320 }} revealSignature={timeframe}>
      <Grid horizontal />
      <Candlestick fadedOpacity={0.25} />
      <ChartMarkers items={markers} />
      <XAxis />
      <YAxis />
      <ChartTooltip />
    </CandlestickChart>
  );
}

export function StockVsSpyLine({
  norm,
  markers,
  timeframe,
}: {
  norm: NormPoint[];
  markers: ChartMarker[];
  timeframe: Timeframe;
}) {
  return (
    <LineChart data={norm} revealSignature={timeframe} className="h-[320px]">
      <Grid horizontal highlightRowValues={[100]} />
      <Line dataKey="stock" />
      <Line dataKey="spy" stroke="var(--chart-3)" />
      <ChartMarkers items={markers} />
      <XAxis />
      <ChartTooltip />
    </LineChart>
  );
}

import { memo, useEffect } from "react";
import type { Timeframe } from "#/lib/window-series.ts";
import { useChart } from "./chart-context.tsx";
import { CandlestickChart } from "./candlestick-chart.tsx";
import { Candlestick } from "./candlestick.tsx";
import { AreaChart } from "./area-chart.tsx";
import { MorphArea } from "./morph-area.tsx";
import { Grid } from "./grid.tsx";
import { XAxis } from "./x-axis.tsx";
import { YAxis } from "./y-axis.tsx";
import { ChartTooltip } from "./tooltip/chart-tooltip.tsx";
import { ChartMarkers, type ChartMarker } from "./markers/index.ts";

// Chart trees extracted from the ticker route so motion/@visx/d3 land in a
// lazily-loaded chunk (React.lazy) instead of the route's initial bundle.

type Candle = { date: Date; open: number; high: number; low: number; close: number };
type NormPoint = { date: Date; stock: number; spy: number | null };

// Reports the hovered candle's close up to the route header so the price readout
// can track the crosshair (Robinhood-style). Lives inside the chart so it can read
// `tooltipData` from context; renders nothing. `onChange` must be referentially
// stable (a useState setter) so the effect only fires on an actual hover change.
function HoverClose({ onChange }: { onChange: (close: number | null) => void }) {
  const { tooltipData } = useChart();
  const close = tooltipData ? ((tooltipData.point.close as number | undefined) ?? null) : null;
  useEffect(() => {
    onChange(close);
  }, [close, onChange]);
  return null;
}

export const PriceCandles = memo(function PriceCandles({
  candles,
  markers,
  timeframe,
  onHoverClose,
  iconFill,
}: {
  candles: Candle[];
  markers: ChartMarker[];
  timeframe: Timeframe;
  onHoverClose?: (close: number | null) => void;
  iconFill?: boolean;
}) {
  return (
    <CandlestickChart data={candles} margin={{ left: 56 }} style={{ height: 320 }}>
      <Grid horizontal />
      {/* Semantic up/down fills (matching the header delta's toneClass and the
            P/L area), not the bklit monochrome default: zinc-800 down candles
            vanish against the dark card, and both emerald/rose read on white +
            dark. Overrides the candlestick-positive/negative gradient defaults. */}
      <Candlestick
        fadedOpacity={0.25}
        positiveFill="var(--color-emerald-500)"
        negativeFill="var(--color-rose-500)"
      />
      <ChartMarkers items={markers} replayKey={timeframe} iconFill={iconFill} />
      <XAxis />
      <YAxis />
      <ChartTooltip />
      {onHoverClose ? <HoverClose onChange={onHoverClose} /> : null}
    </CandlestickChart>
  );
});

export const StockVsSpyLine = memo(function StockVsSpyLine({
  norm,
  markers,
  timeframe,
  iconFill,
}: {
  norm: NormPoint[];
  markers: ChartMarker[];
  timeframe: Timeframe;
  iconFill?: boolean;
}) {
  // No crossfade wrapper: the chart stays mounted across timeframes and the
  // shell reveal / y-domain tween handle the transition as `norm` changes. Stock
  // is the filled Area; SPY is a fill-less reference line (`fillOpacity={0}`) —
  // two opaque fills would muddy the comparison.
  return (
    <AreaChart data={norm} className="h-[320px]" aspectRatio="auto">
      <Grid horizontal highlightRowValues={[100]} />
      <MorphArea dataKey="stock" />
      <MorphArea dataKey="spy" stroke="var(--info)" fillOpacity={0} />
      <ChartMarkers items={markers} replayKey={timeframe} iconFill={iconFill} />
      <XAxis />
      <ChartTooltip />
    </AreaChart>
  );
});

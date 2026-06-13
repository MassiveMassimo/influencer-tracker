import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { Timeframe } from "#/lib/window-series.ts";
import { CandlestickChart } from "./candlestick-chart.tsx";
import { Candlestick } from "./candlestick.tsx";
import { LineChart } from "./line-chart.tsx";
import { MorphLine } from "./morph-line.tsx";
import { Grid } from "./grid.tsx";
import { XAxis } from "./x-axis.tsx";
import { YAxis } from "./y-axis.tsx";
import { ChartTooltip } from "./tooltip/chart-tooltip.tsx";
import { ChartMarkers, type ChartMarker } from "./markers/index.ts";

// Chart trees extracted from the ticker route so motion/@visx/d3 land in a
// lazily-loaded chunk (React.lazy) instead of the route's initial bundle.

type Candle = { date: Date; open: number; high: number; low: number; close: number };
type NormPoint = { date: Date; stock: number; spy: number | null };

// Crossfade between timeframes: AnimatePresence keeps the outgoing chart mounted
// while it fades out and the incoming one fades in, stacked in the same 320px
// box, so the two animations overlap into one smooth dissolve. `initial={false}`
// skips the fade on first paint (SSR/hydration stays static). The route gates
// `timeframe` on data readiness, so each key change is a real, fully-formed swap.
function ChartCrossfade({
  timeframe,
  children,
}: {
  timeframe: Timeframe;
  children: ReactNode;
}) {
  return (
    <div className="relative h-[320px]">
      <AnimatePresence initial={false}>
        <motion.div
          animate={{ opacity: 1 }}
          className="absolute inset-0"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key={timeframe}
          // Strong custom ease-out (built-in easings lack punch); 0.4s matches
          // MorphLine so both charts transition as one on a timeframe switch.
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

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
    <ChartCrossfade timeframe={timeframe}>
      <CandlestickChart data={candles} margin={{ left: 56 }} style={{ height: 320 }} revealSignature={timeframe}>
        <Grid horizontal />
        <Candlestick fadedOpacity={0.25} />
        <ChartMarkers items={markers} />
        <XAxis />
        <YAxis />
        <ChartTooltip />
      </CandlestickChart>
    </ChartCrossfade>
  );
}

export function StockVsSpyLine({
  norm,
  markers,
}: {
  norm: NormPoint[];
  markers: ChartMarker[];
}) {
  // No crossfade wrapper here: the line chart stays mounted across timeframes so
  // MorphLine tweens its stroke as the `norm` data changes (see morph-line.tsx).
  // revealSignature stays constant so the shell reveals once on mount and never
  // replays a fade over the morph.
  return (
    <LineChart data={norm} revealMode="fade" className="h-[320px]">
      <Grid horizontal highlightRowValues={[100]} />
      <MorphLine dataKey="stock" />
      <MorphLine dataKey="spy" stroke="var(--chart-3)" />
      <ChartMarkers items={markers} />
      <XAxis />
      <ChartTooltip />
    </LineChart>
  );
}

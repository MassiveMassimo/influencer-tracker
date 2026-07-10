"use client";

import { useMemo } from "react";
import type { CumPoint } from "#/lib/types.ts";
import { AreaChart } from "./area-chart";
import { Grid } from "./grid";
import { ProfitLossArea } from "./profit-loss-area";
import { ChartTooltip } from "./tooltip/chart-tooltip";
import { XAxis } from "./x-axis";

// bklit AreaChart rendering of the cumulative-excess-vs-SPY curve. Replaces the
// hand-rolled native SVG so the curve gains a hover tooltip, crosshair, and the
// shell's reveal animation. The sign-split fill-to-zero is `ProfitLossArea` (a
// local fork — bklit has no fill-to-baseline primitive). `cumExcess` always
// starts at v=0 (entry day excess is 0), so the auto y-domain includes the zero
// baseline without an explicit yDomain override (the shell exposes none).
//
// Lazy-loaded by `CumulativeExcess` so motion/@visx/d3 stay off the creator
// route's initial bundle (mirrors the lazy CallFunnel).

const signColor = (v: number) => (v >= 0 ? "var(--color-emerald-500)" : "var(--color-rose-500)");

const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export function CumExcessArea({ pts }: { pts: CumPoint[] }) {
  const data = useMemo(
    () => pts.map((p) => ({ date: new Date(`${p.t}T00:00:00Z`), v: p.v })),
    [pts],
  );

  return (
    <AreaChart
      aspectRatio="auto"
      className="h-[200px]"
      data={data}
      margin={{ top: 16, right: 16, bottom: 24, left: 8 }}
    >
      {/* Break-even baseline (== SPY), mirrors the native dashed "0% · SPY" line. */}
      <Grid
        highlightRowStrokeDasharray="3 3"
        highlightRowStrokeOpacity={0.5}
        highlightRowValues={[0]}
        horizontal
      />
      <ProfitLossArea dataKey="v" fadeEdges />
      <XAxis />
      <ChartTooltip
        indicatorColor={(point) => signColor((point.v as number) ?? 0)}
        rows={(point) => {
          const v = (point.v as number) ?? 0;
          return [{ color: signColor(v), label: "Excess vs SPY", value: fmtPct(v) }];
        }}
      />
    </AreaChart>
  );
}

export default CumExcessArea;

import { Gauge } from "#/components/charts/gauge.tsx";
import { BarChart } from "#/components/charts/bar-chart.tsx";
import { Bar } from "#/components/charts/bar.tsx";
import { ScatterChart } from "#/components/charts/scatter-chart.tsx";
import { Scatter } from "#/components/charts/scatter.tsx";
import { FunnelChart } from "#/components/charts/funnel-chart.tsx";
import { Grid } from "#/components/charts/grid.tsx";
import { XAxis } from "#/components/charts/x-axis.tsx";
import { ChartTooltip } from "#/components/charts/tooltip/chart-tooltip.tsx";
import type { Dataset, Horizon } from "../lib/types";
import { Card } from "#/components/ui/card.tsx";

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];

export function AnalyticsCharts({ ds }: { ds: Dataset }) {
  const sc = ds.scorecard;
  const excessByHorizon = HORIZONS.map(h => ({ horizon: h, excess: +(sc.avgExcess[h] * 100).toFixed(1) }));
  const convVsReturn = ds.calls
    .filter(c => c.returns.toDate.excess != null)
    .map(c => ({ conviction: c.conviction, excess: +(c.returns.toDate.excess! * 100).toFixed(1) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Hit rate (calls beating SPY, 3m)</div>
        <Gauge value={Math.round(sc.hitRate["3m"] * 100)} centerValue={sc.hitRate["3m"]}
          defaultLabel="beat SPY" inactiveFillOpacity={0.4}
          formatOptions={{ style: "percent", maximumFractionDigits: 0 }} />
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Avg excess return by horizon (%)</div>
        <BarChart data={excessByHorizon} xDataKey="horizon">
          <Grid horizontal highlightRowValues={[0]} />
          <Bar dataKey="excess" />
          <XAxis />
          <ChartTooltip />
        </BarChart>
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Conviction vs return (does confidence predict accuracy?)</div>
        <ScatterChart data={convVsReturn} xDataKey="conviction">
          <Grid horizontal highlightRowValues={[0]} />
          <Scatter dataKey="excess" strokeWidth={0} yGradient />
          <XAxis />
          <ChartTooltip />
        </ScatterChart>
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Call funnel</div>
        {sc.funnel
          ? <FunnelChart data={sc.funnel} color="var(--chart-1)" layers={3} />
          : <p className="text-sm text-muted-foreground">Run the full pipeline to populate.</p>}
      </Card>
    </div>
  );
}

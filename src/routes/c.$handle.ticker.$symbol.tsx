import { createFileRoute } from "@tanstack/react-router";
import { getDataset } from "../lib/data";
import { CandlestickChart } from "#/components/charts/candlestick-chart.tsx";
import { Candlestick } from "#/components/charts/candlestick.tsx";
import { LineChart, Line } from "#/components/charts/line-chart.tsx";
import { Grid } from "#/components/charts/grid.tsx";
import { XAxis } from "#/components/charts/x-axis.tsx";
import { ChartTooltip } from "#/components/charts/tooltip/chart-tooltip.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  component: TickerPage,
});

function pct(x: number | null) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const ohlc = ds.tickers[symbol]?.ohlc ?? [];
  const spy = ds.tickers["SPY"]?.ohlc ?? [];
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const callDates = new Set(calls.map((c) => c.postDate));

  const candles = ohlc.map((b) => ({
    date: new Date(b.date),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));

  const base = ohlc[0]?.c ?? 1;
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
    call: callDates.has(b.date) ? (b.c / base) * 100 : null,
  }));

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-6">
      <h1 className="text-2xl font-bold">
        {symbol}{" "}
        <span className="text-muted-foreground text-base">
          {calls[0]?.company}
        </span>
      </h1>

      <section>
        <h2 className="font-semibold mb-2">Price</h2>
        <CandlestickChart data={candles} style={{ height: 320 }}>
          <Grid horizontal />
          <Candlestick fadedOpacity={0.25} />
          <XAxis />
          <ChartTooltip />
        </CandlestickChart>
      </section>

      <section>
        <h2 className="font-semibold mb-2">
          Stock vs SPY, rebased to 100 — markers are his call dates
        </h2>
        <LineChart data={norm}>
          <Grid horizontal highlightRowValues={[100]} />
          <Line dataKey="stock" />
          <Line dataKey="spy" stroke="var(--chart-3)" />
          <Line dataKey="call" showMarkers stroke="transparent" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Calls & forward return vs SPY</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>1w</TableHead>
              <TableHead>1m</TableHead>
              <TableHead>3m</TableHead>
              <TableHead>To date</TableHead>
              <TableHead>Quote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow key={c.shortcode}>
                <TableCell>
                  {c.postDate}
                  {c.isFirstCall ? " ⭐" : ""}
                </TableCell>
                <TableCell>{pct(c.returns["1w"].excess)}</TableCell>
                <TableCell>{pct(c.returns["1m"].excess)}</TableCell>
                <TableCell>{pct(c.returns["3m"].excess)}</TableCell>
                <TableCell>{pct(c.returns["toDate"].excess)}</TableCell>
                <TableCell className="max-w-xs truncate">{c.quote}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}

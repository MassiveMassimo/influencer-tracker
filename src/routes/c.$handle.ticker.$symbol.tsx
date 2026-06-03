import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDataset } from "../lib/data";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import type { Call } from "#/lib/types.ts";
import { CandlestickChart } from "#/components/charts/candlestick-chart.tsx";
import { Candlestick } from "#/components/charts/candlestick.tsx";
import { LineChart, Line } from "#/components/charts/line-chart.tsx";
import { Grid } from "#/components/charts/grid.tsx";
import { XAxis } from "#/components/charts/x-axis.tsx";
import { ChartTooltip } from "#/components/charts/tooltip/chart-tooltip.tsx";
import {
  ChartMarkers,
  type ChartMarker,
} from "#/components/charts/markers/index.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { ChartBoundary } from "../components/ChartBoundary";
import { TimeframeTabs } from "#/components/TimeframeTabs.tsx";
import type { Timeframe } from "#/lib/window-series.ts";
import { chartQuery } from "#/lib/chart-query.ts";
import type { LiveBar } from "#/lib/chart-fetch.ts";
import { siteUrl } from "#/og/site.ts";

// Earliest call date, used as the "All" window start and passed to fetchChart.
function firstDateOf(calls: { postDate: string }[]): string {
  if (!calls.length) return new Date().toISOString().slice(0, 10);
  return calls.reduce((m, c) => (c.postDate < m ? c.postDate : m), calls[0].postDate);
}

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: async ({ params, context }) => {
    const ds = await getDataset({ data: params.handle });
    const firstDate = firstDateOf(ds.calls);
    // Prefetch the default timeframe so the first paint is SSR'd, no spinner.
    await context.queryClient.ensureQueryData(
      chartQuery(params.symbol, "1Y", firstDate),
    );
    return ds;
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}/${params.symbol}`);
    return {
      meta: [
        { title: `${params.symbol} — ${name} · Signal Tracker` },
        { property: "og:title", content: `${params.symbol} — ${name}` },
        {
          property: "og:url",
          content: siteUrl(`/c/${params.handle}/ticker/${params.symbol}`),
        },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: TickerPage,
});

function pct(x: number | null) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}

function ChartSkeleton() {
  return (
    <div className="h-[320px] w-full animate-pulse rounded-xl bg-muted/40" />
  );
}

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");

  const firstDate = firstDateOf(ds.calls);
  const query = useQuery(chartQuery(symbol, timeframe, firstDate));

  // Baked daily OHLC from the frozen dataset — used as the fallback when the
  // live Yahoo fetch errors or returns nothing.
  const bakedOhlc: LiveBar[] = (ds.tickers[symbol]?.ohlc ?? []).map((b) => ({
    date: b.date,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
  }));
  const bakedSpy: LiveBar[] = (ds.tickers["SPY"]?.ohlc ?? []).map((b) => ({
    date: b.date,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
  }));

  const usingFallback = query.isError || (query.data != null && query.data.ohlc.length === 0);
  const ohlc: LiveBar[] = usingFallback ? bakedOhlc : (query.data?.ohlc ?? []);
  const spy: LiveBar[] = usingFallback ? bakedSpy : (query.data?.spy ?? []);

  const callMarkers: ChartMarker[] = calls.map((c) => ({
    date: new Date(c.postDate),
    icon: "▲",
    title: `${symbol} · ${c.postDate}`,
    description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
  }));

  const candles = ohlc.map((b) => ({
    date: new Date(b.date),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));

  // Rebase vs-SPY to the first bar of the fetched range.
  const base = ohlc[0]?.c ?? 1;
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
  }));

  const showSkeleton = query.isPending && ohlc.length === 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Ticker · @{ds.creator.handle}
        </div>
        <h1 className="mt-1 flex items-baseline gap-2 font-heading text-2xl">
          {symbol}
          <span className="text-base text-muted-foreground">{calls[0]?.company}</span>
        </h1>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Price
            {usingFallback ? (
              <span className="ml-2 text-amber-600 dark:text-amber-400">· cached daily data</span>
            ) : null}
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>
        {showSkeleton ? (
          <ChartSkeleton />
        ) : (
          <ChartBoundary>
            <CandlestickChart data={candles} style={{ height: 320 }} revealSignature={timeframe}>
              <Grid horizontal />
              <Candlestick fadedOpacity={0.25} />
              <ChartMarkers items={callMarkers} />
              <XAxis />
              <ChartTooltip />
            </CandlestickChart>
          </ChartBoundary>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Stock vs SPY · rebased to 100 · markers are call dates
        </div>
        {showSkeleton ? (
          <ChartSkeleton />
        ) : (
          <ChartBoundary>
            <LineChart data={norm} revealSignature={timeframe} className="h-[320px]">
              <Grid horizontal highlightRowValues={[100]} />
              <Line dataKey="stock" />
              <Line dataKey="spy" stroke="var(--chart-3)" />
              <ChartMarkers items={callMarkers} />
              <XAxis />
              <ChartTooltip />
            </LineChart>
          </ChartBoundary>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Calls & forward return vs SPY · tap a row for proof
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">1w</TableHead>
              <TableHead className="text-right">1m</TableHead>
              <TableHead className="text-right">3m</TableHead>
              <TableHead className="text-right">To date</TableHead>
              <TableHead>Quote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow
                key={c.shortcode}
                onClick={() => setSelectedCall(c)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono tabular-nums">
                  {c.postDate}
                  {c.isFirstCall ? " ★" : ""}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1w"].excess)}`}>
                  {pct(c.returns["1w"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1m"].excess)}`}>
                  {pct(c.returns["1m"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["3m"].excess)}`}>
                  {pct(c.returns["3m"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["toDate"].excess)}`}>
                  {pct(c.returns["toDate"].excess)}
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">{c.quote}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <ProofViewer call={selectedCall} onClose={() => setSelectedCall(null)} />
    </main>
  );
}

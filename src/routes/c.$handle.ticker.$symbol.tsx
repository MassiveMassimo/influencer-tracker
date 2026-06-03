import { useLayoutEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { zoomMultiplier, type Timeframe } from "#/lib/window-series.ts";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: ({ params }) => getDataset({ data: params.handle }),
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

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const ohlc = ds.tickers[symbol]?.ohlc ?? [];
  const spy = ds.tickers["SPY"]?.ohlc ?? [];
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);

  const callMarkers: ChartMarker[] = calls.map((c) => ({
    date: new Date(c.postDate),
    icon: "▲",
    title: `${symbol} · ${c.postDate}`,
    description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
  }));

  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");

  // Timeframe sets the zoom: the full series is laid out `mult` viewport-widths
  // wide so `timeframe` days fill the view and earlier months are reachable by
  // scrolling. Both charts share one width and a synced horizontal scroll.
  const mult = zoomMultiplier(ohlc, timeframe);
  const priceRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const trackWidth = mult > 1 && vw ? vw * mult : undefined;

  // Measure the (shared) viewport width to size the wide inner track in px.
  useLayoutEffect(() => {
    const el = priceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    setVw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Start at the latest data; keep the two charts' horizontal scroll in sync.
  useLayoutEffect(() => {
    const vp = (r: React.RefObject<HTMLDivElement | null>) =>
      r.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;
    const a = vp(priceRef);
    const b = vp(lineRef);
    if (!a || !b) return;
    a.scrollLeft = a.scrollWidth;
    b.scrollLeft = b.scrollWidth;
    let lock = false;
    const mirror = (src: HTMLElement, dst: HTMLElement) => () => {
      if (lock) return;
      lock = true;
      dst.scrollLeft = src.scrollLeft;
      lock = false;
    };
    const sa = mirror(a, b);
    const sb = mirror(b, a);
    a.addEventListener("scroll", sa, { passive: true });
    b.addEventListener("scroll", sb, { passive: true });
    return () => {
      a.removeEventListener("scroll", sa);
      b.removeEventListener("scroll", sb);
    };
  }, [timeframe, vw, symbol]);

  const candles = ohlc.map((b) => ({
    date: new Date(b.date),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));

  const base = ohlc[0]?.c ?? 1;          // rebase to first bar of full history
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
  }));

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
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>
        <ScrollArea ref={priceRef} className="w-full" maskHeight={28}>
          <div style={{ width: trackWidth }}>
            <ChartBoundary>
              <CandlestickChart data={candles} style={{ height: 320 }} revealSignature={timeframe}>
                <Grid horizontal />
                <Candlestick fadedOpacity={0.25} />
                <ChartMarkers items={callMarkers} />
                <XAxis />
                <ChartTooltip />
              </CandlestickChart>
            </ChartBoundary>
          </div>
        </ScrollArea>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Stock vs SPY · rebased to 100 · markers are call dates
        </div>
        <ScrollArea ref={lineRef} className="w-full" maskHeight={28}>
          <div style={{ width: trackWidth }}>
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
          </div>
        </ScrollArea>
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

import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow, { type Format, NumberFlowGroup } from "@number-flow/react";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";
import { fetchDataset, fetchPrices } from "../lib/data";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import type { Call } from "#/lib/types.ts";
import type { ChartMarker } from "#/components/charts/markers/index.ts";
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
import { buildChartView } from "#/lib/chart-view.ts";
import type { LiveBar } from "#/lib/chart-fetch.ts";
import { siteUrl } from "#/og/site.ts";
import { ogRev } from "#/og/og-rev.ts";

// Charts (motion/@visx/d3) are code-split into their own chunk and loaded on
// mount, keeping them off the route's initial JS. Both share one chunk.
const PriceCandles = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({
    default: m.PriceCandles,
  })),
);
const StockVsSpyLine = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({
    default: m.StockVsSpyLine,
  })),
);

// Earliest call date, used as the "All" window start and passed to fetchChart.
function firstDateOf(calls: { postDate: string }[]): string {
  if (!calls.length) return new Date().toISOString().slice(0, 10);
  return calls.reduce((m, c) => (c.postDate < m ? c.postDate : m), calls[0].postDate);
}

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: async ({ params, context }) => {
    const ds = await fetchDataset(params.handle);
    const firstDate = firstDateOf(ds.calls);
    // Prefetch the default timeframe (SSR first paint) and the baked fallback prices
    // for this symbol + SPY in parallel — no request waterfall. The shared price
    // store replaces the old per-dataset tickers map (which dehydrated ~5 MB into HTML).
    const [, bakedOhlc, bakedSpy] = await Promise.all([
      // Best-effort SSR prefetch: a live-Yahoo failure must degrade to the baked
      // fallback, never reject the loader and crash the whole route. fetchPrices
      // already returns [] (never throws) when prices are missing.
      context.queryClient.ensureQueryData(chartQuery(params.symbol, "1Y", firstDate)).catch((err) => {
        console.warn("[ticker loader] live-Yahoo prefetch failed, using baked fallback:", (err as Error)?.message ?? err);
        return undefined;
      }),
      fetchPrices(params.symbol),
      fetchPrices("SPY"),
    ]);
    return { ...ds, bakedOhlc, bakedSpy };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const symCalls = loaderData?.calls.filter((c) => c.ticker === params.symbol) ?? [];
    const excess3m = symCalls[0]?.returns?.["3m"]?.excess ?? null;
    const ohlc = loaderData?.bakedOhlc ?? [];
    const lastClose = ohlc.length ? ohlc[ohlc.length - 1].c : 0;
    const rev = ogRev([excess3m, ohlc.length, Math.round(lastClose)]);
    const img = siteUrl(`/api/og/t/${params.handle}/${params.symbol}/${rev}`);
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

// Headline price: cents for >= $1, 4 places for sub-dollar (penny stocks).
function priceFmt(x: number | null) {
  if (x == null) return "—";
  const decimals = x >= 1 ? 2 : 4;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Signed nominal delta in dollars (penny-stock precision mirrors priceFmt).
function signedCurrency(x: number | null) {
  if (x == null) return "—";
  const decimals = Math.abs(x) >= 1 ? 2 : 4;
  const sign = x > 0 ? "+" : x < 0 ? "-" : "";
  return `${sign}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
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

// Live price + change, sitting in the chart header's left slot. Flows its digits
// on timeframe change via NumberFlow (same treatment as the creator-page stats);
// falls back to static formatting until the custom element registers (SSR / pre-hydration).
function PriceReadout({
  lastClose,
  tfChange,
  tfDelta,
  usingFallback,
}: {
  lastClose: number | null;
  tfChange: number | null;
  tfDelta: number | null;
  usingFallback: boolean;
}) {
  const ready = useNumberFlowReady();
  if (lastClose == null) return null;

  const priceFormat: Format = {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: lastClose >= 1 ? 2 : 4,
    maximumFractionDigits: lastClose >= 1 ? 2 : 4,
  };
  const deltaFormat: Format = {
    style: "currency",
    currency: "USD",
    signDisplay: "exceptZero",
    minimumFractionDigits: lastClose >= 1 ? 2 : 4,
    maximumFractionDigits: lastClose >= 1 ? 2 : 4,
  };
  const changeFormat: Format = {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  };

  return (
    <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <NumberFlowGroup>
        <span className="font-heading text-2xl tabular-nums">
          {ready ? (
            <NumberFlow format={priceFormat} value={lastClose} willChange />
          ) : (
            priceFmt(lastClose)
          )}
        </span>
        <span className={`font-mono text-sm tabular-nums ${toneClass(tfChange)}`}>
          {tfChange == null || tfDelta == null ? (
            "—"
          ) : ready ? (
            <>
              <NumberFlow format={deltaFormat} value={tfDelta} willChange />
              {" ("}
              <NumberFlow format={changeFormat} value={tfChange} willChange />
              {")"}
            </>
          ) : (
            `${signedCurrency(tfDelta)} (${signed(tfChange)})`
          )}
        </span>
      </NumberFlowGroup>
      {usingFallback ? (
        <span className="font-mono text-[10px] text-amber-600 uppercase tracking-[0.3em] dark:text-amber-400">
          · cached daily data
        </span>
      ) : null}
    </div>
  );
}

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const { impact, select } = useHaptics();
  const queryClient = useQueryClient();
  const numberFlowReady = useNumberFlowReady();

  const firstDate = firstDateOf(ds.calls);
  const query = useQuery(chartQuery(symbol, timeframe, firstDate));

  // Baked daily OHLC from the shared price store — the fallback when the live Yahoo
  // fetch errors or returns nothing. OhlcBar and LiveBar share a shape.
  const { bakedOhlc, bakedSpy } = ds;

  // Committed view: only advances once the requested timeframe's live data is in
  // hand, so the chart never paints an empty / placeholder / wrong-window frame
  // mid-switch. The crossfade (AnimatePresence in ticker-charts) keys off
  // `view.timeframe`, so it fires exactly once per real data swap. Until then the
  // previous chart stays fully rendered — no skeleton, no dim, no stutter.
  const buildView = (live: typeof query.data | null) =>
    buildChartView({ timeframe, live: live ?? null, bakedOhlc, bakedSpy });
  const liveNow =
    query.data != null && !query.isPlaceholderData && query.data.ohlc.length > 0
      ? query.data
      : null;
  const [view, setView] = useState(() => buildView(liveNow));

  useEffect(() => {
    if (query.isPending || query.isPlaceholderData) {
      return; // still fetching the requested timeframe — hold the current view
    }
    const live = query.data && query.data.ohlc.length > 0 ? query.data : null;
    setView(buildView(live));
  }, [
    query.isPending,
    query.isPlaceholderData,
    query.data,
    timeframe,
    bakedOhlc,
    bakedSpy,
  ]);

  // Warm the cache on hover/focus so the actual click is a hit and the swap is
  // instant; keepPreviousData + view-gating keep an un-prefetched tap smooth too.
  const prefetchTimeframe = (tf: Timeframe) => {
    queryClient.prefetchQuery(chartQuery(symbol, tf, firstDate));
  };

  const usingFallback = view.usingFallback;
  const ohlc: LiveBar[] = view.ohlc;
  const spy: LiveBar[] = view.spy;

  const callMarkers: ChartMarker[] = calls.map((c) => ({
    date: new Date(c.postDate),
    icon: "▲",
    title: `${symbol} · ${c.postDate}`,
    description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
    onClick: () => {
      select();
      setSelectedCall(c);
    },
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
  // Stock and SPY are fetched at the same Yahoo interval, so their bar
  // timestamps share one grid — joining by exact date key aligns them
  // (verified: ~98% match intraday; the rare gap just nulls one SPY point).
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
  }));

  // Only on a true cold start (no committed view data at all) — otherwise the
  // view holds the prior window, so the chart stays up and we never skeleton
  // mid-switch.
  const showSkeleton = ohlc.length === 0;

  // Calls falling inside the committed window — their markers only render when in
  // range, so a small timeframe can show price with no markers. Drives the note below.
  const windowStart = ohlc.length ? new Date(ohlc[0].date) : null;
  const windowEnd = ohlc.length ? new Date(ohlc[ohlc.length - 1].date) : null;
  const callsInWindow =
    windowStart && windowEnd
      ? calls.filter((c) => {
          const d = new Date(c.postDate);
          return d >= windowStart && d <= windowEnd;
        }).length
      : 0;

  // Headline readout: last close of the committed window, change measured over the
  // selected timeframe (first → last bar), so it reads like a normal stock chart.
  const lastClose = ohlc.length ? ohlc[ohlc.length - 1].c : null;
  const firstClose = ohlc.length ? ohlc[0].c : null;
  const tfChange =
    lastClose != null && firstClose
      ? (lastClose - firstClose) / firstClose
      : null;
  const tfDelta =
    lastClose != null && firstClose != null ? lastClose - firstClose : null;

  // Rendered in two slots (mobile top-right / desktop below price), so define once.
  const callsLabel = numberFlowReady ? (
    <NumberFlow
      value={callsInWindow}
      suffix={callsInWindow === 1 ? " call" : " calls"}
      willChange
    />
  ) : (
    `${callsInWindow} ${callsInWindow === 1 ? "call" : "calls"}`
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-10 md:py-10">
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
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col items-start gap-1 sm:w-auto">
            <div className="flex w-full items-start justify-between gap-3 sm:w-auto sm:justify-start">
              <PriceReadout
                lastClose={lastClose}
                tfChange={tfChange}
                tfDelta={tfDelta}
                usingFallback={usingFallback}
              />
              {/* Mobile: calls count sits top-right of the price row. */}
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:hidden">
                {callsLabel}
              </span>
            </div>
            {/* Desktop: calls count sits below the price. */}
            <span className="hidden font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:block">
              {callsLabel}
            </span>
          </div>
          <TimeframeTabs
            value={timeframe}
            onChange={(tf) => {
              impact();
              setTimeframe(tf);
            }}
            onPrefetch={prefetchTimeframe}
          />
        </div>
        <div className="relative">
          {showSkeleton ? (
            <ChartSkeleton />
          ) : candles.length === 0 ? (
            <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">
              No price data for this symbol.
            </div>
          ) : (
            <ChartBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <PriceCandles candles={candles} markers={callMarkers} timeframe={view.timeframe} />
              </Suspense>
            </ChartBoundary>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Stock vs SPY · rebased to 100 · markers are call dates
        </div>
        {showSkeleton ? (
          <ChartSkeleton />
        ) : norm.length === 0 ? (
          <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">
            No price data for this symbol.
          </div>
        ) : (
          <ChartBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <StockVsSpyLine norm={norm} markers={callMarkers} timeframe={view.timeframe} />
            </Suspense>
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
                onClick={() => {
                  select();
                  setSelectedCall(c);
                }}
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

      <ProofViewer
        call={selectedCall}
        handle={ds.creator.handle}
        onClose={() => setSelectedCall(null)}
      />
    </main>
  );
}

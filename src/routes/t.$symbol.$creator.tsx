import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { prefetchHalal, useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { HalalPanel } from "#/components/halal/halal-panel.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow, { type Format, NumberFlowGroup } from "@number-flow/react";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";
import { fetchCallsIndex, fetchDataset, fetchPrices, listCreators } from "../lib/data";
import { summarizeTicker } from "../lib/call-filter";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import { PreviewCard, PreviewCardTrigger, PreviewCardPopup } from "#/components/ui/preview-card.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import type { Call } from "#/lib/types.ts";
import type { ChartMarker } from "#/components/charts/markers/index.ts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table.tsx";
import { ChartBoundary } from "../components/ChartBoundary";
import { AreaChartLoading } from "#/components/charts/area-chart-loading.tsx";
import { CandlestickChartLoading } from "#/components/charts/candlestick-chart-loading.tsx";
import { TimeframeTabs } from "#/components/TimeframeTabs.tsx";
import type { Timeframe } from "#/lib/window-series.ts";
import { chartQuery } from "#/lib/chart-query.ts";
import { buildChartView } from "#/lib/chart-view.ts";
import { headlineReadout } from "#/lib/headline-readout.ts";
import type { LiveBar } from "#/lib/chart-fetch.ts";
import { siteUrl } from "#/og/site.ts";
import { ogRev } from "#/og/og-rev.ts";
import { CreatorSwitcher } from "#/components/ticker/creator-switcher.tsx";
import { TickerCallTimeline, type TimelineCreator } from "#/components/ticker/call-timeline.tsx";
import type { SwitcherCreator } from "#/lib/ticker-switcher.ts";

const PriceCandles = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({ default: m.PriceCandles })),
);
const StockVsSpyLine = lazy(() =>
  import("#/components/charts/ticker-charts.tsx").then((m) => ({ default: m.StockVsSpyLine })),
);

function pct(x: number | null) { return x == null ? "—" : `${(x * 100).toFixed(1)}%`; }
function signed(x: number | null) { return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`; }
function priceFmt(x: number | null) {
  if (x == null) return "—";
  const d = x >= 1 ? 2 : 4;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function signedCurrency(x: number | null) {
  if (x == null) return "—";
  const d = Math.abs(x) >= 1 ? 2 : 4;
  const s = x > 0 ? "+" : x < 0 ? "-" : "";
  return `${s}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0 ? "text-emerald-600 dark:text-emerald-400" : x < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
}
function ChartSkeleton() {
  return (
    <AreaChartLoading
      aspectRatio="auto"
      className="h-[320px] w-full overflow-hidden rounded-xl"
      label="Loading"
    />
  );
}
function CandleSkeleton() {
  return (
    <CandlestickChartLoading
      aspectRatio="auto"
      className="h-[320px] w-full overflow-hidden rounded-xl"
      label="Loading"
    />
  );
}

export const Route = createFileRoute("/t/$symbol/$creator")({
  loader: async ({ params, context }) => {
    const symbol = params.symbol.toUpperCase();
    const creatorParam = params.creator;

    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    const summary = summarizeTicker(calls, symbol);
    if (summary.callCount === 0) throw notFound();

    // Cross-creator call dates (timeline + all-mode markers).
    const hits = calls
      .filter((r) => r.ticker.toUpperCase() === symbol)
      .map((r) => ({ handle: r.handle, postDate: r.postDate, isFirstCall: r.isFirstCall }));
    const firstDate = hits.reduce((m, h) => (h.postDate < m ? h.postDate : m), hits[0]?.postDate ?? new Date().toISOString().slice(0, 10));

    // Names + avatars for the creators who called this symbol only.
    const shown = new Set(summary.byCreator.map((b) => b.handle));
    const roster = creators.filter((c) => shown.has(c.handle));
    const names = Object.fromEntries(roster.map((c) => [c.handle, c.name] as const));
    const avatars = Object.fromEntries(roster.map((c) => [c.handle, c.avatar] as const));

    // Selected creator: valid only if it actually called this symbol; else All.
    const creatorHandle = creatorParam !== "all" && shown.has(creatorParam) ? creatorParam : null;

    // The creator dataset is independent of the chart/price/halal fetches —
    // run it in the same Promise.all instead of serially ahead of them.
    const datasetPromise = creatorHandle
      ? fetchDataset(creatorHandle).catch((err) => {
          console.warn(`[ticker loader] dataset fetch failed for ${creatorHandle}, degrading to All:`, (err as Error)?.message ?? err);
          return null;
        })
      : Promise.resolve(null);

    const [ds, , bakedOhlc, bakedSpy] = await Promise.all([
      datasetPromise,
      context.queryClient.ensureQueryData(chartQuery(symbol, "1Y", firstDate)).catch((err) => {
        console.warn("[ticker loader] live-Yahoo prefetch failed, using baked fallback:", (err as Error)?.message ?? err);
        return undefined;
      }),
      fetchPrices(symbol),
      fetchPrices("SPY"),
      prefetchHalal(context.queryClient, [symbol]),
    ]);
    const creatorCalls: Call[] = ds ? ds.calls.filter((c) => c.ticker === symbol) : [];

    // OG (computed here — head() has no access to derived state).
    const ogImg = creatorHandle
      ? siteUrl(`/api/og/t/${creatorHandle}/${symbol}/${ogRev([creatorCalls[0]?.returns?.["3m"]?.excess ?? null, bakedOhlc.length, Math.round(bakedOhlc.at(-1)?.c ?? 0)])}`)
      : siteUrl("/og.png");
    const ogTitle = creatorHandle
      ? `${symbol} — ${names[creatorHandle] ?? creatorHandle} · Signal Tracker`
      : `${symbol} — who called it · Signal Tracker`;

    return {
      symbol, company: summary.company, summary, names, avatars, hits,
      creatorHandle, creatorCalls, firstDate, bakedOhlc, bakedSpy,
      og: { img: ogImg, title: ogTitle },
    };
  },
  head: ({ params, loaderData }) => {
    const symbol = params.symbol.toUpperCase();
    const creator = params.creator === "all" ? "all" : (loaderData?.creatorHandle ?? "all");
    return {
      meta: [
        { title: loaderData?.og.title ?? `${symbol} · Signal Tracker` },
        { property: "og:title", content: loaderData?.og.title ?? symbol },
        { property: "og:url", content: siteUrl(`/t/${symbol}/${creator}`) },
        { property: "og:image", content: loaderData?.og.img ?? siteUrl("/og.png") },
        { name: "twitter:image", content: loaderData?.og.img ?? siteUrl("/og.png") },
      ],
    };
  },
  component: TickerPage,
});

function PriceReadout({ lastClose, tfChange, tfDelta, usingFallback }: {
  lastClose: number | null; tfChange: number | null; tfDelta: number | null; usingFallback: boolean;
}) {
  const ready = useNumberFlowReady();
  if (lastClose == null) return null;
  const priceFormat: Format = { style: "currency", currency: "USD", minimumFractionDigits: lastClose >= 1 ? 2 : 4, maximumFractionDigits: lastClose >= 1 ? 2 : 4 };
  const deltaFormat: Format = { style: "currency", currency: "USD", signDisplay: "exceptZero", minimumFractionDigits: lastClose >= 1 ? 2 : 4, maximumFractionDigits: lastClose >= 1 ? 2 : 4 };
  const changeFormat: Format = { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return (
    <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <NumberFlowGroup>
        <span className="font-heading text-2xl tabular-nums">
          {ready ? <NumberFlow format={priceFormat} value={lastClose} willChange /> : priceFmt(lastClose)}
        </span>
        {/* transition-colors: the tone flips rose<->emerald on a zero-cross while
            NumberFlow glyphs are mid-spin on their own will-change layers; an
            instant color swap leaves random glyphs holding a stale (old-tone)
            paint. Animating color repaints the whole subtree each frame. */}
        <span className={`font-mono text-sm tabular-nums transition-colors ${toneClass(tfChange)}`}>
          {tfChange == null || tfDelta == null ? "—" : ready ? (
            <><NumberFlow format={deltaFormat} value={tfDelta} willChange />{" ("}<NumberFlow format={changeFormat} value={tfChange} willChange />{")"}</>
          ) : `${signedCurrency(tfDelta)} (${signed(tfChange)})`}
        </span>
      </NumberFlowGroup>
      {usingFallback ? <span className="font-mono text-[10px] text-amber-600 uppercase tracking-[0.3em] dark:text-amber-400">· cached daily data</span> : null}
    </div>
  );
}

function TickerPage() {
  const data = Route.useLoaderData();
  const { symbol, summary, names, avatars, hits, creatorHandle, creatorCalls, firstDate, bakedOhlc, bakedSpy } = data;
  const getHalal = useHalalStatus([symbol]);
  const halal = getHalal(symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const { impact, select } = useHaptics();
  const queryClient = useQueryClient();
  const numberFlowReady = useNumberFlowReady();
  const [hoverClose, setHoverClose] = useState<number | null>(null);

  const query = useQuery(chartQuery(symbol, timeframe, firstDate));

  const buildView = (live: typeof query.data | null) =>
    buildChartView({ timeframe, live: live ?? null, bakedOhlc, bakedSpy });
  const liveNow = query.data != null && !query.isPlaceholderData && query.data.ohlc.length > 0 ? query.data : null;
  const [view, setView] = useState(() => buildView(liveNow));

  useEffect(() => {
    if (query.isPending || query.isPlaceholderData) return;
    const live = query.data && query.data.ohlc.length > 0 ? query.data : null;
    setView(buildView(live));
  }, [query.isPending, query.isPlaceholderData, query.data, timeframe, bakedOhlc, bakedSpy]);

  useEffect(() => { setHoverClose(null); }, [view.timeframe]);

  const prefetchTimeframe = (tf: Timeframe) => { queryClient.prefetchQuery(chartQuery(symbol, tf, firstDate)); };

  const usingFallback = view.usingFallback;
  const ohlc: LiveBar[] = view.ohlc;
  const spy: LiveBar[] = view.spy;

  // Visible window = the timeframe-windowed price series' date span (ohlc is
  // ascending, "YYYY-MM-DD"). Calls/markers are scoped to it so the chart, the
  // markers, and the count all reflect the same (timeframe × creator) slice.
  // No price data → keep everything (fail-open). String compare is correct
  // since both sides are ISO dates, and avoids TZ pitfalls of `new Date`.
  const winStart = ohlc.length ? ohlc[0].date : null;
  const winEnd = ohlc.length ? ohlc[ohlc.length - 1].date : null;
  const inWindow = (postDate: string) =>
    winStart == null || winEnd == null || (postDate >= winStart && postDate <= winEnd);

  // Markers: selected creator's calls (clickable → proof) or all-mode call
  // dates (non-clickable, cross-creator), filtered to the visible window so
  // out-of-window calls don't bleed off the axis.
  const callMarkers: ChartMarker[] = useMemo(() => {
    if (creatorHandle) {
      return creatorCalls.filter((c) => inWindow(c.postDate)).map((c) => ({
        date: new Date(c.postDate),
        icon: "▲",
        title: `${symbol} · ${c.postDate}`,
        description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
        onClick: () => { select(); setSelectedCall(c); },
      }));
    }
    return hits.filter((h) => inWindow(h.postDate)).map((h) => ({
      date: new Date(h.postDate),
      icon: avatars[h.handle] ? (
        <img
          src={avatars[h.handle]!}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
        />
      ) : "▲",
      title: `${names[h.handle] ?? h.handle} · ${h.postDate}`,
      description: "",
    }));
  }, [creatorHandle, creatorCalls, hits, names, avatars, symbol, select, winStart, winEnd]);

  const candles = useMemo(() => ohlc.map((b) => ({ date: new Date(b.date), open: b.o, high: b.h, low: b.l, close: b.c })), [ohlc]);
  const norm = useMemo(() => {
    const base = ohlc[0]?.c ?? 1;
    const spyBase = spy[0]?.c ?? 1;
    const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
    return ohlc.map((b) => ({ date: new Date(b.date), stock: (b.c / base) * 100, spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null }));
  }, [ohlc, spy]);

  const showSkeleton = ohlc.length === 0;
  const lastClose = ohlc.length ? ohlc[ohlc.length - 1].c : null;
  const firstClose = ohlc.length ? ohlc[0].c : null;
  const head = headlineReadout(hoverClose, firstClose, lastClose);

  // Switcher + timeline data from the cross-creator summary.
  const switcherCreators: SwitcherCreator[] = summary.byCreator.map((b) => ({
    handle: b.handle, name: names[b.handle] ?? b.handle, avatar: avatars[b.handle] ?? null,
    lastCallDate: b.lastCallDate, callCount: b.callCount,
  }));
  const timelineCreators: TimelineCreator[] = summary.byCreator.map((b) => ({
    handle: b.handle, name: names[b.handle] ?? b.handle, avatar: avatars[b.handle] ?? null,
    calls: hits.filter((h) => h.handle === b.handle).map((h) => ({ postDate: h.postDate, isFirstCall: h.isFirstCall })),
  }));
  const today = new Date().toISOString().slice(0, 10);

  // Count exactly the calls visible in the chart right now: the same source the
  // markers come from (creator-scoped or all), filtered to the visible window.
  // Reacts to both the creator tab and the timeframe, and stays in lockstep with
  // the rendered markers (label === markers shown).
  const shownCallCount = (creatorHandle ? creatorCalls : hits).filter((c) => inWindow(c.postDate)).length;
  const callsLabel = numberFlowReady ? (
    <NumberFlow value={shownCallCount} suffix={shownCallCount === 1 ? " call" : " calls"} willChange />
  ) : `${shownCallCount} ${shownCallCount === 1 ? "call" : "calls"}`;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-10 md:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Ticker{creatorHandle ? (
              <>
                {" · "}
                <Link
                  to="/c/$handle"
                  params={{ handle: creatorHandle }}
                  className="group inline-flex items-center gap-1 no-underline hover:text-foreground"
                >
                  <span className="group-hover:underline group-hover:underline-offset-2">@{creatorHandle}</span>
                  <span className="icon-[lucide--external-link] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              </>
            ) : " · all creators"}
          </div>
          <h1 className="mt-1 flex items-center gap-2 font-heading text-2xl">
            {symbol}
            <HalalIndicator info={halal} />
            <span className="text-base text-muted-foreground">{data.company}</span>
          </h1>
        </div>
        <CreatorSwitcher symbol={symbol} creators={switcherCreators} selected={creatorHandle} />
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col items-start gap-1 sm:w-auto">
            <div className="flex w-full items-start justify-between gap-3 sm:w-auto sm:justify-start">
              <PriceReadout lastClose={head.close} tfChange={head.change} tfDelta={head.delta} usingFallback={usingFallback} />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:hidden">{callsLabel}</span>
            </div>
            <span className="hidden font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em] sm:block">{callsLabel}</span>
          </div>
          <TimeframeTabs value={timeframe} onChange={(tf) => { impact(); setTimeframe(tf); }} onPrefetch={prefetchTimeframe} />
        </div>
        <div className="relative">
          {showSkeleton ? <CandleSkeleton /> : candles.length === 0 ? (
            <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">No price data for this symbol.</div>
          ) : (
            <ChartBoundary>
              <Suspense fallback={<CandleSkeleton />}>
                <PriceCandles candles={candles} markers={callMarkers} timeframe={view.timeframe} onHoverClose={setHoverClose} iconFill={!creatorHandle} />
              </Suspense>
            </ChartBoundary>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 flex items-start justify-between gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          <span>Stock vs SPY · rebased to 100 · markers are call dates</span>
          <PreviewCard>
            <PreviewCardTrigger
              render={
                <button
                  type="button"
                  aria-label="How to read this chart"
                  className="inline-flex size-3.5 shrink-0 cursor-default items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              <span className="icon-[lucide--circle-help] size-3.5" aria-hidden />
            </PreviewCardTrigger>
            <PreviewCardPopup className="flex-col w-72 normal-case tracking-normal">
              <div className="font-heading text-sm text-foreground">How to read this</div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Both lines start at 100 on the left edge — imagine $100 invested in the stock and $100 in
                SPY at the start of the window. Each line tracks how that $100 grows. When the stock line
                sits above SPY, the stock beat the market over the window.
              </p>
              <p className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                Rebased per timeframe: switching the timeframe resets both to 100 at the new window's
                start. Markers are the creator's call dates.
              </p>
            </PreviewCardPopup>
          </PreviewCard>
        </div>
        {showSkeleton ? <ChartSkeleton /> : norm.length === 0 ? (
          <div role="status" aria-live="polite" className="flex h-[320px] w-full items-center justify-center rounded-xl bg-muted/20 text-sm text-muted-foreground">No price data for this symbol.</div>
        ) : (
          <ChartBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <StockVsSpyLine norm={norm} markers={callMarkers} timeframe={view.timeframe} iconFill={!creatorHandle} />
            </Suspense>
          </ChartBoundary>
        )}
      </section>

      {/* Stock-page halal surface: panel self-gates on the preference and renders
         a muted "Not rated" entry for unknown symbols. */}
      <HalalPanel info={halal} symbol={symbol} />

      {/* Who called it & when. */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5">
          <span>Creator</span>
          <span className="hidden text-right md:block">First call</span>
          <span className="text-right">Excess 3m</span>
          <span className="text-right">Excess→now</span>
        </div>
        <ul className="divide-y divide-border/40">
          {summary.byCreator.map((b) => (
            <li key={b.handle}>
              <Link
                to="/t/$symbol/$creator"
                params={{ symbol, creator: b.handle }}
                aria-current={creatorHandle === b.handle ? "true" : undefined}
                className={`grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-4 no-underline transition-colors hover:bg-foreground/[0.03] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5 ${creatorHandle === b.handle ? "bg-foreground/[0.04]" : ""}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {avatars[b.handle] ? (
                    <img src={avatars[b.handle]} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/60" />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-[10px] uppercase ring-1 ring-border/60">{b.handle.slice(0, 2)}</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm text-foreground">{names[b.handle] ?? b.handle}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{b.callCount} call{b.callCount === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">{b.firstCallDate?.slice(0, 7) ?? "—"}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.ex3m)}`}>{signed(b.ex3m)}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.exToDate)}`}>{signed(b.exToDate)}</div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-border/40 border-t px-4 py-4 md:px-5">
          <div className="mb-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">Call timeline · ★ = first call · hover to compare</div>
          <TickerCallTimeline creators={timelineCreators} rangeStart={firstDate} rangeEnd={today} />
        </div>
      </section>

      {/* Detail table only when a specific creator is selected. */}
      {creatorHandle && (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
          <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">{names[creatorHandle] ?? creatorHandle} · forward return vs SPY · tap a row for proof</div>
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
              {creatorCalls.map((c) => (
                <TableRow key={c.shortcode} onClick={() => { select(); setSelectedCall(c); }} className="cursor-pointer">
                  <TableCell className="font-mono tabular-nums">{c.postDate}{c.isFirstCall ? " ★" : ""}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1w"].excess)}`}>{pct(c.returns["1w"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1m"].excess)}`}>{pct(c.returns["1m"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["3m"].excess)}`}>{pct(c.returns["3m"].excess)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${toneClass(c.returns["toDate"].excess)}`}>{pct(c.returns["toDate"].excess)}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{c.quote}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <ProofViewer call={selectedCall} handle={creatorHandle ?? ""} onClose={() => setSelectedCall(null)} />
    </main>
  );
}

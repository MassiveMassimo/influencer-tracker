import NumberFlow, { type Format, NumberFlowGroup } from "@number-flow/react";
import { useMemo, useState } from "react";
import { createFileRoute, Link, getRouteApi } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useInView } from "#/lib/use-in-view.ts";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";
import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";
import { fetchDataset } from "../lib/data";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { DataAsOf } from "../components/DataAsOf";
import { ChartBoundary } from "../components/ChartBoundary";
import { ConvictionBars, CumulativeExcess, HorizonBars } from "../components/AnalyticsCharts";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import type { Call, Dataset } from "../lib/types";
import { Sparkline } from "#/components/Sparkline.tsx";
import { TextSwap, useTextSwap } from "#/components/text-swap.tsx";
import { IconSwap } from "#/components/icon-swap.tsx";
import { siteUrl } from "#/og/site.ts";
import { ogRev } from "#/og/og-rev.ts";
import { prefetchHalal, useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { type HalalInfo } from "#/lib/halal/types.ts";
import { PreviewCard, PreviewCardTrigger, PreviewCardPopup } from "#/components/ui/preview-card.tsx";
import { TocMinimap } from "#/components/toc-minimap.tsx";
import {
  platformOf,
  profileUrl as profileLink,
  platformIcon as platformIconClass,
} from "#/lib/platform.ts";

const CALLS_PER_PAGE = 25;

export const Route = createFileRoute("/c/$handle/")({
  loader: async ({ params, context }) => {
    const ds = await fetchDataset(params.handle);
    await prefetchHalal(context.queryClient, ds.calls.map((c) => c.ticker));
    return ds;
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const sc = loaderData?.scorecard;
    const rev = ogRev([sc?.avgExcess["3m"], sc?.totalCalls]);
    const img = siteUrl(`/api/og/c/${params.handle}/${rev}`);
    return {
      meta: [
        { title: `${name} · Signal Tracker` },
        {
          name: "description",
          content: `${name}'s stock calls scored by forward return vs SPY.`,
        },
        { property: "og:title", content: `${name} · Signal Tracker` },
        { property: "og:url", content: siteUrl(`/c/${params.handle}`) },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: Overview,
});

const INT_FMT: Format = { maximumFractionDigits: 0 };
const DEC1_FMT: Format = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const PCT_FMT: Format = {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
const SIGNED_PCT_FMT: Format = { ...PCT_FMT, signDisplay: "exceptZero" };

type StatSegment =
  | { kind: "num"; key: string; value: number; format: Format }
  | { kind: "text"; key: string; text: string };

interface StatTileData {
  label: string;
  segments: StatSegment[];
  tone?: number;
  help: { body: string; caveat?: string };
}

// Static formatting that matches NumberFlow's output, for the pre-hydration
// fallback (before the custom element is registered). Pinned locale ("en-US") so
// SSR and client format identically — a default (undefined) locale resolves to the
// runtime locale, which differs between the Vercel server and the user's browser
// → React hydration mismatch (#418).
function formatNum(value: number, format: Format): string {
  return new Intl.NumberFormat("en-US", format).format(value);
}

function toneClass(x: number) {
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}

function ageDays(iso: string) {
  return Math.round((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);
}

// Owns the name swap so its swap re-render reaches the sibling IconSwap, letting
// motion re-measure and slide the platform icon to its new x (rather than jump)
// when the name width changes. IconSwap also cross-fades the glyph on a platform
// change (X <-> IG).
const rootApi = getRouteApi("__root__");

function CreatorHeading({
  name,
  avatar,
  platformIcon,
  profileUrl,
}: {
  name: string;
  avatar?: string;
  platformIcon: string;
  profileUrl: string;
}) {
  const { ref, display } = useTextSwap(name);
  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2.5 text-foreground no-underline"
    >
      {avatar && (
        // em-sized so it rides the .t-ticker-title font-size shrink on scroll
        // (2rem at rest → 1.5rem when stuck). 1.333em × 1.5rem = 2rem.
        <img
          src={avatar}
          alt=""
          className="size-[1.333em] shrink-0 rounded-full object-cover ring-1 ring-border/60"
        />
      )}
      <span
        className="t-text-swap group-hover:underline group-hover:underline-offset-2"
        ref={ref}
      >
        {display}
      </span>
      <IconSwap
        icon={platformIcon}
        className="text-muted-foreground transition-colors group-hover:text-foreground"
      />
    </a>
  );
}

function Overview() {
  const ds = Route.useLoaderData();
  const { handle } = Route.useParams();
  const sc = ds.scorecard;
  // Avatar isn't in dataset.json (handle+name only); read it from the root
  // loader's creators (sourced from index.json) by handle.
  const avatar = rootApi.useLoaderData().creators.find((c) => c.handle === handle)?.avatar;

  const total3m = sc.hitRateN["3m"];
  const made3m = Math.round(sc.hitRate["3m"] * total3m);
  const tiles: StatTileData[] = [
    {
      label: "Total calls",
      segments: [{ kind: "num", key: "v", value: sc.totalCalls, format: INT_FMT }],
      help: {
        body: "Every scored bullish buy call in the tracked window — one per ticker named, so a single post pitching several stocks counts once per stock.",
        caveat: "Watchlist mentions, bearish/short calls, and 'no position' references aren't scored.",
      },
    },
    {
      label: "Unique tickers",
      segments: [
        { kind: "num", key: "v", value: sc.uniqueTickers, format: INT_FMT },
      ],
      help: {
        body: "Distinct symbols across all scored calls. Lower than total calls when the same stock is pitched more than once.",
      },
    },
    {
      label: "Calls / week",
      segments: [
        { kind: "num", key: "v", value: sc.callsPerWeek, format: DEC1_FMT },
      ],
      help: {
        body: "Posting cadence: distinct-ticker calls divided by the weeks between the first and last call.",
        caveat: "An average — real posting is bursty, clustering around earnings and market moves.",
      },
    },
    {
      label: "Hit rate 3m",
      tone: sc.hitRate["3m"] - 0.5,
      segments: [
        { kind: "num", key: "rate", value: sc.hitRate["3m"], format: PCT_FMT },
        { kind: "text", key: "dot", text: " · " },
        { kind: "num", key: "made", value: made3m, format: INT_FMT },
        { kind: "text", key: "slash", text: "/" },
        { kind: "num", key: "total", value: total3m, format: INT_FMT },
      ],
      help: {
        body: "Share of calls that beat SPY over the 3 months after the call (excess return > 0), shown as rate · winners/total. 50% is the coin-flip baseline.",
        caveat: "Scored on one call per ticker (highest conviction); only calls with a full 3 months elapsed count.",
      },
    },
    {
      label: "Avg excess 3m",
      tone: sc.avgExcess["3m"],
      segments: [
        {
          kind: "num",
          key: "v",
          value: sc.avgExcess["3m"],
          format: SIGNED_PCT_FMT,
        },
      ],
      help: {
        body: "Equal-weight average return vs SPY, 3 months after each call. Positive = beat the market. The curve above plots this over time.",
        caveat: "Equal-weight and not risk-adjusted; one call per ticker (highest conviction).",
      },
    },
  ];

  // Condensed stats that ride into the sticky bar as the overview row scrolls
  // away — derived from `tiles` (single source) so the two can't drift. Takes
  // each tile's first numeric segment; decorative/aria-hidden (the live tiles
  // below own NumberFlow).
  const statBar = tiles.map((t) => {
    const seg = t.segments.find((s): s is Extract<StatSegment, { kind: "num" }> => s.kind === "num")!;
    return { label: t.label, text: formatNum(seg.value, seg.format), tone: t.tone };
  });

  const [statsRef, statsInView] = useInView<HTMLElement>();

  const calls = [...ds.calls].sort((a, b) => b.postDate.localeCompare(a.postDate));

  const platform = platformOf(String(ds.calls[0]?.shortcode ?? ""));
  const profileUrl = profileLink(platform, ds.creator.handle);
  const platformIcon = platformIconClass(platform);

  return (
    <main className="t-creator-main space-y-6 py-8 md:py-10">
      <TocMinimap
        items={[
          { title: "Overview", url: "#overview", depth: 2 },
          { title: "Performance", url: "#performance", depth: 2 },
          { title: "Analytics", url: "#analytics", depth: 2 },
          { title: "Calls", url: "#calls", depth: 2 },
        ]}
        className="fixed top-1/2 right-3 hidden -translate-y-1/2 2xl:flex"
      />
      <header className="t-ticker-header t-creator-bar sticky top-12 z-20 flex h-[60px] border-b border-transparent bg-background/80 backdrop-blur-md md:top-0">
        <div className="t-ticker-pad relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-10">
          {/* Identity — shown only at md+ (below md MobileNav owns it, so no
              doubling). Persistent: stays put on scroll while the date/stats
              crossfade plays in the right zone. */}
          <div className="shrink-0 max-md:hidden">
            <div className="t-ticker-label font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Signal accuracy · <TextSwap value={`@${ds.creator.handle}`} />
            </div>
            <h1 className="t-ticker-title mt-1 font-heading text-2xl">
              <CreatorHeading name={ds.creator.name} avatar={avatar} platformIcon={platformIcon} profileUrl={profileUrl} />
            </h1>
          </div>
          {/* Right zone — flex-1 so the stats scroll inside the remaining width
              instead of reserving their content width and squeezing the name.
              Date (top) crossfades to the stat summary on scroll; both are
              absolutely stacked so neither sizes the zone. */}
          <div className="relative min-w-0 flex-1 self-stretch">
            <div className="t-stick-fade absolute inset-y-0 right-0 flex items-center justify-end text-right max-md:hidden">
              <DataAsOf iso={ds.generatedAt} />
              {ageDays(ds.generatedAt) > 30 && (
                <span className="ml-2 font-mono text-[10px] text-amber-600 uppercase tracking-[0.2em] dark:text-amber-400">· data {ageDays(ds.generatedAt)}d old</span>
              )}
            </div>
            {/* Persistent stat summary (the overview tiles scroll away → this
                stays). aria-hidden: duplicates the still-mounted tiles. Scrolls
                horizontally with an edge fade when the five don't fit. */}
            {/* Two nested layers because they each own an `animation`, which can't
                share one element: the OUTER runs the scroll-driven opacity rise
                (root timeline); the INNER is the scroll container running the edge
                fade (self timeline). Putting both on one element made the rise win
                and froze the mask. */}
            <div aria-hidden className="t-stick-rise absolute inset-0 opacity-0">
              {/* ms-auto on the first stat right-aligns the row when it fits, but
                  collapses to 0 on overflow so scroll-to-start still reaches the
                  first stat. */}
              <div className="t-stat-scroll flex size-full items-center overflow-x-auto scroll-fade-effect-x">
                {/* pe matches the fade width so when the row fits (right-aligned)
                    the right fade lands on empty padding, not the last stat. */}
                <div className="flex w-full items-center gap-4 pe-4 font-mono md:gap-5 [&>:first-child]:ms-auto">
                  {statBar.map((s) => (
                    <span key={s.label} className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap text-[8px] text-muted-foreground uppercase tracking-[0.2em]">{s.label}</span>
                      <span className={`text-sm tabular-nums ${s.tone !== undefined ? toneClass(s.tone) : "text-foreground"}`}>{s.text}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 md:px-10">

      <section
        id="overview"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-3 lg:grid-cols-5"
        ref={statsRef}
      >
        <NumberFlowGroup>
          {tiles.map((t) => (
            <StatTile key={t.label} revealed={statsInView} tile={t} />
          ))}
        </NumberFlowGroup>
      </section>

      <section id="performance" className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Performance vs SPY · cumulative
          <span className="ml-1 normal-case tracking-normal opacity-70">(equal-weight, not risk-adjusted)</span>
        </div>
        <div className="mt-3">
          <ChartBoundary>
            <CumulativeExcess ds={ds} />
          </ChartBoundary>
        </div>
      </section>

      <section id="analytics" className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 lg:grid-cols-2">
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Avg excess vs SPY · by horizon
            <span className="ml-1 normal-case tracking-normal opacity-70">(not risk-adjusted)</span>
          </div>
          <div className="mt-3">
            <HorizonBars ds={ds} />
          </div>
        </div>
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Avg excess vs SPY · by conviction
            <span className="ml-1 normal-case tracking-normal opacity-70">(not risk-adjusted)</span>
          </div>
          <div className="mt-3">
            <ConvictionBars ds={ds} />
          </div>
        </div>
      </section>

      <CallsList handle={handle} calls={calls} ds={ds} />

      <CaveatsBanner caveats={ds.caveats} />
      </div>
    </main>
  );
}

function StatTile({
  tile,
  revealed,
}: {
  tile: StatTileData;
  revealed: boolean;
}) {
  const ready = useNumberFlowReady();
  // Touch devices render static text — no enter spin (matches the ticker page).
  const isTouch = useTouchPrimary();
  const useNumber = ready && !isTouch;
  const toneCls =
    tile.tone !== undefined ? toneClass(tile.tone) : "text-foreground";

  return (
    <div className="bg-background p-4">
      <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        {tile.label}
        <PreviewCard>
          <PreviewCardTrigger
            render={
              <button
                type="button"
                aria-label={`What is ${tile.label}?`}
                className="inline-flex size-3.5 cursor-default items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              />
            }
          >
            <span className="icon-[lucide--circle-help] size-3.5" aria-hidden />
          </PreviewCardTrigger>
          <PreviewCardPopup className="flex-col w-72 normal-case tracking-normal">
            <div className="font-heading text-sm text-foreground">{tile.label}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{tile.help.body}</p>
            {tile.help.caveat && (
              <p className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground/80">{tile.help.caveat}</p>
            )}
          </PreviewCardPopup>
        </PreviewCard>
      </div>
      <div className={`mt-1.5 font-heading text-xl tabular-nums ${toneCls}`}>
        {tile.segments.map((seg) =>
          seg.kind === "text" ? (
            <span key={seg.key}>{seg.text}</span>
          ) : useNumber ? (
            <NumberFlow
              format={seg.format}
              isolate
              locales="en-US"
              key={seg.key}
              value={revealed ? seg.value : 0}
              willChange
            />
          ) : (
            <span key={seg.key}>{formatNum(seg.value, seg.format)}</span>
          )
        )}
      </div>
    </div>
  );
}

function CallsList({
  handle,
  calls,
  ds,
}: {
  handle: string;
  calls: Call[];
  ds: Dataset;
}) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(calls.length / CALLS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * CALLS_PER_PAGE;
  const visible = calls.slice(start, start + CALLS_PER_PAGE);
  const allTickers = useMemo(() => calls.map((c) => c.ticker), [calls]);
  const getHalal = useHalalStatus(allTickers);

  return (
    <section id="calls" className="overflow-hidden rounded-2xl border border-border/60 bg-background">
      <div className="flex items-center justify-between border-border/40 border-b px-5 py-3">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Calls
        </span>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          {calls.length} signals · newest first
        </span>
      </div>
      <ul className="divide-border/40 divide-y">
        {visible.map((c) => (
          <CallRow
            key={`${c.shortcode}:${c.ticker}`}
            handle={handle}
            call={c}
            halalInfo={getHalal(c.ticker)}
          />
        ))}
        {calls.length === 0 && (
          <li className="px-5 py-6 text-sm text-muted-foreground">No calls yet.</li>
        )}
      </ul>
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-border/40 border-t px-3 py-3">
          <span className="hidden pl-2 font-mono text-[10px] text-muted-foreground tabular-nums sm:block">
            {start + 1}–{start + visible.length} of {calls.length}
          </span>
          <CallsPagination current={current} pageCount={pageCount} onSelect={setPage} />
        </div>
      )}
      <span className="sr-only">{ds.creator.handle} calls list</span>
    </section>
  );
}

// Windowed page list: first, last, and a span around the current page, with
// ellipses bridging any gaps (e.g. 1 … 6 7 8 … 36).
function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const n of pages) {
    if (n - prev > 1) out.push("ellipsis");
    out.push(n);
    prev = n;
  }
  return out;
}

function CallsPagination({
  current,
  pageCount,
  onSelect,
}: {
  current: number;
  pageCount: number;
  onSelect: (page: number) => void;
}) {
  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={current === 1}
            onClick={(e) => {
              e.preventDefault();
              if (current > 1) onSelect(current - 1);
            }}
          />
        </PaginationItem>
        {pageWindow(current, pageCount).map((p, i) =>
          p === "ellipsis" ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                href="#"
                isActive={p === current}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(p);
                }}
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={current === pageCount}
            onClick={(e) => {
              e.preventDefault();
              if (current < pageCount) onSelect(current + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function CallRow({ handle, call, halalInfo }: { handle: string; call: Call; halalInfo: HalalInfo }) {
  const excess = call.returns.toDate.excess;
  // Status dot: pending when no elapsed return, else beat/lag vs SPY.
  const dot =
    excess == null
      ? "bg-muted-foreground/40"
      : excess >= 0
        ? "bg-emerald-500"
        : "bg-rose-500";
  const up = (excess ?? 0) >= 0;
  return (
    <li>
      <Link
        to="/t/$symbol/$creator"
        params={{ symbol: call.ticker, creator: handle }}
        className="flex items-center gap-4 px-5 py-3 no-underline transition-colors hover:bg-foreground/[0.03]"
      >
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-sm text-foreground">{call.ticker}</span>
            <HalalIndicator info={halalInfo} />
            {call.isFirstCall && (
              <span
                title="Only the earliest call per ticker is scored; later calls on the same ticker are not counted."
                className="rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-foreground"
              >
                first
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{call.company}</div>
        </div>
        <div className="hidden shrink-0 sm:block">
          <Sparkline closes={call.spark ?? []} excess={call.returns.toDate.excess} />
        </div>
        <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {call.postDate}
        </div>
        <div
          className={`flex w-24 shrink-0 items-center justify-end gap-1 font-mono text-sm tabular-nums ${toneClass(excess ?? 0)}`}
        >
          {excess == null ? (
            <span className="text-muted-foreground">pending</span>
          ) : (
            <>
              {up ? (
                <ArrowUpRightIcon className="size-3.5" />
              ) : (
                <ArrowDownRightIcon className="size-3.5" />
              )}
              {formatNum(excess, SIGNED_PCT_FMT)}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

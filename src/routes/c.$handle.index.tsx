import type { Format } from "@number-flow/react";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, getRouteApi } from "@tanstack/react-router";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";
import { ScrittoNumber, ScrittoText } from "#/components/scritto-number.tsx";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { DataAsOf } from "../components/DataAsOf";
import { GradeDetail } from "#/components/grade-detail";
import { TraitBadges } from "#/components/trait-badges";
import { IdentityMenu } from "#/components/identity-menu";
import { ChartBoundary } from "../components/ChartBoundary";
import { ConvictionBars, CumulativeExcess, HorizonBars } from "../components/AnalyticsCharts";
import { NavMenu } from "../components/ui/nav-menu";
import { NavButton } from "../components/ui/nav-button";
import { NavRow } from "../components/ui/nav-row";
import { Button } from "../components/ui/button";
import { StatGrid } from "../components/ui/stat-grid";
import type { Call } from "../lib/types";
import { Sparkline } from "#/components/Sparkline.tsx";
import { IconSwap } from "#/components/icon-swap.tsx";
import { siteUrl } from "#/og/site.ts";
import { ogRev } from "#/og/og-rev.ts";
import { prefetchHalal, useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { type HalalInfo } from "#/lib/halal/types.ts";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";
import { TocMinimap } from "#/components/toc-minimap.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import {
  platformOf,
  profileUrl as profileLink,
  platformIcon as platformIconClass,
} from "#/lib/platform.ts";
import { fetchCreatorOverview } from "#/lib/creator-fetch";
import { CREATOR_CALLS_PAGE_SIZE, type CreatorCallsPage } from "#/lib/creator-data";
import { creatorCallsPageQuery } from "#/lib/creator-query";
import { CallActivity } from "#/components/call-activity";
import { buildHitRateTile, PCT_FMT } from "#/components/creator-stat-data";

export const Route = createFileRoute("/c/$handle/")({
  loader: async ({ params, context }) => {
    const overview = await fetchCreatorOverview({ data: { handle: params.handle } });
    await prefetchHalal(
      context.queryClient,
      overview.initialPage.calls.map((call) => call.ticker),
    );
    return overview;
  },
  staleTime: 5 * 60 * 1000,
  head: ({ params, loaderData }) => {
    const name = loaderData?.dataset.creator.name ?? params.handle;
    const sc = loaderData?.dataset.scorecard;
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

// Keeps the creator text and platform icon in one measured row so both transitions
// respond to the same creator change.
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
      <ScrittoText
        className="inline-block group-hover:underline group-hover:underline-offset-2"
        value={name}
      />
      <IconSwap
        animatePosition={false}
        icon={platformIcon}
        className="text-muted-foreground transition-colors group-hover:text-foreground"
      />
    </a>
  );
}

function Overview() {
  const overview = Route.useLoaderData();
  const ds = overview.dataset;
  const { handle } = Route.useParams();
  const sc = ds.scorecard;
  // Avatar isn't in dataset.json (handle+name only); read it from the root
  // loader's creators (sourced from index.json) by handle.
  const avatar = rootApi.useLoaderData().creators.find((c) => c.handle === handle)?.avatar;

  const tiles: StatTileData[] = [
    {
      label: "Total calls",
      segments: [{ kind: "num", key: "v", value: sc.totalCalls, format: INT_FMT }],
      help: {
        body: "Every scored bullish buy call in the tracked window — one per ticker named, so a single post pitching several stocks counts once per stock.",
        caveat:
          "Watchlist mentions, bearish/short calls, and 'no position' references aren't scored.",
      },
    },
    {
      label: "Unique tickers",
      segments: [{ kind: "num", key: "v", value: sc.uniqueTickers, format: INT_FMT }],
      help: {
        body: "Distinct symbols across all scored calls. Lower than total calls when the same stock is pitched more than once.",
      },
    },
    {
      label: "Calls / week",
      segments: [{ kind: "num", key: "v", value: sc.callsPerWeek, format: DEC1_FMT }],
      help: {
        body: "Posting cadence: distinct-ticker calls divided by the weeks between the first and last call.",
        caveat: "An average — real posting is bursty, clustering around earnings and market moves.",
      },
    },
    buildHitRateTile({ hitRate: sc.hitRate["3m"], total: sc.hitRateN["3m"] }),
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
  // below own the animated values).
  const statBar = tiles.map((t) => {
    const seg = t.segments.find(
      (s): s is Extract<StatSegment, { kind: "num" }> => s.kind === "num",
    )!;
    return {
      label: t.label,
      text: formatNum(seg.value, seg.format),
      tone: t.tone,
    };
  });

  const grade = overview.grade;
  const traits = overview.traits;
  // Header medallion shows at md+, the grid-cell one below md — only animate the
  // visible one (false on SSR/first paint → both idle until this resolves).
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const platform = platformOf(String(overview.initialPage.calls[0]?.shortcode ?? ""));
  const profileUrl = profileLink(platform, ds.creator.handle);
  const platformIcon = platformIconClass(platform);

  return (
    <main className="t-creator-main space-y-6 py-8 md:py-10">
      <TocMinimap
        items={[
          { title: "Performance", url: "#performance", depth: 2 },
          { title: "Analytics", url: "#analytics", depth: 2 },
          { title: "Calls", url: "#calls", depth: 2 },
        ]}
        className="t-toc-minimap fixed right-3 hidden -translate-y-1/2 2xl:flex"
      />
      <header className="t-ticker-header t-creator-bar sticky top-12 z-20 flex h-[60px] border-b border-transparent bg-background/80 backdrop-blur-md md:top-0 md:rounded-tl-3xl group-data-[collapsed=true]/panel:md:rounded-tl-none">
        <div className="t-ticker-pad relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-10">
          {/* Identity — shown only at md+ (below md MobileNav owns it, so no
              doubling). Persistent: stays put on scroll while the date/stats
              crossfade plays in the right zone. */}
          <div className="shrink-0 max-md:hidden">
            <div className="t-ticker-label font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
              Signal accuracy ·{" "}
              <ScrittoText className="inline-block" value={`@${ds.creator.handle}`} />
            </div>
            <h1 className="t-ticker-title mt-1 font-heading text-2xl">
              <CreatorHeading
                name={ds.creator.name}
                avatar={avatar}
                platformIcon={platformIcon}
                profileUrl={profileUrl}
              />
            </h1>
          </div>
          {/* Right zone — flex-1 so the stats scroll inside the remaining width
              instead of reserving their content width and squeezing the name.
              Date (top) crossfades to the stat summary on scroll; both are
              absolutely stacked so neither sizes the zone. */}
          <div className="relative min-w-0 flex-1 self-stretch">
            {/* inset-x-0 (full width), not right-0 (shrink-to-content): gives IdentityMenu's
                Root a stable, non-collapsing frame so popLayout-exited badges don't drift
                right over the medallion. justify-end keeps content right-aligned as before.
                Faded-out on scroll it sets pointer-events:none, so the wider box is inert. */}
            <div className="t-stick-fade absolute inset-0 flex items-center justify-end text-right max-md:hidden">
              {grade ? (
                <IdentityMenu grade={grade} traits={traits} active={isDesktop} />
              ) : (
                <>
                  <DataAsOf iso={ds.generatedAt} />
                  {ageDays(ds.generatedAt) > 30 && (
                    <span className="ml-2 font-mono text-[10px] tracking-[0.2em] text-amber-600 uppercase dark:text-amber-400">
                      · data {ageDays(ds.generatedAt)}d old
                    </span>
                  )}
                </>
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
              <div className="t-stat-scroll flex size-full scroll-fade-x items-center overflow-x-auto">
                {/* pe matches the fade width so when the row fits (right-aligned)
                    the right fade lands on empty padding, not the last stat. */}
                <div className="flex w-full items-center gap-4 pe-4 font-mono md:gap-5 [&>:first-child]:ms-auto">
                  {statBar.map((s) => (
                    <span key={s.label} className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[8px] tracking-[0.2em] whitespace-nowrap text-muted-foreground uppercase">
                        {s.label}
                      </span>
                      <span
                        className={`text-sm tabular-nums ${s.tone !== undefined ? toneClass(s.tone) : "text-foreground"}`}
                      >
                        {s.text}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 md:px-10">
        <StatGrid id="overview" gridClassName="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <StatTile key={t.label} tile={t} />
          ))}
          {/* Fills the empty 6th grid cell on mobile; md+ shows the grade in the
              header instead, so hide it there to keep the 5-col row full. */}
          {grade && (
            <div className="grid place-items-center gap-2 bg-card p-4 md:hidden">
              <GradeDetail
                grade={grade}
                fontSize="0.4rem"
                letterClassName="text-xl"
                active={!isDesktop}
              />
              <TraitBadges traits={traits} />
            </div>
          )}
        </StatGrid>
      </div>

      <section id="performance" className="py-6">
        <div className="mx-auto max-w-6xl px-4 font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase md:px-16">
          Performance vs SPY · cumulative
          <span className="ml-1 block tracking-normal normal-case opacity-70 md:inline">
            (equal-weight, not risk-adjusted)
          </span>
        </div>
        <div className="mt-3">
          <ChartBoundary>
            <CumulativeExcess scorecard={ds.scorecard} nPicks={overview.scoredPickCount} />
          </ChartBoundary>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-4 md:px-10">
        <StatGrid id="analytics" gridClassName="grid-cols-1 lg:grid-cols-2">
          <CallActivity
            activity={overview.activity}
            creatorHandle={ds.creator.handle}
            generatedAt={ds.generatedAt}
          />
          <div className="bg-card p-6">
            <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
              Avg excess vs SPY · by horizon
              <span className="ml-1 tracking-normal normal-case opacity-70">
                (not risk-adjusted)
              </span>
            </div>
            <div className="mt-3">
              <HorizonBars scorecard={ds.scorecard} />
            </div>
          </div>
          <div className="bg-card p-6">
            <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
              Avg excess vs SPY · by conviction
              <span className="ml-1 tracking-normal normal-case opacity-70">
                (not risk-adjusted)
              </span>
            </div>
            <div className="mt-3">
              <ConvictionBars rows={overview.convictionRows} />
            </div>
          </div>
        </StatGrid>

        <CallsList handle={handle} initialPage={overview.initialPage} />

        <CaveatsBanner caveats={ds.caveats} />
      </div>
    </main>
  );
}

function StatTile({ tile }: { tile: StatTileData }) {
  // Touch devices retain the existing static fallback.
  const isTouch = useTouchPrimary();
  const animateNumber = !isTouch;
  const toneCls = tile.tone !== undefined ? toneClass(tile.tone) : "text-foreground";
  const primaryNumber = tile.segments.find(
    (segment): segment is Extract<StatSegment, { kind: "num" }> => segment.kind === "num",
  )!;

  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-1 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
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
          <PreviewCardPopup className="w-72 flex-col tracking-normal normal-case">
            <div className="font-heading text-sm text-foreground">{tile.label}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{tile.help.body}</p>
            {tile.help.caveat && (
              <p className="mt-2 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                {tile.help.caveat}
              </p>
            )}
          </PreviewCardPopup>
        </PreviewCard>
      </div>
      <div className={`mt-1.5 font-heading text-xl tabular-nums ${toneCls}`}>
        {animateNumber ? (
          <ScrittoNumber format={primaryNumber.format} value={primaryNumber.value} />
        ) : (
          tile.segments.map((seg) =>
            seg.kind === "text" ? (
              <span key={seg.key}>{seg.text}</span>
            ) : (
              <span key={seg.key}>{formatNum(seg.value, seg.format)}</span>
            ),
          )
        )}
      </div>
    </div>
  );
}

function CallsList({ handle, initialPage }: { handle: string; initialPage: CreatorCallsPage }) {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const pageCount = initialPage.pageCount;
  const current = Math.min(page, pageCount);
  const query = useQuery({
    ...creatorCallsPageQuery(handle, current),
    initialData: current === 1 ? initialPage : undefined,
  });
  const pageData = query.data ?? initialPage;
  const displayedPage = pageData.currentPage;
  const visible = pageData.calls;
  const start = (displayedPage - 1) * CREATOR_CALLS_PAGE_SIZE;
  const visibleTickers = useMemo(() => visible.map((call) => call.ticker), [visible]);
  const getHalal = useHalalStatus(visibleTickers);

  const prefetchPage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > pageCount || nextPage === displayedPage) return;
    void queryClient.prefetchQuery(creatorCallsPageQuery(handle, nextPage));
  };

  // Row-click opens proof; siblings = other tickers named in the same post.
  const [selected, setSelected] = useState<Call | null>(null);
  const siblings = useMemo(
    () =>
      selected
        ? {
            [selected.shortcode]: (pageData.posts[selected.shortcode] ?? []).filter(
              (call) => call.ticker !== selected.ticker,
            ),
          }
        : undefined,
    [pageData.posts, selected],
  );

  return (
    <section
      id="calls"
      aria-busy={query.isPlaceholderData}
      className="overflow-hidden rounded-2xl bg-card shadow-surface-2"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Calls
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          {initialPage.totalCalls} signals · newest first
        </span>
      </div>
      {initialPage.totalCalls === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">No calls yet.</div>
      ) : (
        <NavMenu activeSlug={null} radius="rounded-none" separated aria-label="Calls">
          {visible.map((c, i) => (
            <CallRow
              key={`${c.shortcode}:${c.ticker}`}
              index={i}
              handle={handle}
              call={c}
              halalInfo={getHalal(c.ticker)}
              onSelect={setSelected}
            />
          ))}
        </NavMenu>
      )}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-border/40 px-3 py-3">
          <div className="min-w-0 pl-2 font-mono text-[10px] text-muted-foreground tabular-nums">
            <span className="hidden sm:inline">
              {start + 1}–{start + visible.length} of {initialPage.totalCalls}
            </span>
            {query.isPlaceholderData && (
              <span role="status" className="sm:ml-2">
                Loading page {current}…
              </span>
            )}
            {query.isError && (
              <button
                type="button"
                className="ml-2 text-rose-600 hover:underline dark:text-rose-400"
                onClick={() => void query.refetch()}
              >
                Page {current} failed. Retry
              </button>
            )}
          </div>
          <CallsPagination
            current={displayedPage}
            pageCount={pageCount}
            onSelect={setPage}
            onPrefetch={prefetchPage}
          />
        </div>
      )}
      <span className="sr-only">{handle} calls list</span>
      <ProofViewer
        call={selected}
        handle={handle}
        siblings={siblings}
        onClose={() => setSelected(null)}
      />
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
  onPrefetch,
}: {
  current: number;
  pageCount: number;
  onSelect: (page: number) => void;
  onPrefetch: (page: number) => void;
}) {
  // Number strip is a horizontal NavMenu (variant="tabs") so the current page
  // gets the same sliding raised-surface pill as the FF tabs; the ellipsis is an
  // unregistered spacer the pill slides across. Prev/next are FF ghost buttons.
  const items: ReactNode[] = [];
  let idx = 0;
  for (const [k, p] of pageWindow(current, pageCount).entries()) {
    if (p === "ellipsis") {
      items.push(
        <span
          key={`gap-${k}`}
          aria-hidden
          className="flex h-8 min-w-8 items-center justify-center text-muted-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </span>,
      );
      continue;
    }
    items.push(
      <NavButton
        key={p}
        index={idx}
        slug={String(p)}
        aria-label={`Go to page ${p}`}
        data-cuelume-toggle="page"
        onClick={() => onSelect(p)}
        onPointerMove={() => onPrefetch(p)}
        onFocus={() => onPrefetch(p)}
        className="h-8 min-w-8 px-2 tabular-nums"
      >
        {p}
      </NavButton>,
    );
    idx++;
  }
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Go to previous page"
        data-cuelume-toggle="page"
        disabled={current === 1}
        onClick={() => onSelect(current - 1)}
        onPointerEnter={() => onPrefetch(current - 1)}
        onFocus={() => onPrefetch(current - 1)}
      >
        <ChevronLeftIcon />
      </Button>
      <NavMenu
        activeSlug={String(current)}
        orientation="horizontal"
        variant="tabs"
        aria-label="Pagination"
      >
        {items}
      </NavMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Go to next page"
        data-cuelume-toggle="page"
        disabled={current === pageCount}
        onClick={() => onSelect(current + 1)}
        onPointerEnter={() => onPrefetch(current + 1)}
        onFocus={() => onPrefetch(current + 1)}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

function CallRow({
  index,
  handle,
  call,
  halalInfo,
  onSelect,
}: {
  index: number;
  handle: string;
  call: Call;
  halalInfo: HalalInfo;
  onSelect: (call: Call) => void;
}) {
  const excess = call.returns.toDate.excess;
  // Status dot: pending when no elapsed return, else beat/lag vs SPY.
  const dot =
    excess == null ? "bg-muted-foreground/40" : excess >= 0 ? "bg-emerald-500" : "bg-rose-500";
  const up = (excess ?? 0) >= 0;
  return (
    <NavRow
      index={index}
      slug={`${call.shortcode}:${call.ticker}`}
      onActivate={() => onSelect(call)}
      aria-label={`View proof for ${call.ticker}`}
      className="flex items-center gap-4 px-5 py-3"
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to="/t/$symbol/$creator"
            params={{ symbol: call.ticker, creator: handle }}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 font-mono text-sm text-foreground no-underline hover:underline!"
          >
            {call.ticker}
          </Link>
          <HalalIndicator info={halalInfo} />
          {call.isFirstCall && (
            <span
              title="Only the earliest call per ticker is scored; later calls on the same ticker are not counted."
              className="rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.15em] text-foreground uppercase"
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
    </NavRow>
  );
}

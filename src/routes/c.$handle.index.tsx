import NumberFlow, { type Format, NumberFlowGroup } from "@number-flow/react";
import { lazy, Suspense, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useInView } from "#/lib/use-in-view.ts";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";
import { fetchDataset } from "../lib/data";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { DataAsOf } from "../components/DataAsOf";
import { ChartBoundary } from "../components/ChartBoundary";
import { ConvictionScatter, HorizonBars } from "../components/AnalyticsCharts";

// Gauge + Funnel pull motion + @visx; lazy-load them so that chunk stays off the
// creator route's initial/hydration path (cuts TBT/LCP). The native HTML/SVG
// HorizonBars + ConvictionScatter have no heavy deps and stay eager.
const HitRateGauge = lazy(() =>
  import("../components/AnalyticsCharts").then((m) => ({ default: m.HitRateGauge })),
);
const CallFunnel = lazy(() =>
  import("../components/AnalyticsCharts").then((m) => ({ default: m.CallFunnel })),
);
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
import { siteUrl } from "#/og/site.ts";

const CALLS_PER_PAGE = 25;

export const Route = createFileRoute("/c/$handle/")({
  loader: ({ params }) => fetchDataset(params.handle),
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}.png`);
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

// Cascade offset between adjacent stat tiles; per-flow count duration.
const STAGGER_MS = 90;
const FLOW_DURATION_MS = 700;

type StatSegment =
  | { kind: "num"; key: string; value: number; format: Format }
  | { kind: "text"; key: string; text: string };

interface StatTileData {
  label: string;
  segments: StatSegment[];
  tone?: number;
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

function Overview() {
  const ds = Route.useLoaderData();
  const { handle } = Route.useParams();
  const sc = ds.scorecard;

  const total3m = sc.hitRateN["3m"];
  const made3m = Math.round(sc.hitRate["3m"] * total3m);
  const tiles: StatTileData[] = [
    {
      label: "Total calls",
      segments: [{ kind: "num", key: "v", value: sc.totalCalls, format: INT_FMT }],
    },
    {
      label: "Unique tickers",
      segments: [
        { kind: "num", key: "v", value: sc.uniqueTickers, format: INT_FMT },
      ],
    },
    {
      label: "Calls / week",
      segments: [
        { kind: "num", key: "v", value: sc.callsPerWeek, format: DEC1_FMT },
      ],
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
    },
  ];

  const [statsRef, statsInView] = useInView<HTMLElement>();

  const calls = [...ds.calls].sort((a, b) => b.postDate.localeCompare(a.postDate));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-10 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Signal accuracy · @{ds.creator.handle}
          </div>
          <h1 className="mt-1 font-heading text-2xl">{ds.creator.name}</h1>
        </div>
        <div>
          <DataAsOf iso={ds.generatedAt} />
          {ageDays(ds.generatedAt) > 30 && (
            <span className="ml-2 font-mono text-[10px] text-amber-600 uppercase tracking-[0.2em] dark:text-amber-400">· data {ageDays(ds.generatedAt)}d old</span>
          )}
        </div>
      </header>

      <section
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-3 lg:grid-cols-5"
        ref={statsRef}
      >
        <NumberFlowGroup>
          {tiles.map((t, i) => (
            <StatTile index={i} key={t.label} revealed={statsInView} tile={t} />
          ))}
        </NumberFlowGroup>
      </section>

      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 lg:grid-cols-[1fr_320px]">
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Hit rate · calls beating SPY (3m)
          </div>
          <div className="mt-4">
            <ChartBoundary>
              <Suspense
                fallback={<div className="h-[180px] w-full animate-pulse rounded-md bg-muted/40" />}
              >
                <HitRateGauge ds={ds} />
              </Suspense>
            </ChartBoundary>
          </div>
        </div>
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Call funnel
          </div>
          <div className="mt-4">
            <ChartBoundary>
              <Suspense
                fallback={<div className="h-[240px] w-full animate-pulse rounded-md bg-muted/40" />}
              >
                <CallFunnel ds={ds} />
              </Suspense>
            </ChartBoundary>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 lg:grid-cols-2">
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
            Conviction vs return
          </div>
          <div className="mt-3">
            <ConvictionScatter ds={ds} />
          </div>
        </div>
      </section>

      <CallsList handle={handle} calls={calls} ds={ds} />

      <CaveatsBanner caveats={ds.caveats} />
    </main>
  );
}

function StatTile({
  tile,
  index,
  revealed,
}: {
  tile: StatTileData;
  index: number;
  revealed: boolean;
}) {
  const ready = useNumberFlowReady();
  // Stagger the cascade by tile position; all segments of one tile share its slot.
  const delay = index * STAGGER_MS;
  const toneCls =
    tile.tone !== undefined ? toneClass(tile.tone) : "text-foreground";

  return (
    <div className="bg-background p-4">
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        {tile.label}
      </div>
      <div className={`mt-1.5 font-heading text-xl tabular-nums ${toneCls}`}>
        {tile.segments.map((seg) =>
          seg.kind === "text" ? (
            <span key={seg.key}>{seg.text}</span>
          ) : ready ? (
            <NumberFlow
              format={seg.format}
              isolate
              locales="en-US"
              key={seg.key}
              opacityTiming={{ duration: 350, delay, easing: "ease-out" }}
              transformTiming={{
                duration: FLOW_DURATION_MS,
                delay,
                easing: "ease-out",
              }}
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

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
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

function CallRow({ handle, call }: { handle: string; call: Call }) {
  const excess = call.returns.toDate.excess;
  // Status dot: pending when no elapsed return, else beat/lag vs SPY.
  const dot =
    excess == null
      ? "bg-muted-foreground/40"
      : excess >= 0
        ? "bg-emerald-500"
        : "bg-rose-500";
  const up = (excess ?? 0) >= 0;
  const [valueRef, valueInView] = useInView<HTMLDivElement>();
  const ready = useNumberFlowReady();
  return (
    <li>
      <Link
        to="/c/$handle/ticker/$symbol"
        params={{ handle, symbol: call.ticker }}
        className="flex items-center gap-4 px-5 py-3 no-underline transition-colors hover:bg-foreground/[0.03]"
      >
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-sm text-foreground">{call.ticker}</span>
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
          ref={valueRef}
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
              {ready ? (
                <NumberFlow
                  format={SIGNED_PCT_FMT}
                  isolate
                  locales="en-US"
                  trend={up ? 1 : -1}
                  value={valueInView ? excess : 0}
                  willChange
                />
              ) : (
                formatNum(excess, SIGNED_PCT_FMT)
              )}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

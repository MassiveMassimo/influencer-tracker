import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { getDataset } from "../lib/data";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { ChartBoundary } from "../components/ChartBoundary";
import {
  CallFunnel,
  ConvictionScatter,
  HitRateGauge,
  HorizonBars,
} from "../components/AnalyticsCharts";
import type { Call, Dataset, OhlcBar } from "../lib/types";
import { Sparkline } from "#/components/Sparkline.tsx";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/c/$handle/")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}`);
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

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

function signed(x: number) {
  return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
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

  const tiles: { label: string; value: string; tone?: number }[] = [
    { label: "Total calls", value: String(sc.totalCalls) },
    { label: "Unique tickers", value: String(sc.uniqueTickers) },
    { label: "Calls / week", value: sc.callsPerWeek.toFixed(1) },
    { label: "Hit rate 3m", value: `${pct(sc.hitRate["3m"])} · ${Math.round(sc.hitRate["3m"] * sc.hitRateN["3m"])}/${sc.hitRateN["3m"]}`, tone: sc.hitRate["3m"] - 0.5 },
    { label: "Avg excess 3m", value: signed(sc.avgExcess["3m"]), tone: sc.avgExcess["3m"] },
  ];

  const calls = [...ds.calls].sort((a, b) => b.postDate.localeCompare(a.postDate));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Signal accuracy · @{ds.creator.handle}
          </div>
          <h1 className="mt-1 font-heading text-2xl">{ds.creator.name}</h1>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          as of {ds.generatedAt}
          {ageDays(ds.generatedAt) > 30 && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">· data {ageDays(ds.generatedAt)}d old</span>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <StatTile key={t.label} {...t} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 lg:grid-cols-[1fr_320px]">
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Hit rate · calls beating SPY (3m)
          </div>
          <div className="mt-4">
            <ChartBoundary>
              <HitRateGauge ds={ds} />
            </ChartBoundary>
          </div>
        </div>
        <div className="bg-background p-6">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Call funnel
          </div>
          <div className="mt-4">
            <ChartBoundary>
              <CallFunnel ds={ds} />
            </ChartBoundary>
          </div>
        </div>
      </section>

      <CallsList handle={handle} calls={calls} ds={ds} />

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

      <CaveatsBanner caveats={ds.caveats} />
    </main>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="bg-background p-4">
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
        {label}
      </div>
      <div
        className={`mt-1.5 font-heading text-xl tabular-nums ${tone !== undefined ? toneClass(tone) : "text-foreground"}`}
      >
        {value}
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
        {calls.map((c) => (
          <CallRow
            key={c.shortcode}
            handle={handle}
            call={c}
            bars={(ds.tickers[c.ticker]?.ohlc ?? []).filter((b) => b.date >= c.postDate)}
          />
        ))}
        {calls.length === 0 && (
          <li className="px-5 py-6 text-sm text-muted-foreground">No calls yet.</li>
        )}
      </ul>
      <span className="sr-only">{ds.creator.handle} calls list</span>
    </section>
  );
}

function CallRow({ handle, call, bars }: { handle: string; call: Call; bars: OhlcBar[] }) {
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
        to="/c/$handle/ticker/$symbol"
        params={{ handle, symbol: call.ticker }}
        className="flex items-center gap-4 px-5 py-3 no-underline transition-colors hover:bg-foreground/[0.03]"
      >
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">{call.ticker}</span>
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
          <Sparkline bars={bars} excess={call.returns.toDate.excess} />
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
              {signed(excess)}
            </>
          )}
        </div>
      </Link>
    </li>
  );
}

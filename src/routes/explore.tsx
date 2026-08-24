import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCallsIndex, listCreators } from "../lib/data";
import { applyCallFilter, type CallFilter, type SortKey } from "../lib/call-filter";
import type { CallIndexEntry } from "../lib/call-index";
import { DataAsOf } from "../components/DataAsOf";
import { siteUrl } from "#/og/site.ts";
import { prefetchHalal, useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import { NavMenu } from "#/components/ui/nav-menu.tsx";
import { NavRow } from "#/components/ui/nav-row.tsx";
import { callsIndexQuery } from "#/lib/calls-index-query.ts";
import { EXPLORE_VISIBLE_STEP, buildExploreInitialData } from "#/lib/explore-data.ts";

export const Route = createFileRoute("/explore")({
  loader: async ({ context }) => {
    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    const initial = buildExploreInitialData(calls);
    await prefetchHalal(
      context.queryClient,
      initial.calls.slice(0, EXPLORE_VISIBLE_STEP).map((call) => call.ticker),
    );
    // The calls-index artifact ships as a plain array with no generatedAt; use the freshest
    // creator's generatedAt as the cross-creator "data as of" (newest scoring run in the set).
    const generatedAt = creators.reduce<string>(
      (max, c) => (c.generatedAt > max ? c.generatedAt : max),
      "",
    );
    // Only handle + name are used (the creator chips + the names map); drop the inlined
    // base64 avatars and stats so they aren't dehydrated into the SSR HTML (the root
    // loader already ships the full roster — no need to duplicate the avatar payload here).
    return {
      ...initial,
      generatedAt,
      creators: creators.map((c) => ({ handle: c.handle, name: c.name })),
    };
  },
  staleTime: 5 * 60 * 1000,
  head: () => ({
    meta: [
      { title: "Explore all calls — Signal Tracker" },
      {
        name: "description",
        content: "Filter, sort, and search every scored stock call across all tracked creators.",
      },
      { property: "og:url", content: siteUrl("/explore") },
      { property: "og:image", content: siteUrl("/og.png") },
    ],
  }),
  component: Explore,
});

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function tone(x: number | null) {
  return x == null
    ? "text-muted-foreground"
    : x > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : x < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground";
}

function Explore() {
  const { calls: initialCalls, totalCalls, generatedAt, creators } = Route.useLoaderData();
  const [loadFullIndex, setLoadFullIndex] = useState(false);
  const callsQuery = useQuery({
    ...callsIndexQuery(),
    enabled: loadFullIndex,
    placeholderData: initialCalls,
  });
  const calls = callsQuery.data ?? initialCalls;
  useEffect(() => {
    const timer = window.setTimeout(() => setLoadFullIndex(true), 5_000);
    return () => window.clearTimeout(timer);
  }, []);
  const names = useMemo(
    () => Object.fromEntries(creators.map((c) => [c.handle, c.name])),
    [creators],
  );
  const [filter, setFilter] = useState<CallFilter>({
    search: "",
    handles: [],
    firstOnly: false,
    beatSpyOnly: false,
    horizon: "ex3m",
    sort: { key: "postDate", dir: -1 },
  });
  const deferredFilter = useDeferredValue(filter);
  const rows = useMemo(
    () => applyCallFilter(calls, deferredFilter, names),
    [calls, deferredFilter, names],
  );
  const [visibleCount, setVisibleCount] = useState(EXPLORE_VISIBLE_STEP);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const visibleTickers = useMemo(() => visibleRows.map((call) => call.ticker), [visibleRows]);
  const getHalal = useHalalStatus(visibleTickers);
  // Selected call → proof viewer. Index rows carry no `quote` (slim asset), so the
  // viewer shows the embed + summary; siblings = other tickers in the same post.
  const [selected, setSelected] = useState<CallIndexEntry | null>(null);
  const siblings = useMemo(
    () =>
      selected
        ? {
            [selected.shortcode]: calls.reduce<{ ticker: string; company: string }[]>((acc, c) => {
              if (
                c.handle === selected.handle &&
                c.shortcode === selected.shortcode &&
                c.ticker !== selected.ticker
              ) {
                acc.push({ ticker: c.ticker, company: c.company });
              }
              return acc;
            }, []),
          }
        : undefined,
    [selected, calls],
  );
  const onSort = (key: SortKey) => {
    setLoadFullIndex(true);
    setVisibleCount(EXPLORE_VISIBLE_STEP);
    setFilter((f) => ({
      ...f,
      sort: f.sort.key === key ? { key, dir: (f.sort.dir * -1) as 1 | -1 } : { key, dir: -1 },
    }));
  };
  const toggleHandle = (h: string) => {
    setLoadFullIndex(true);
    setVisibleCount(EXPLORE_VISIBLE_STEP);
    setFilter((f) => ({
      ...f,
      handles: f.handles.includes(h) ? f.handles.filter((x) => x !== h) : [...f.handles, h],
    }));
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          All calls · vs SPY
        </div>
        <h1 className="mt-1 font-heading text-2xl">Explore calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every scored call across all creators. Filter, sort, and search (all client-side over one
          cached index, {totalCalls} calls).
        </p>
        {generatedAt && <DataAsOf iso={generatedAt} className="mt-2 block" />}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search ticker, company, or creator"
          value={filter.search}
          onFocus={() => setLoadFullIndex(true)}
          onChange={(e) => {
            setLoadFullIndex(true);
            setVisibleCount(EXPLORE_VISIBLE_STEP);
            setFilter((f) => ({ ...f, search: e.target.value }));
          }}
          placeholder="Search ticker, company, creator…"
          className="h-9 w-full max-w-xs rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/30 md:w-64"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filter.firstOnly}
            onChange={(e) => {
              setLoadFullIndex(true);
              setVisibleCount(EXPLORE_VISIBLE_STEP);
              setFilter((f) => ({ ...f, firstOnly: e.target.checked }));
            }}
          />
          First calls only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filter.beatSpyOnly}
            onChange={(e) => {
              setLoadFullIndex(true);
              setVisibleCount(EXPLORE_VISIBLE_STEP);
              setFilter((f) => ({ ...f, beatSpyOnly: e.target.checked }));
            }}
          />
          Beat SPY (3m)
        </label>
      </div>

      {creators.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {creators.map((c) => {
            const on = filter.handles.includes(c.handle);
            return (
              <button
                key={c.handle}
                type="button"
                onClick={() => toggleHandle(c.handle)}
                className={`rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${on ? "border-foreground/30 bg-foreground/[0.08] text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >
                @{c.handle}
              </button>
            );
          })}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-card shadow-surface-2">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase md:grid-cols-[1fr_8rem_6rem_6rem_6rem] md:gap-3 md:px-5">
          <span>Call</span>
          <button
            type="button"
            className="hidden text-right hover:text-foreground md:block"
            onClick={() => onSort("postDate")}
          >
            Date
          </button>
          <button
            type="button"
            className="text-right hover:text-foreground"
            onClick={() => onSort("conviction")}
          >
            Conv
          </button>
          <button
            type="button"
            className="text-right hover:text-foreground"
            onClick={() => onSort("ex3m")}
          >
            Excess 3m
          </button>
          <button
            type="button"
            className="hidden text-right hover:text-foreground md:block"
            onClick={() => onSort("exToDate")}
          >
            Excess→now
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">No calls match.</div>
        ) : (
          <NavMenu activeSlug={null} radius="rounded-none" separated aria-label="Calls">
            {visibleRows.map((r, i) => (
              <NavRow
                key={`${r.handle}:${r.shortcode}:${r.ticker}`}
                index={i}
                slug={`${r.handle}:${r.shortcode}:${r.ticker}`}
                onActivate={() => setSelected(r)}
                aria-label={`View proof for ${r.ticker} call by @${r.handle}`}
                className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-3 md:grid-cols-[1fr_8rem_6rem_6rem_6rem] md:gap-3 md:px-5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/t/$symbol/$creator"
                      params={{ symbol: r.ticker, creator: "all" }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium text-foreground no-underline hover:underline"
                    >
                      {r.ticker}
                    </Link>
                    <HalalIndicator info={getHalal(r.ticker)} />
                    <Link
                      to="/c/$handle"
                      params={{ handle: r.handle }}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate font-mono text-xs text-muted-foreground no-underline hover:text-foreground"
                    >
                      @{r.handle}
                    </Link>
                  </div>
                  {r.summary && (
                    <div className="truncate text-xs text-muted-foreground">{r.summary}</div>
                  )}
                </div>
                <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">
                  {r.postDate.slice(5)}
                </div>
                <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {(r.conviction * 100).toFixed(0)}
                </div>
                <div className={`text-right font-mono text-sm tabular-nums ${tone(r.ex3m)}`}>
                  {signed(r.ex3m)}
                </div>
                <div
                  className={`hidden text-right font-mono text-sm tabular-nums md:block ${tone(r.exToDate)}`}
                >
                  {signed(r.exToDate)}
                </div>
              </NavRow>
            ))}
          </NavMenu>
        )}
        {visibleRows.length < rows.length && (
          <div className="border-t border-border/40 px-5 py-3 text-center">
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onPointerEnter={() => setLoadFullIndex(true)}
              onFocus={() => setLoadFullIndex(true)}
              onClick={() => setVisibleCount((count) => count + EXPLORE_VISIBLE_STEP)}
            >
              Show {Math.min(EXPLORE_VISIBLE_STEP, rows.length - visibleRows.length)} more ·{" "}
              {visibleRows.length} of {rows.length}
            </button>
          </div>
        )}
      </section>

      <ProofViewer
        call={selected}
        handle={selected?.handle ?? ""}
        siblings={siblings}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}

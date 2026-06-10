import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { fetchCallsIndex, listCreators } from "../lib/data";
import { summarizeTicker } from "../lib/call-filter";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/t/$symbol")({
  loader: async ({ params }) => {
    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    const summary = summarizeTicker(calls, params.symbol);
    if (summary.callCount === 0) throw notFound();
    const names = Object.fromEntries(creators.map((c) => [c.handle, c.name] as const));
    const avatars = Object.fromEntries(creators.map((c) => [c.handle, c.avatar] as const));
    return { summary, names, avatars };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.symbol.toUpperCase()} — who called it · Signal Tracker` },
      { name: "description", content: `Every tracked creator who called ${params.symbol.toUpperCase()}, ranked by forward return vs SPY.` },
      { property: "og:url", content: siteUrl(`/t/${params.symbol.toUpperCase()}`) },
      { property: "og:image", content: siteUrl("/og.png") },
    ],
  }),
  component: TickerView,
});

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function tone(x: number | null) {
  return x == null ? "text-muted-foreground" : x > 0 ? "text-emerald-600 dark:text-emerald-400" : x < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
}

function TickerView() {
  const { summary, names, avatars } = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">Cross-creator · vs SPY</div>
        <h1 className="mt-1 font-heading text-2xl">{summary.symbol}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{summary.company}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Creators" value={String(summary.creatorCount)} />
          <Stat label="Calls" value={String(summary.callCount)} />
          <Stat label="Avg excess 3m" value={signed(summary.avgEx3m)} toneClass={tone(summary.avgEx3m)} />
          <Stat label="Avg excess→now" value={signed(summary.avgExToDate)} toneClass={tone(summary.avgExToDate)} />
        </div>
      </header>

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
                to="/c/$handle/ticker/$symbol"
                params={{ handle: b.handle, symbol: summary.symbol }}
                className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-4 no-underline transition-colors hover:bg-foreground/[0.03] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5"
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
                <div className={`text-right font-mono text-sm tabular-nums ${tone(b.ex3m)}`}>{signed(b.ex3m)}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${tone(b.exToDate)}`}>{signed(b.exToDate)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value, toneClass = "text-foreground" }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-foreground/[0.02] px-3 py-2.5">
      <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.2em]">{label}</div>
      <div className={`mt-0.5 font-mono text-lg tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

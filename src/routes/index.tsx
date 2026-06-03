import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useState } from "react";
import { listCreators } from "../lib/data";
import { LOW_CONFIDENCE_N } from "../lib/scorecard";

export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  component: Landing,
});

type Creator = Awaited<ReturnType<typeof listCreators>>[number];
type SortKey = "hitRate3m" | "avgExcess3m" | "totalCalls";

function pct(x: number) { return `${(x * 100).toFixed(0)}%`; }
function signed(x: number) { return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`; }
function lowConf(c: Creator) { return c.hitRate3mN < LOW_CONFIDENCE_N; }

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

// Proven creators first; within each group sort by key desc. Low-confidence always last.
function sortCreators(creators: Creator[], key: SortKey, dir: 1 | -1): Creator[] {
  return [...creators].sort((a, b) => {
    const la = lowConf(a) ? 1 : 0, lb = lowConf(b) ? 1 : 0;
    if (la !== lb) return la - lb;
    return (a[key] - b[key]) * dir;
  });
}

function Landing() {
  const creators = Route.useLoaderData();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "hitRate3m", dir: -1 });
  const rows = sortCreators(creators, sort.key, sort.dir);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Signal Tracker · vs SPY
        </div>
        <h1 className="mt-1 font-heading text-2xl">Influencer accuracy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranked by 3-month hit rate — share of first calls per ticker that beat SPY. Sample size shown; thin samples are flagged and ranked last.
        </p>
      </header>

      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creators yet. Run the pipeline.</p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
          <div className="grid grid-cols-[2rem_1fr_7rem_6rem_5rem_5rem] items-center gap-3 border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            <span>#</span>
            <span>Creator</span>
            <button type="button" className="text-right hover:text-foreground" onClick={() => onSort("hitRate3m")}>Hit 3m</button>
            <button type="button" className="text-right hover:text-foreground" onClick={() => onSort("avgExcess3m")}>Excess 3m</button>
            <button type="button" className="text-right hover:text-foreground" onClick={() => onSort("totalCalls")}>Calls</button>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-border/40 divide-y">
            {rows.map((c, i) => (
              <li key={c.handle}>
                <Link
                  to="/c/$handle"
                  params={{ handle: c.handle }}
                  className="grid grid-cols-[2rem_1fr_7rem_6rem_5rem_5rem] items-center gap-3 px-5 py-4 no-underline transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="flex min-w-0 items-center gap-3">
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border/60" />
                    ) : (
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-xs uppercase text-foreground ring-1 ring-border/60">
                        {c.handle.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm text-foreground">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">@{c.handle}</div>
                    </div>
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    <div className="text-foreground">{pct(c.hitRate3m)}</div>
                    <div className={`text-[10px] ${lowConf(c) ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {lowConf(c) ? `low · ${Math.round(c.hitRate3m * c.hitRate3mN)}/${c.hitRate3mN}` : `${Math.round(c.hitRate3m * c.hitRate3mN)}/${c.hitRate3mN}`}
                    </div>
                  </div>
                  <div className={`flex items-center justify-end gap-1 font-mono text-sm tabular-nums ${c.avgExcess3m > 0 ? "text-emerald-600 dark:text-emerald-400" : c.avgExcess3m < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                    {c.avgExcess3m > 0 ? <ArrowUpRightIcon className="size-3.5" /> : c.avgExcess3m < 0 ? <ArrowDownRightIcon className="size-3.5" /> : null}
                    {signed(c.avgExcess3m)}
                  </div>
                  <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">{c.totalCalls}</div>
                  <div className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">{relativeDate(c.generatedAt)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

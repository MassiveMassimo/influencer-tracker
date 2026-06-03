import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { listCreators } from "../lib/data";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  head: () => ({
    meta: [
      { title: "Signal Tracker — influencer accuracy vs SPY" },
      { property: "og:url", content: siteUrl("/") },
      { property: "og:image", content: siteUrl("/og.png") },
      { name: "twitter:image", content: siteUrl("/og.png") },
    ],
  }),
  component: Landing,
});

function Landing() {
  const creators = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Signal Tracker · vs SPY
        </div>
        <h1 className="mt-1 font-heading text-2xl">Influencer accuracy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forward returns of stock calls measured from post date, net of SPY.
        </p>
      </header>

      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creators yet. Run the pipeline.</p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
          <div className="flex items-center justify-between border-border/40 border-b px-5 py-3">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              Creators
            </span>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              {creators.length} tracked
            </span>
          </div>
          <ul className="divide-border/40 divide-y">
            {creators.map((c) => {
              const up = c.avgExcess3m >= 0;
              return (
                <li key={c.handle}>
                  <Link
                    to="/c/$handle"
                    params={{ handle: c.handle }}
                    className="flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-foreground/[0.03]"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-xs uppercase text-foreground ring-1 ring-border/60">
                      {c.handle.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-foreground">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">@{c.handle}</div>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {c.totalCalls} calls
                    </div>
                    <div
                      className={`flex w-24 shrink-0 items-center justify-end gap-1 font-mono text-sm tabular-nums ${
                        up
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {up ? (
                        <ArrowUpRightIcon className="size-3.5" />
                      ) : (
                        <ArrowDownRightIcon className="size-3.5" />
                      )}
                      {`${c.avgExcess3m > 0 ? "+" : ""}${(c.avgExcess3m * 100).toFixed(1)}%`}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

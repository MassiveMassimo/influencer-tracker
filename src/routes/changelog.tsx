import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { siteUrl } from "#/og/site.ts";
import { CHANGELOG_ENTRIES } from "#/lib/changelog-data.ts";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — Signal Tracker" },
      { name: "description", content: "Notable changes to Signal Tracker, newest first." },
      { property: "og:title", content: "Changelog — Signal Tracker" },
      { property: "og:description", content: "Notable changes to Signal Tracker, newest first." },
      { property: "og:url", content: siteUrl("/changelog") },
      { property: "og:image", content: siteUrl("/og.png") },
    ],
  }),
  component: Changelog,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Format the raw ISO heading manually (no Date) so UTC-vs-local never shifts the day.
function fmtDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

// Keep a Changelog tags → semantic tone. Unknown tags fall back to neutral.
const TONE: Record<string, string> = {
  Added: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  Changed: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-400",
  Fixed: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  Removed: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
  Deprecated: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  Security: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
};
const TONE_FALLBACK = "bg-foreground/[0.06] text-muted-foreground";

// Minimal inline-markdown renderer: code, links, bold, italic (no nesting — the
// changelog never nests inline marks). Cheaper than pulling in a markdown library.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <code key={key++} className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(
        <a key={key++} href={m[3]} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2 hover:no-underline">
          {m[2]}
        </a>,
      );
    } else if (m[4] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {m[4]}
        </strong>,
      );
    } else if (m[5] !== undefined) {
      nodes.push(<em key={key++}>{m[5]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Changelog() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-10 md:py-12">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">Changelog</div>
        <h1 className="mt-1 font-heading text-2xl tracking-tight md:text-3xl">What's new</h1>
        <p className="mt-1 text-sm text-muted-foreground">Notable changes, newest first.</p>
      </header>

      <div className="mt-8">
        {CHANGELOG_ENTRIES.map((e, i) => {
          const latest = i === 0;
          const isLast = i === CHANGELOG_ENTRIES.length - 1;
          return (
            <article key={e.date} className="grid grid-cols-[auto_1fr] gap-x-4 md:gap-x-6">
              {/* Timeline rail: dot + connecting line (line omitted on the last entry). */}
              <div className="flex flex-col items-center">
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${latest ? "bg-emerald-500" : "border border-border bg-background"}`} />
                {!isLast && <span className="my-1 w-px flex-1 bg-border/60" />}
              </div>

              <div className={`min-w-0 ${isLast ? "" : "pb-10"}`}>
                <div className="flex items-center gap-2">
                  <time className="font-mono text-xs text-muted-foreground tabular-nums">{fmtDate(e.date)}</time>
                  {latest && (
                    <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
                      Latest
                    </span>
                  )}
                </div>

                {e.groups.map((g, gi) => (
                  <div key={gi} className="mt-4 first:mt-3">
                    {g.tag && (
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${TONE[g.tag] ?? TONE_FALLBACK}`}>
                        {g.tag}
                      </span>
                    )}
                    <ul className="mt-2 space-y-1.5">
                      {g.items.map((it, ii) => (
                        <li key={ii} className="flex gap-2 text-sm leading-relaxed text-foreground/85">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                          <span className="min-w-0">{renderInline(it)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

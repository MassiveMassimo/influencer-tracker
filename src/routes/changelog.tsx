import { createFileRoute } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { siteUrl } from "#/og/site.ts";
import { CHANGELOG_ENTRIES } from "#/lib/changelog-data.ts";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — Signal Tracker" },
      { name: "description", content: "What's new on Signal Tracker, newest first." },
      { property: "og:title", content: "Changelog — Signal Tracker" },
      { property: "og:description", content: "What's new on Signal Tracker, newest first." },
      { property: "og:url", content: siteUrl("/changelog") },
      { property: "og:image", content: siteUrl("/og/changelog.png") },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Changelog — Signal Tracker" },
      { name: "twitter:description", content: "What's new on Signal Tracker, newest first." },
      { name: "twitter:image", content: siteUrl("/og/changelog.png") },
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

// Display labels for the markdown ### tags. Authored tags ("New"/"Improved") pass
// through; Keep a Changelog tags map to the friendlier wording. Unknown → as-is.
const LABEL: Record<string, string> = {
  Added: "New",
  Changed: "Improved",
  Fixed: "Fixed",
  Removed: "Removed",
  Deprecated: "Deprecated",
  Security: "Security",
};

// Two tiers (maestri-style). "Block" tags are the marquee features — rendered as
// title + paragraph. Every other tag (Fixed, Also, Details, …) renders as a compact
// bulleted list for the smaller, more specific stuff.
const BLOCK_TAGS = new Set(["New", "Improved", "Added", "Changed"]);

// A feature item authored as "**Title** — description" renders title + paragraph
// (maestri-style hierarchy); anything else is a plain bullet.
const TITLE_RE = /^\*\*(.+?)\*\*\s*[—–-]\s+(.+)$/;
function splitTitle(item: string): { title: string; body: string } | null {
  const m = TITLE_RE.exec(item);
  return m ? { title: m[1], body: m[2] } : null;
}

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
        <p className="mt-2 max-w-prose text-sm text-muted-foreground leading-relaxed">
          New features, improvements, and fixes — newest first. Spot a call we got wrong? Every
          call has a "Report incorrect" button.
        </p>
      </header>

      <div className="mt-10">
        {CHANGELOG_ENTRIES.map((e, i) => {
          const latest = i === 0;
          return (
            <article
              key={e.date}
              className="grid grid-cols-1 gap-x-6 border-border/40 py-10 first:pt-0 md:grid-cols-[150px_1fr] md:gap-x-10 md:py-14 [&:not(:first-child)]:border-t"
            >
              {/* Sticky date column (devl-style). */}
              <aside className="self-start md:sticky md:top-8">
                <div className="flex items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-full ${latest ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  <time className="font-mono text-xs text-muted-foreground uppercase tracking-[0.15em] tabular-nums">
                    {fmtDate(e.date)}
                  </time>
                </div>
                {latest && (
                  <span className="mt-2 ml-3.5 inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 font-mono text-[9px] text-background uppercase tracking-[0.2em]">
                    <SparklesIcon className="size-2.5" />
                    Latest
                  </span>
                )}
              </aside>

              <div className="mt-4 min-w-0 md:mt-0">
                {e.tagline && (
                  <div className="mb-7 rounded-xl border border-border/60 bg-gradient-to-br from-emerald-500/10 via-foreground/[0.03] to-indigo-500/10 px-5 py-4">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
                      <SparklesIcon className="size-3" />
                      Highlight
                    </div>
                    <p className="mt-1.5 font-heading text-lg leading-snug text-foreground">
                      {renderInline(e.tagline)}
                    </p>
                  </div>
                )}

                {e.groups.map((g, gi) => (
                  <section key={gi} className="mt-7 first:mt-0">
                    {g.tag && (
                      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
                        {LABEL[g.tag] ?? g.tag}
                      </div>
                    )}
                    {BLOCK_TAGS.has(g.tag) ? (
                      // Marquee features — title + paragraph.
                      <div className="mt-3 space-y-4">
                        {g.items.map((it, ii) => {
                          const feature = splitTitle(it);
                          return feature ? (
                            <div key={ii}>
                              <h3 className="font-medium text-foreground text-sm">{renderInline(feature.title)}</h3>
                              <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                                {renderInline(feature.body)}
                              </p>
                            </div>
                          ) : (
                            <p key={ii} className="text-sm text-foreground/85 leading-relaxed">
                              {renderInline(it)}
                            </p>
                          );
                        })}
                      </div>
                    ) : (
                      // The specific/minor stuff — a compact bulleted list (the bold
                      // "**Title** —" lead renders inline, like maestri's point releases).
                      <ul className="mt-3 space-y-2">
                        {g.items.map((it, ii) => (
                          <li key={ii} className="flex gap-2.5 text-sm text-foreground/85 leading-relaxed">
                            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                            <span className="min-w-0">{renderInline(it)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

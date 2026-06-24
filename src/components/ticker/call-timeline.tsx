import NumberFlow, { type Format } from "@number-flow/react";
import { Link } from "@tanstack/react-router";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useMemo, useRef, useState } from "react";
import type { TickerCreatorRow } from "#/lib/call-filter.ts";
import { timelineTicks, timelineXPercent } from "#/lib/call-timeline-layout.ts";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready.ts";

const YEAR_FMT: Format = { useGrouping: false };
const PAD2_FMT: Format = { minimumIntegerDigits: 2 };
const pad2 = (n: number) => String(n).padStart(2, "0");

// Scrub-indicator date. Each part rolls independently with NumberFlow (odometer
// feel) as the crosshair moves; pre-hydration renders the plain string.
function DateChip({ ms, ready }: { ms: number; ready: boolean }) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (!ready) return <>{`${y}-${pad2(mo)}-${pad2(day)}`}</>;
  return (
    <span className="inline-flex items-center">
      <NumberFlow format={YEAR_FMT} isolate locales="en-US" value={y} willChange />-
      <NumberFlow format={PAD2_FMT} isolate locales="en-US" value={mo} willChange />-
      <NumberFlow format={PAD2_FMT} isolate locales="en-US" value={day} willChange />
    </span>
  );
}

// Local presentation helpers (the route keeps its own copies; duplicating these
// one-liners avoids a circular import — the route imports this component).
function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}

interface Hit {
  handle: string;
  postDate: string;
  isFirstCall: boolean;
}

// The avatar + fixed-width name block before the inline dot track. Mirrored by
// the crosshair overlay and the axis ruler so all three share one x-origin.
const LEAD = (
  <>
    <div className="size-8 shrink-0" />
    <div className="w-36 shrink-0" />
  </>
);

const GRID =
  "md:grid md:grid-cols-[1fr_7rem_6rem_6rem] md:gap-2 md:px-5";

// Width of the hover-highlight band (px); dots within HALF brighten.
const BAND_PX = 56;
const HALF_BAND_PX = BAND_PX / 2;

export function CompareTable({
  rows,
  names,
  avatars,
  hits,
  symbol,
  creatorHandle,
  rangeStart,
  rangeEnd,
}: {
  rows: TickerCreatorRow[];
  names: Record<string, string>;
  avatars: Record<string, string | null | undefined>;
  hits: Hit[];
  symbol: string;
  creatorHandle: string | null;
  rangeStart: string;
  rangeEnd: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ ms: number; pct: number; bandPct: number } | null>(null);
  const ready = useNumberFlowReady();
  const reduce = useReducedMotion();

  // Crosshair x (%) driven through a spring so it glides — both during scrub
  // and, more visibly, when the magnet snaps it onto a call column.
  const pctMV = useMotionValue(0);
  const pctSpring = useSpring(pctMV, { stiffness: 550, damping: 42, mass: 0.45 });
  const left = useTransform(pctSpring, (v) => `${v}%`);
  // bklit `showHighlight` analog: a brighter band of the dashed baseline that
  // springs along with the crosshair. Dots inside HALF_BAND_PX brighten too.
  const bandLeft = useTransform(pctSpring, (v) => `calc(${v}% - ${HALF_BAND_PX}px)`);

  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const ticks = timelineTicks(startMs, endMs);

  const callsByHandle = new Map<string, Hit[]>();
  for (const h of hits) {
    const a = callsByHandle.get(h.handle);
    if (a) a.push(h);
    else callsByHandle.set(h.handle, [h]);
  }

  // Unique call-date columns across all creators, sorted by x, as snap targets.
  // The median gap between columns gates + sizes the magnet so dense timelines
  // (many calls) don't snap — see onMove.
  const { targets, medianGapPct } = useMemo(() => {
    const byMs = new Map<number, number>();
    for (const h of hits) {
      const ms = Date.parse(h.postDate);
      if (!byMs.has(ms)) byMs.set(ms, timelineXPercent(ms, startMs, endMs));
    }
    const ts = [...byMs.entries()]
      .map(([ms, pct]) => ({ ms, pct }))
      .sort((a, b) => a.pct - b.pct);
    if (ts.length < 2) return { targets: ts, medianGapPct: 100 };
    const gaps = ts.slice(1).map((t, i) => t.pct - ts[i].pct).sort((a, b) => a - b);
    return { targets: ts, medianGapPct: gaps[Math.floor(gaps.length / 2)] };
  }, [hits, startMs, endMs]);

  // Pointer x → percent of the (md-only) dot-track region, read off the overlay
  // ref so the crosshair maps to the same coordinate space as the row dots.
  const onMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const raw = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));

    // Magnetic snap to the nearest call column — only when columns are
    // comfortably spaced. Radius < half the median gap, so the cursor is never
    // in range of two columns at once (no jitter); on a crowded axis the gap is
    // too small and snapping is skipped entirely.
    let pct = raw;
    const medianGapPx = (medianGapPct / 100) * rect.width;
    if (targets.length && medianGapPx >= 24) {
      const radiusPx = Math.min(14, medianGapPx * 0.35);
      let best = targets[0];
      for (const t of targets) {
        if (Math.abs(t.pct - raw) < Math.abs(best.pct - raw)) best = t;
      }
      if ((Math.abs(best.pct - raw) / 100) * rect.width <= radiusPx) pct = best.pct;
    }
    const ms = startMs + (pct / 100) * (endMs - startMs);
    pctMV.set(pct);
    // Jump (skip the glide) when first appearing or for reduced-motion users.
    if (reduce || hover === null) pctSpring.jump(pct);
    setHover({ ms, pct, bandPct: (BAND_PX / rect.width) * 100 });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
      <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5">
        <div className="flex items-center gap-3">
          <div className="hidden size-8 shrink-0 md:block" />
          <span className="md:w-36 md:shrink-0">Creator</span>
          <span className="hidden flex-1 md:ml-6 md:block">Call timeline</span>
        </div>
        <span className="hidden text-right md:block">First call</span>
        <span className="text-right">Excess 3m</span>
        <span className="text-right">Excess→now</span>
      </div>

      <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <ul className="divide-y divide-border/40">
          {rows.map((b) => {
            const creatorCalls = callsByHandle.get(b.handle) ?? [];
            return (
              <li key={b.handle}>
                <Link
                  to="/t/$symbol/$creator"
                  params={{ symbol, creator: b.handle }}
                  aria-current={creatorHandle === b.handle ? "true" : undefined}
                  className={`grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-4 no-underline transition-colors hover:bg-foreground/[0.03] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5 ${creatorHandle === b.handle ? "bg-foreground/[0.04]" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {avatars[b.handle] ? (
                      <img
                        src={avatars[b.handle]!}
                        alt=""
                        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/60"
                      />
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-[10px] uppercase ring-1 ring-border/60">
                        {b.handle.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 md:w-36 md:flex-none">
                      <div className="truncate font-medium text-sm text-foreground">{names[b.handle] ?? b.handle}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {b.callCount} call{b.callCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    {/* Inline dot track (md+). Same lead+offset as the overlay/ruler. */}
                    <div className="relative hidden h-8 flex-1 md:ml-6 md:block">
                      {/* Dashed baseline, mirrors the charts' dashed axis line. */}
                      <div className="-translate-y-1/2 absolute top-1/2 right-0 left-0 border-foreground/15 border-t border-dashed" />
                      {/* showHighlight band — a brighter slice of the baseline that
                          springs with the crosshair; fades in/out on hover. Clipped
                          to the track so it can't spill past the left/right ends. */}
                      <div className="pointer-events-none absolute inset-0 overflow-hidden">
                        <motion.div
                          className={`-translate-y-1/2 absolute top-1/2 h-px rounded-full bg-foreground/40 transition-opacity duration-200 ${hover ? "opacity-100" : "opacity-0"}`}
                          style={{ left: bandLeft, width: BAND_PX }}
                        />
                      </div>
                      {creatorCalls.map((c, i) => {
                        const dotPct = timelineXPercent(Date.parse(c.postDate), startMs, endMs);
                        // Proximity to the crosshair: 0 at the band edge, 1 dead
                        // centre — drives the highlight overlay's opacity so the
                        // dot fades in as the indicator line crosses it.
                        const t =
                          hover && hover.bandPct > 0
                            ? Math.max(0, 1 - Math.abs(dotPct - hover.pct) / (hover.bandPct / 2))
                            : 0;
                        return (
                          <span key={`${c.postDate}-${i}`} title={c.postDate}>
                            <span
                              className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-1.5 rounded-full border border-foreground/40 bg-background"
                              style={{ left: `${dotPct}%` }}
                            />
                            {/* Highlight overlay — opacity tracks proximity directly
                                (no transition, so peak opacity lands exactly under
                                the crosshair, not lagging behind it). */}
                            <span
                              className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2 rounded-full bg-foreground ring-2 ring-background"
                              style={{ left: `${dotPct}%`, opacity: t }}
                            />
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">
                    {b.firstCallDate?.slice(0, 7) ?? "—"}
                  </div>
                  <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.ex3m)}`}>{signed(b.ex3m)}</div>
                  <div className={`text-right font-mono text-sm tabular-nums ${toneClass(b.exToDate)}`}>{signed(b.exToDate)}</div>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Shared crosshair overlay — mirrors the row grid so the full-height
            guide aligns with every row's inline dots. md+ only, click-through. */}
        <div className={`pointer-events-none absolute inset-0 hidden px-4 ${GRID}`}>
          <div className="flex gap-3">
            {LEAD}
            <div ref={trackRef} className="relative h-full flex-1 md:ml-6">
              {/* Faint full-height gridlines aligned with the month-axis ticks. */}
              {ticks.map((t) => (
                <div
                  key={t.pct}
                  className="absolute top-0 bottom-0 border-foreground/7 border-l border-dashed"
                  style={{ left: `${t.pct}%` }}
                />
              ))}
              {hover && (
                <>
                  <motion.div className="absolute top-0 bottom-0 w-px bg-foreground/30" style={{ left }} />
                  <motion.span
                    className="-translate-x-1/2 absolute top-1 whitespace-nowrap rounded bg-foreground px-1 font-mono text-[9px] text-background tabular-nums"
                    style={{ left }}
                  >
                    <DateChip ms={hover.ms} ready={ready} />
                  </motion.span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Month-axis ruler — same grid mirror so ticks align with the dots. */}
      <div className={`hidden border-border/40 border-t px-4 py-3 md:px-5 ${GRID}`}>
        <div className="flex gap-3">
          {LEAD}
          <div className="relative h-4 flex-1 md:ml-6">
            {ticks.map((t) => (
              <span
                key={t.pct}
                className="-translate-x-1/2 absolute whitespace-nowrap font-mono text-[10px] text-muted-foreground tabular-nums"
                style={{ left: `${t.pct}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

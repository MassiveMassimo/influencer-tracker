import { useRef, useState } from "react";
import { timelineTicks, timelineXPercent } from "#/lib/call-timeline-layout.ts";

export interface TimelineCreator {
  handle: string;
  name: string;
  avatar: string | null;
  calls: { postDate: string; isFirstCall: boolean }[];
}

const ROW_H = 30;

export function TickerCallTimeline({
  creators,
  rangeStart,
  rangeEnd,
}: {
  creators: TimelineCreator[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string>("");

  if (creators.length === 0) return null;

  const startMs = Date.parse(rangeStart);
  const endMs = Date.parse(rangeEnd);
  const ticks = timelineTicks(startMs, endMs);

  const onMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    setHoverPct(pct);
    const ms = startMs + (pct / 100) * (endMs - startMs);
    setHoverLabel(new Date(ms).toISOString().slice(0, 10));
  };

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative"
        style={{ height: creators.length * ROW_H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverPct(null)}
      >
        {/* Hover crosshair across all rows. */}
        {hoverPct !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-foreground/40"
            style={{ left: `${hoverPct}%` }}
          >
            <span className="-translate-x-1/2 absolute -top-5 rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background tabular-nums">
              {hoverLabel}
            </span>
          </div>
        )}

        {creators.map((c, i) => (
          <div
            key={c.handle}
            className="absolute right-0 left-0 flex items-center border-border/30 border-b"
            style={{ top: i * ROW_H, height: ROW_H }}
          >
            {c.calls.map((call, j) => {
              const pct = timelineXPercent(Date.parse(call.postDate), startMs, endMs);
              return (
                <span
                  key={j}
                  title={`${c.name} · ${call.postDate}`}
                  className={
                    call.isFirstCall
                      ? "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2.5 rounded-full bg-foreground ring-2 ring-background"
                      : "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 size-2 rounded-full border border-foreground/60 bg-background"
                  }
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Axis labels. */}
      <div className="relative mt-1 h-4">
        {ticks.map((t) => (
          <span
            key={t.pct}
            className="-translate-x-1/2 absolute font-mono text-[10px] text-muted-foreground tabular-nums"
            style={{ left: `${t.pct}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

"use client";

import { motion, useSpring } from "motion/react";
import { memo, useMemo } from "react";
import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";
import {
  buildSegments,
  segmentIndexFor,
  splitLabel,
  tickerMode,
} from "./date-ticker-utils.ts";

const TICKER_ITEM_HEIGHT = 24;
/**
 * Above this label count the roll stacks would hold too many nodes to be
 * worthwhile, so fall back to a single static label. Run-collapsing keeps node
 * counts well below the bar count, so all normal timeframes (≤1Y daily ≈ 252)
 * animate; only pathological multi-year ranges hit this.
 */
const COMPACT_TICKER_THRESHOLD = 500;

export interface DateTickerProps {
  currentIndex: number;
  labels: string[];
  visible: boolean;
}

const PILL_CLASS =
  "overflow-hidden rounded-full bg-zinc-900 px-4 py-1 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900";
const SPRING = { stiffness: 400, damping: 35 } as const;

const DateTickerCompact = memo(function DateTickerCompact({
  currentIndex,
  labels,
}: Omit<DateTickerProps, "visible">) {
  const label = labels[currentIndex] ?? labels[0] ?? "";

  return (
    <div className={PILL_CLASS}>
      <div className="flex h-6 items-center justify-center">
        <span className="whitespace-nowrap font-medium text-sm">{label}</span>
      </div>
    </div>
  );
});

function Stack({
  segments,
  activeIndex,
}: {
  segments: { value: string; key: string }[];
  activeIndex: number;
}) {
  const y = useSpring(0, SPRING);
  y.set(-activeIndex * TICKER_ITEM_HEIGHT);

  return (
    <div className="relative h-6 overflow-hidden">
      <motion.div className="flex flex-col" style={{ y }}>
        {segments.map((segment) => (
          <div
            className="flex h-6 shrink-0 items-center justify-center"
            key={segment.key}
          >
            <span className="whitespace-nowrap font-medium text-sm">
              {segment.value}
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

const DateTickerInner = memo(function DateTickerInner({
  currentIndex,
  labels,
}: Omit<DateTickerProps, "visible">) {
  const isTime = useMemo(() => tickerMode(labels) === "time", [labels]);

  const parts = useMemo(() => labels.map(splitLabel), [labels]);
  // Major = month (date) or hour (time); minor = day or minute. Both collapse
  // repeated consecutive values into a single node so a value only rolls when
  // it actually changes (no in-place flip when it repeats across bars).
  const majorSegments = useMemo(
    () => buildSegments(parts.map((p) => p[0])),
    [parts],
  );
  const minorSegments = useMemo(
    () => buildSegments(parts.map((p) => p[1])),
    [parts],
  );

  const clamped =
    currentIndex < 0 || currentIndex >= labels.length ? 0 : currentIndex;
  const majorIndex = useMemo(
    () => segmentIndexFor(majorSegments, clamped),
    [majorSegments, clamped],
  );
  const minorIndex = useMemo(
    () => segmentIndexFor(minorSegments, clamped),
    [minorSegments, clamped],
  );

  return (
    <div className={PILL_CLASS}>
      <div className="relative h-6 overflow-hidden">
        <div className="flex items-center justify-center gap-1">
          <Stack segments={majorSegments} activeIndex={majorIndex} />
          {isTime ? (
            <span className="font-medium text-sm leading-6">:</span>
          ) : null}
          <Stack segments={minorSegments} activeIndex={minorIndex} />
        </div>
      </div>
    </div>
  );
});

export function DateTicker({ currentIndex, labels, visible }: DateTickerProps) {
  // Touch scrubbing rolls the spring stacks every frame; on coarse-pointer
  // devices fall back to the static pill (text-only update, no spring).
  const isTouch = useTouchPrimary();

  if (!visible || labels.length === 0) {
    return null;
  }

  if (isTouch || labels.length > COMPACT_TICKER_THRESHOLD) {
    return <DateTickerCompact currentIndex={currentIndex} labels={labels} />;
  }

  return <DateTickerInner currentIndex={currentIndex} labels={labels} />;
}

DateTicker.displayName = "DateTicker";

export default DateTicker;

"use client";

import { motion, useReducedMotion } from "motion/react";
import { AnimatedNumber } from "#/components/animated-number.tsx";
import { useInView } from "#/lib/use-in-view.ts";
import { EASE_OUT } from "#/lib/ease.ts";

export type CategoryBarRow = {
  key: string;
  label: string;
  // Excess as a ratio (0.055 → "+5.5%"); the percent format applies ×100 + sign.
  value: number;
  sublabel?: string;
};

const SIGNED_PCT: Intl.NumberFormatOptions = {
  style: "percent",
  signDisplay: "exceptZero",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

const toneCls = (v: number) =>
  v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
const barCls = (v: number) => (v >= 0 ? "bg-emerald-500" : "bg-rose-500");

// Shared categorical horizontal-bar chart: width ∝ |value| / max, colored by
// sign, with a motion grow-in (left→right stagger, matching the bklit marker
// cascade) and the shared per-glyph number transition. Used by both the "by horizon" and "by
// conviction" panels so they match the bklit charts' polish — motion is the same
// animation lib the bklit charts use — without a full visx/SVG chart for a
// handful of static bars (CSS width % is the linear scale).
//
export function CategoryBars({
  rows,
  transitionKey,
  format = SIGNED_PCT,
}: {
  rows: CategoryBarRow[];
  transitionKey: string;
  format?: Intl.NumberFormatOptions;
}) {
  const reduce = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)));
  const max = maxAbs > 0 ? maxAbs : 1;
  const step = Math.min(0.08, 0.6 / Math.max(1, rows.length - 1));

  return (
    <div className="space-y-2.5 py-2" ref={ref}>
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <div className="w-32 shrink-0 leading-tight text-muted-foreground">
            {r.label}
            {r.sublabel ? (
              <span className="mt-0.5 block text-[10px] opacity-60">{r.sublabel}</span>
            ) : null}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/50">
            <motion.div
              animate={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              className={`h-full rounded transition-colors duration-200 motion-reduce:transition-none ${barCls(r.value)}`}
              initial={reduce ? false : { width: "0%" }}
              transition={
                reduce ? { duration: 0 } : { delay: i * step, duration: 0.3, ease: EASE_OUT }
              }
            />
          </div>
          <div
            className={`w-16 shrink-0 text-right tabular-nums transition-colors duration-200 motion-reduce:transition-none ${toneCls(r.value)}`}
          >
            <AnimatedNumber
              format={format}
              revealed={inView}
              transitionKey={`${transitionKey}:${r.key}`}
              value={r.value}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default CategoryBars;

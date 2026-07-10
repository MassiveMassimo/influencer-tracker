"use client";

// Shared pill-track engine behind `TabsList` and `NavMenu`: one place owns the
// proximity-hover wiring, the focus/blur/keyboard bookkeeping, and the three
// animated overlays (active pill, hover pill, focus ring). Consumers keep
// their own selection model (selected tab value, active route slug) and pass
// the resolved index into `IndicatorOverlays`.
//
// The two consumers differ deliberately; `mode` bundles those differences:
// - "tabs" (TabsList): soft 40% hover tint that skips the selected tab and
//   retracts into the selected pill when the pointer leaves; active pill
//   dims to 0.85 while hovering elsewhere and unmounts instantly (no exit).
// - "menu" (NavMenu): full-opacity hover tint that travels anywhere (even
//   over the active row), keyed per hover session so re-entry fades in fresh;
//   active pill dims to 0.8 and exit-fades (the active route can leave the
//   visible set, e.g. the pagination window advancing).

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "#/lib/utils.ts";
import { spring } from "#/lib/springs.ts";
import { shape } from "#/lib/shape.ts";
import { useSurface } from "#/lib/surface-context.tsx";
import { surfaceClasses } from "#/lib/surface-classes.ts";
import { useProximityHover, type ItemRect } from "#/hooks/use-proximity-hover.ts";

interface UseIndicatorTrackOptions {
  axis?: "x" | "y";
  // Attribute each item carries with its index (e.g. "data-nav-index"); also
  // the item selector for focus lookup and keyboard nav.
  indexAttr: string;
  // When not undefined, overrides the internal proximity hover (lets a search
  // combobox drive the hover pill). Pass undefined to use proximity hover.
  controlledHoverIndex?: number | null;
  // Wire roving arrow/Home/End keyboard nav on the container. Leave off when
  // the underlying primitive already handles it (e.g. Base UI Tabs).
  keyboardNav?: boolean;
  // On focus leaving the track: keep the hover pill while the pointer is
  // still inside (TabsList); default clears it unconditionally (NavMenu).
  keepHoverOnBlurWhileMouseInside?: boolean;
}

interface IndicatorTrack {
  // Resolved hover index: controlled override wins over proximity hover.
  hoverIndex: number | null;
  focusedIndex: number | null;
  itemRects: ItemRect[];
  sessionRef: RefObject<number>;
  isMouseInsideRef: RefObject<boolean>;
  registerItem: (index: number, element: HTMLElement | null) => void;
  measureItems: () => void;
  handlers: {
    onMouseEnter: () => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
    onKeyDown: ((e: React.KeyboardEvent) => void) | undefined;
  };
}

function useIndicatorTrack<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  {
    axis = "y",
    indexAttr,
    controlledHoverIndex,
    keyboardNav = false,
    keepHoverOnBlurWhileMouseInside = false,
  }: UseIndicatorTrackOptions,
): IndicatorTrack {
  const isMouseInsideRef = useRef(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const {
    activeIndex: proximityIndex,
    setActiveIndex,
    itemRects,
    sessionRef,
    handlers: proximityHandlers,
    registerItem,
    measureItems,
  } = useProximityHover(containerRef, { axis });

  // Controlled index (e.g. the rail's search combobox) wins over proximity.
  const hoverIndex = controlledHoverIndex !== undefined ? controlledHoverIndex : proximityIndex;

  const {
    onMouseEnter,
    onMouseMove: proximityMove,
    onMouseLeave: proximityLeave,
  } = proximityHandlers;

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      isMouseInsideRef.current = true;
      proximityMove(e);
    },
    [proximityMove],
  );

  const onMouseLeave = useCallback(() => {
    isMouseInsideRef.current = false;
    proximityLeave();
  }, [proximityLeave]);

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const indexValue = (e.target as HTMLElement)
        .closest(`[${indexAttr}]`)
        ?.getAttribute(indexAttr);
      if (indexValue == null) return;
      const idx = Number(indexValue);
      setActiveIndex(idx);
      setFocusedIndex((e.target as HTMLElement).matches(":focus-visible") ? idx : null);
    },
    [indexAttr, setActiveIndex],
  );

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current?.contains(e.relatedTarget as Node)) return;
      setFocusedIndex(null);
      if (keepHoverOnBlurWhileMouseInside && isMouseInsideRef.current) return;
      setActiveIndex(null);
    },
    [containerRef, keepHoverOnBlurWhileMouseInside, setActiveIndex],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = Array.from(
        containerRef.current?.querySelectorAll(`[${indexAttr}]`) ?? [],
      ) as HTMLElement[];
      const currentIdx = items.indexOf(e.target as HTMLElement);
      if (currentIdx === -1) return;
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) {
        e.preventDefault();
        const next = ["ArrowDown", "ArrowRight"].includes(e.key)
          ? (currentIdx + 1) % items.length
          : (currentIdx - 1 + items.length) % items.length;
        items[next]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    },
    [containerRef, indexAttr],
  );

  const handlers = useMemo(
    () => ({
      onMouseEnter,
      onMouseMove,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown: keyboardNav ? onKeyDown : undefined,
    }),
    [onMouseEnter, onMouseMove, onMouseLeave, onFocus, onBlur, onKeyDown, keyboardNav],
  );

  return {
    hoverIndex,
    focusedIndex,
    itemRects,
    sessionRef,
    isMouseInsideRef,
    registerItem,
    measureItems,
    handlers,
  };
}

interface IndicatorOverlaysProps {
  track: IndicatorTrack;
  // Index of the persistently-selected item (selected tab / active route), or
  // null when none is in the visible set.
  selectedIndex: number | null;
  mode: "tabs" | "menu";
  // Active-pill fill: raised FF surface pill (substrate + 3) vs flat bg-active.
  raised?: boolean;
  // Radius overrides for the pills / focus ring; default to the shape tokens.
  radius?: string;
  ringRadius?: string;
}

function IndicatorOverlays({
  track,
  selectedIndex,
  mode,
  raised = false,
  radius,
  ringRadius,
}: IndicatorOverlaysProps) {
  const substrate = useSurface();
  const indicatorLevel = Math.min(substrate + 3, 8);
  const { hoverIndex, focusedIndex, itemRects, sessionRef, isMouseInsideRef } = track;

  const selectedRect = selectedIndex !== null ? itemRects[selectedIndex] : null;
  const hoverRect = hoverIndex !== null ? itemRects[hoverIndex] : null;
  const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
  const isHoveringOther = hoverIndex !== null && hoverIndex !== selectedIndex;
  const pillRadius = radius ?? shape.bg;
  const focusRingRadius = ringRadius ?? shape.focusRing;

  const activePill = selectedRect && (
    <motion.div
      className={cn(
        "pointer-events-none absolute",
        raised ? surfaceClasses(indicatorLevel) : "bg-active",
        pillRadius,
      )}
      initial={false}
      animate={{
        left: selectedRect.left,
        top: selectedRect.top,
        width: selectedRect.width,
        height: selectedRect.height,
        opacity: isHoveringOther ? (mode === "tabs" ? 0.85 : 0.8) : 1,
      }}
      exit={{ opacity: 0, transition: spring.moderate.exit }}
      transition={{ ...spring.moderate, opacity: { duration: 0.08 } }}
    />
  );

  return (
    <>
      {/* Active pill — menu mode exit-fades, tabs mode unmounts instantly. */}
      {mode === "menu" ? <AnimatePresence>{activePill}</AnimatePresence> : activePill}

      {/* Hover pill */}
      <AnimatePresence>
        {mode === "tabs"
          ? hoverRect &&
            isHoveringOther &&
            selectedRect && (
              <motion.div
                className={cn("pointer-events-none absolute bg-hover", pillRadius)}
                initial={{ ...selectedRect, opacity: 0 }}
                animate={{ ...hoverRect, opacity: 0.4 }}
                exit={
                  !isMouseInsideRef.current && selectedRect
                    ? {
                        ...selectedRect,
                        opacity: 0,
                        transition: {
                          ...spring.moderate,
                          opacity: { duration: 0.06 },
                        },
                      }
                    : { opacity: 0, transition: spring.fast.exit }
                }
                transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
              />
            )
          : hoverRect && (
              <motion.div
                key={sessionRef.current}
                className={cn("pointer-events-none absolute bg-hover", pillRadius)}
                initial={{ opacity: 0, ...(selectedRect ?? hoverRect) }}
                animate={{ opacity: 1, ...hoverRect }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
              />
            )}
      </AnimatePresence>

      {/* Focus ring */}
      <AnimatePresence>
        {focusRect && (
          <motion.div
            className={cn(
              "pointer-events-none absolute z-20 border border-[color:var(--focus-ring,#6B97FF)]",
              focusRingRadius,
            )}
            initial={false}
            animate={{
              left: focusRect.left - 2,
              top: focusRect.top - 2,
              width: focusRect.width + 4,
              height: focusRect.height + 4,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export { useIndicatorTrack, IndicatorOverlays };
export type { IndicatorTrack, UseIndicatorTrackOptions, IndicatorOverlaysProps };

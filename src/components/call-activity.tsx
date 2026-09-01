"use client";

import NumberFlow, { type Format, useCanAnimate } from "@number-flow/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { motion, MotionConfig, useSpring } from "motion/react";
import {
  buildCallActivityCalendar,
  type CallActivityDay,
  type CallActivityLevel,
} from "#/lib/call-activity";
import { ScrollArea } from "#/components/ui/scroll-area";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { spring } from "#/lib/springs";
import { useNumberFlowReady } from "#/lib/use-number-flow-ready";
import { useScrubSound } from "#/hooks/use-scrub-sound";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const RANGE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const LEVEL_CLASSES: Record<CallActivityLevel, string> = {
  0: "bg-foreground/[0.06]",
  1: "bg-foreground/[0.18]",
  2: "bg-foreground/[0.34]",
  3: "bg-foreground/[0.54]",
  4: "bg-foreground/[0.78]",
};

const LEVEL_COLORS: Record<CallActivityLevel, string> = {
  0: "color-mix(in oklab, var(--foreground) 6%, transparent)",
  1: "color-mix(in oklab, var(--foreground) 18%, transparent)",
  2: "color-mix(in oklab, var(--foreground) 34%, transparent)",
  3: "color-mix(in oklab, var(--foreground) 54%, transparent)",
  4: "color-mix(in oklab, var(--foreground) 78%, transparent)",
};
const WAVE_TRAVEL_MS = 780;
const WAVE_EASING = [0.215, 0.61, 0.355, 1] as const;
const TOOLTIP_GAP = 7;
const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_SPRING = { stiffness: 300, damping: 30, mass: 0.7 } as const;
const TOOLTIP_INTEGER_FORMAT: Format = { useGrouping: false };
const TOOLTIP_MONTH_HEIGHT = 10;
const TOOLTIP_MONTH_SPRING = { stiffness: 400, damping: 35 } as const;
const TOOLTIP_LAYOUT_TRANSITION = { type: "spring", duration: 0.9, bounce: 0 } as const;
const MotionNumberFlow = motion.create(NumberFlow);

function cubicBezierCoordinate(progress: number, firstControl: number, secondControl: number) {
  const inverse = 1 - progress;
  return (
    3 * inverse * inverse * progress * firstControl +
    3 * inverse * progress * progress * secondControl +
    progress * progress * progress
  );
}

export function callActivityWaveDelay(weekIndex: number, weekCount: number): number {
  if (weekCount <= 1 || weekIndex <= 0) return 0;
  if (weekIndex >= weekCount - 1) return WAVE_TRAVEL_MS;

  const targetPosition = weekIndex / (weekCount - 1);
  let lower = 0;
  let upper = 1;

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const parameter = (lower + upper) / 2;
    const position = cubicBezierCoordinate(parameter, WAVE_EASING[1], WAVE_EASING[3]);
    if (position < targetPosition) lower = parameter;
    else upper = parameter;
  }

  const parameter = (lower + upper) / 2;
  const time = cubicBezierCoordinate(parameter, WAVE_EASING[0], WAVE_EASING[2]);
  return Math.round(time * WAVE_TRAVEL_MS);
}

function formatDay(date: string, formatter: Intl.DateTimeFormat): string {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}

function formatCallCount(count: number): string {
  if (count === 0) return "No calls";
  return `${count} ${count === 1 ? "call" : "calls"}`;
}

type WaveStyle = CSSProperties & {
  "--call-activity-from-color"?: string;
  "--call-activity-to-color"?: string;
  "--call-activity-wave-delay": string;
};

function waveStyle(delay: number): WaveStyle {
  return { "--call-activity-wave-delay": `${delay}ms` };
}

function switchingCellStyle(
  delay: number,
  from: CallActivityLevel,
  to: CallActivityLevel,
): WaveStyle {
  return {
    "--call-activity-from-color": LEVEL_COLORS[from],
    "--call-activity-to-color": LEVEL_COLORS[to],
    "--call-activity-wave-delay": `${delay}ms`,
  };
}

function initialCellStyle(delay: number, to: CallActivityLevel): WaveStyle {
  return {
    "--call-activity-to-color": LEVEL_COLORS[to],
    "--call-activity-wave-delay": `${delay}ms`,
  };
}

type ActivityCalendar = ReturnType<typeof buildCallActivityCalendar>;

type TooltipInput = "keyboard" | "pointer";
type TooltipSide = "bottom" | "top";

interface ActivityTooltipHandle {
  hide(): void;
  show(day: CallActivityDay, target: HTMLElement, input: TooltipInput): void;
}

interface ActivityTooltipView {
  count: number;
  date: string;
  instant: boolean;
  side: TooltipSide;
  visible: boolean;
}

function tooltipDateParts(date: string): {
  day: number;
  monthIndex: number;
  year: number;
} {
  const parsed = new Date(`${date}T00:00:00Z`);
  return {
    day: parsed.getUTCDate(),
    monthIndex: parsed.getUTCMonth(),
    year: parsed.getUTCFullYear(),
  };
}

function tooltipMonthLabels(rangeStart: string): string[] {
  const start = new Date(`${rangeStart}T00:00:00Z`);
  return Array.from({ length: 13 }, (_, index) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)).toLocaleDateString(
      "en-US",
      { month: "short", timeZone: "UTC" },
    ),
  );
}

function TooltipNumber({ value }: { value: number }) {
  return (
    <MotionNumberFlow
      format={TOOLTIP_INTEGER_FORMAT}
      isolate
      layout
      layoutRoot
      locales="en-US"
      value={value}
      willChange
    />
  );
}

function TooltipValue({ count, numberFlowReady }: { count: number; numberFlowReady: boolean }) {
  return (
    <motion.span
      className="inline-flex shrink-0 tabular-nums"
      data-slot="call-activity-tooltip-value"
      layout="position"
    >
      {count === 0 ? "No" : numberFlowReady ? <TooltipNumber value={count} /> : count}
    </motion.span>
  );
}

const CallActivityTooltip = forwardRef<
  ActivityTooltipHandle,
  { boundsRef: RefObject<HTMLDivElement | null>; rangeStart: string }
>(function CallActivityTooltip({ boundsRef, rangeStart }, forwardedRef) {
  const panelRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(false);
  const x = useSpring(0, TOOLTIP_SPRING);
  const y = useSpring(0, TOOLTIP_SPRING);
  const monthY = useSpring(0, TOOLTIP_MONTH_SPRING);
  const numberFlowReady = useNumberFlowReady();
  const canAnimateNumberFlow = useCanAnimate();
  const monthLabels = useMemo(() => tooltipMonthLabels(rangeStart), [rangeStart]);
  const [view, setView] = useState<ActivityTooltipView>({
    count: 0,
    date: rangeStart,
    instant: false,
    side: "top",
    visible: false,
  });

  const hide = useCallback(() => {
    visibleRef.current = false;
    setView((current) => (current.visible ? { ...current, visible: false } : current));
  }, []);

  const show = useCallback(
    (day: CallActivityDay, target: HTMLElement, input: TooltipInput) => {
      const bounds = boundsRef.current;
      if (!bounds) return;

      // Read all geometry before changing either motion value.
      const boundsRect = bounds.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      const halfWidth = (panelRect?.width ?? 132) / 2;
      const panelHeight = panelRect?.height ?? 48;
      const centeredX = targetRect.left + targetRect.width / 2 - boundsRect.left;
      const targetX = Math.max(
        halfWidth + TOOLTIP_EDGE_PADDING,
        Math.min(centeredX, boundsRect.width - halfWidth - TOOLTIP_EDGE_PADDING),
      );
      const spaceAbove = targetRect.top - boundsRect.top;
      const side: TooltipSide =
        spaceAbove >= panelHeight + TOOLTIP_GAP + TOOLTIP_EDGE_PADDING ? "top" : "bottom";
      const targetY =
        side === "top"
          ? targetRect.top - boundsRect.top - TOOLTIP_GAP - panelHeight
          : targetRect.bottom - boundsRect.top + TOOLTIP_GAP;
      const reducedMotion = prefersReducedMotion();

      // A newly opened or keyboard-driven tooltip must start at its target.
      // Pointer retargets keep the spring's live position and velocity.
      if (!visibleRef.current || input === "keyboard" || reducedMotion) {
        x.jump(targetX);
        y.jump(targetY);
      } else {
        x.set(targetX);
        y.set(targetY);
      }

      visibleRef.current = true;
      setView({
        count: day.count,
        date: day.date,
        instant: input === "keyboard" || reducedMotion,
        side,
        visible: true,
      });
    },
    [boundsRef, x, y],
  );

  useImperativeHandle(forwardedRef, () => ({ hide, show }), [hide, show]);

  const instant = view.instant;
  const date = tooltipDateParts(view.date);
  const rangeStartDate = tooltipDateParts(rangeStart);
  const monthIndex = Math.max(
    0,
    Math.min(
      monthLabels.length - 1,
      (date.year - rangeStartDate.year) * 12 + date.monthIndex - rangeStartDate.monthIndex,
    ),
  );

  useIsoLayoutEffect(() => {
    const target = -monthIndex * TOOLTIP_MONTH_HEIGHT;
    if (instant) monthY.jump(target);
    else monthY.set(target);
  }, [instant, monthIndex, monthY]);

  const layoutTransition =
    instant || !canAnimateNumberFlow ? ({ duration: 0 } as const) : TOOLTIP_LAYOUT_TRANSITION;

  return (
    <MotionConfig transition={{ layout: layoutTransition }}>
      <motion.div
        aria-hidden={!view.visible}
        aria-label={`${formatDay(view.date, RANGE_FORMAT)} · ${formatCallCount(view.count)}`}
        animate={{
          opacity: view.visible ? 1 : 0,
          scale: view.visible ? 1 : 0.98,
        }}
        className="pointer-events-none absolute top-0 left-0 z-50"
        data-side={view.side}
        data-slot="call-activity-tooltip"
        data-state={view.visible ? "open" : "closed"}
        initial={false}
        role="tooltip"
        style={{ x, y }}
        transition={instant ? { duration: 0 } : view.visible ? spring.fast : spring.fast.exit}
      >
        <motion.div
          ref={panelRef}
          className="-translate-x-1/2 rounded-lg bg-popover/90 px-3 py-2 text-popover-foreground shadow-lg backdrop-blur-md"
          data-slot="call-activity-tooltip-panel"
          layout="size"
        >
          <motion.span
            className="grid justify-items-start gap-1 font-mono whitespace-nowrap"
            layout="position"
          >
            <motion.span
              className="justify-self-start text-[9px] tracking-[0.18em] text-muted-foreground uppercase"
              layout="position"
            >
              {numberFlowReady ? (
                <>
                  <span
                    className="relative inline-block h-[10px] w-[4ch] overflow-hidden align-[-1px]"
                    data-slot="call-activity-tooltip-month"
                  >
                    <motion.span className="flex flex-col" style={{ y: monthY }}>
                      {monthLabels.map((month, index) => (
                        <span
                          key={`${month}:${index}`}
                          className="h-[10px] shrink-0 leading-[10px]"
                        >
                          {month}
                        </span>
                      ))}
                    </motion.span>
                  </span>{" "}
                  <TooltipNumber value={date.day} />, <TooltipNumber value={date.year} />
                </>
              ) : (
                formatDay(view.date, RANGE_FORMAT)
              )}
            </motion.span>
            <motion.span
              className="inline-flex items-baseline gap-x-[1ch] justify-self-start text-xs text-foreground"
              data-slot="call-activity-tooltip-count"
              layout="position"
            >
              <TooltipValue count={view.count} numberFlowReady={numberFlowReady} />
              <motion.span
                className="text-left"
                data-slot="call-activity-tooltip-label"
                layout="position"
              >
                call
                <motion.span
                  animate={{ opacity: view.count === 1 ? 0 : 1 }}
                  aria-hidden
                  className="inline-block w-[1ch]"
                  initial={false}
                  transition={instant ? { duration: 0 } : spring.fast}
                >
                  s
                </motion.span>
              </motion.span>
            </motion.span>
          </motion.span>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
});

function levelsByDate(calendar: ActivityCalendar | null): Map<string, CallActivityLevel> {
  const levels = new Map<string, CallActivityLevel>();
  if (!calendar) return levels;

  for (const week of calendar.weeks) {
    for (const day of week.days) {
      if (day) levels.set(day.date, day.level);
    }
  }
  return levels;
}

export interface ActivityTransition {
  current: ActivityCalendar;
  key: string;
  mode: "initial" | "settled" | "switching";
  outgoing: ActivityCalendar | null;
}

export function advanceActivityTransition(
  state: ActivityTransition | null,
  key: string,
  calendar: ActivityCalendar,
): ActivityTransition {
  if (!state) return { current: calendar, key, mode: "initial", outgoing: null };
  if (state.key === key) return { ...state, current: calendar };
  return { current: calendar, key, mode: "switching", outgoing: state.current };
}

function renderMonthRow(calendar: ActivityCalendar, animate: boolean): React.ReactElement {
  return (
    <div className="flex justify-center gap-[3px]" aria-hidden>
      {calendar.weeks.map((week, index) => (
        <div key={index} className="relative h-3 w-[11px] shrink-0">
          {week.month && !calendar.weeks[index + 1]?.month && (
            <span
              className={`absolute top-0 left-0 font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground ${animate ? "call-activity-wave-month" : ""}`}
              style={
                animate ? waveStyle(callActivityWaveDelay(index, calendar.weeks.length)) : undefined
              }
            >
              {week.month}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function moveActivityFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!(event.target instanceof HTMLElement)) return;

  const currentWeek = Number(event.target.dataset.activityWeek);
  const currentDay = Number(event.target.dataset.activityDay);
  if (!Number.isInteger(currentWeek) || !Number.isInteger(currentDay)) return;

  let targetWeek = currentWeek;
  let targetDay = currentDay;
  switch (event.key) {
    case "ArrowLeft":
      targetWeek -= 1;
      break;
    case "ArrowRight":
      targetWeek += 1;
      break;
    case "ArrowUp":
      targetDay -= 1;
      break;
    case "ArrowDown":
      targetDay += 1;
      break;
    default:
      return;
  }

  const selector = `[data-activity-week="${targetWeek}"][data-activity-day="${targetDay}"]`;
  const target = event.currentTarget.querySelector<HTMLElement>(selector);
  if (!target) return;

  event.preventDefault();
  event.target.tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
}

function activityCellFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[role="gridcell"]');
}

function renderActivityGrid(
  transition: ActivityTransition,
  accessibleLabel: string,
  onBlur: (event: FocusEvent<HTMLDivElement>) => void,
  onFocus: (event: FocusEvent<HTMLDivElement>) => void,
  onPointerLeave: () => void,
  onPointerOver: (event: PointerEvent<HTMLDivElement>) => void,
): React.ReactElement {
  const calendar = transition.current;
  const previousLevels = levelsByDate(transition.outgoing);

  return (
    <div
      role="grid"
      aria-label={accessibleLabel}
      aria-colcount={calendar.weeks.length}
      aria-rowcount={7}
      className="mt-1 flex flex-col gap-[3px]"
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={moveActivityFocus}
      onPointerLeave={onPointerLeave}
      onPointerOver={onPointerOver}
    >
      {Array.from({ length: 7 }, (_, dayIndex) => (
        <div key={dayIndex} role="row" className="flex justify-center gap-[3px]">
          {calendar.weeks.map((week, weekIndex) => {
            const day = week.days[dayIndex];
            const horizontalDelay = callActivityWaveDelay(weekIndex, calendar.weeks.length);
            if (!day) {
              return (
                <span
                  key={`${weekIndex}-${dayIndex}`}
                  aria-hidden
                  className="invisible size-[11px] rounded-[3px]"
                />
              );
            }

            const dateLabel = formatDay(day.date, RANGE_FORMAT);
            const countLabel = formatCallCount(day.count);
            const waveDelay = horizontalDelay + dayIndex * 5;
            const previousLevel = previousLevels.get(day.date) ?? 0;
            const colorChanges = transition.mode === "switching" && previousLevel !== day.level;
            let animationClass = "";
            let style: WaveStyle | undefined;
            if (transition.mode === "initial") {
              animationClass = "call-activity-wave-cell";
              style = initialCellStyle(waveDelay, day.level);
            } else if (colorChanges) {
              animationClass = "call-activity-cell-transition";
              style = switchingCellStyle(waveDelay, previousLevel, day.level);
            }

            return (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                aria-label={`${dateLabel} · ${countLabel}`}
                aria-colindex={weekIndex + 1}
                aria-rowindex={dayIndex + 1}
                data-activity-week={weekIndex}
                data-activity-day={dayIndex}
                tabIndex={day.date === calendar.rangeStart ? 0 : -1}
                className={`${animationClass} relative size-[11px] appearance-none rounded-[3px] border-0 p-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${LEVEL_CLASSES[day.level]}`}
                style={style}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function CallActivity({
  activity,
  creatorHandle,
  generatedAt,
}: {
  activity: readonly CallActivityDay[];
  creatorHandle: string;
  generatedAt: string;
}): React.ReactElement {
  const calendar = useMemo(
    () => buildCallActivityCalendar(activity, generatedAt),
    [activity, generatedAt],
  );
  const [transition, setTransition] = useState(() =>
    advanceActivityTransition(null, creatorHandle, calendar),
  );
  if (transition.key !== creatorHandle || transition.current !== calendar) {
    setTransition(advanceActivityTransition(transition, creatorHandle, calendar));
  }
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tooltipBoundsRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<ActivityTooltipHandle>(null);
  const focusedCellRef = useRef<HTMLElement | null>(null);
  const hoveredCellRef = useRef<HTMLElement | null>(null);
  const scrubSound = useScrubSound("release");
  const range = `${formatDay(calendar.rangeStart, RANGE_FORMAT)}–${formatDay(calendar.rangeEnd, RANGE_FORMAT)}`;
  const busiest = calendar.busiest;
  const summary = busiest
    ? `${calendar.activeDays} active ${calendar.activeDays === 1 ? "day" : "days"}. Busiest day: ${formatDay(busiest.date, DAY_FORMAT)} with ${formatCallCount(busiest.count)}.`
    : "No call activity in this period.";

  const showTooltipForCell = useCallback(
    (cell: HTMLElement, input: TooltipInput) => {
      const weekIndex = Number(cell.dataset.activityWeek);
      const dayIndex = Number(cell.dataset.activityDay);
      const day = calendar.weeks[weekIndex]?.days[dayIndex];
      if (day) {
        scrubSound.move(day.date);
        tooltipRef.current?.show(day, cell, input);
      }
    },
    [calendar, scrubSound],
  );

  const handlePointerOver = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") return;
      const cell = activityCellFromTarget(event.target);
      if (!cell || cell === hoveredCellRef.current) return;
      hoveredCellRef.current = cell;
      showTooltipForCell(cell, "pointer");
    },
    [showTooltipForCell],
  );

  const handlePointerLeave = useCallback(() => {
    hoveredCellRef.current = null;
    const focusedCell = focusedCellRef.current;
    if (focusedCell) showTooltipForCell(focusedCell, "keyboard");
    else {
      scrubSound.reset();
      tooltipRef.current?.hide();
    }
  }, [scrubSound, showTooltipForCell]);

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const cell = activityCellFromTarget(event.target);
      if (!cell) return;
      focusedCellRef.current = cell;
      showTooltipForCell(cell, "keyboard");
    },
    [showTooltipForCell],
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      focusedCellRef.current = null;
      const hoveredCell = hoveredCellRef.current;
      if (hoveredCell) showTooltipForCell(hoveredCell, "pointer");
      else {
        scrubSound.reset();
        tooltipRef.current?.hide();
      }
    },
    [scrubSound, showTooltipForCell],
  );

  useEffect(() => {
    focusedCellRef.current = null;
    hoveredCellRef.current = null;
    scrubSound.reset();
    tooltipRef.current?.hide();
  }, [creatorHandle, scrubSound]);

  useIsoLayoutEffect(() => {
    if (transition.mode !== "switching" || !gridRef.current) return;

    const grid = gridRef.current;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(".call-activity-cell-transition"));
    let remaining = cells.length;
    const settle = () => {
      setTransition((current) =>
        current.key === transition.key ? { ...current, mode: "settled", outgoing: null } : current,
      );
    };
    const handleAnimationEnd = (event: AnimationEvent) => {
      if (
        event.animationName !== "call-activity-cell-transition" ||
        !(event.target instanceof HTMLElement) ||
        !event.target.classList.contains("call-activity-cell-transition")
      ) {
        return;
      }
      remaining -= 1;
      if (remaining === 0) settle();
    };

    if (remaining === 0) settle();
    grid.addEventListener("animationend", handleAnimationEnd);
    return () => grid.removeEventListener("animationend", handleAnimationEnd);
  }, [transition.key, transition.mode]);

  useIsoLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    viewport.scrollLeft = viewport.scrollWidth;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = viewport.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendar.rangeEnd, creatorHandle]);

  return (
    <section className="bg-card p-6 lg:col-span-2">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Call activity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground tabular-nums">{range}</p>
      </header>

      {activity.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">No call activity yet.</p>
      ) : (
        <div ref={tooltipBoundsRef} className="relative mx-auto mt-5 w-full max-w-[739px]">
          <ScrollArea
            ref={scrollAreaRef}
            role="region"
            aria-label="Call activity calendar. Scroll horizontally to see earlier dates."
            orientation="horizontal"
            viewportClassName="scroll-fade-x h-auto pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div
              ref={gridRef}
              key={`${transition.key}:${transition.current.rangeEnd}`}
              data-slot="call-activity-grid"
              className="w-max min-w-full"
            >
              {renderMonthRow(transition.current, transition.mode === "initial")}
              {renderActivityGrid(
                transition,
                `Call activity from ${range}. ${summary}`,
                handleBlur,
                handleFocus,
                handlePointerLeave,
                handlePointerOver,
              )}
            </div>
          </ScrollArea>
          <CallActivityTooltip
            ref={tooltipRef}
            boundsRef={tooltipBoundsRef}
            rangeStart={calendar.rangeStart}
          />
        </div>
      )}
    </section>
  );
}

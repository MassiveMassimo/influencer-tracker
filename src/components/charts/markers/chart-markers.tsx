"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTouchPrimaryEager } from "#/hooks/use-has-primary-touch.tsx";
import { chartCssVars, useChart, useChartHover } from "../chart-context";
import { type ChartMarker, MarkerGroup } from "./marker-group";

export interface ChartMarkersProps {
  /** Array of markers to display */
  items: ChartMarker[];
  /** Size of each marker circle. Default: 28 */
  size?: number;
  /** Whether to show vertical guide lines. Default: true */
  showLines?: boolean;
  /** Whether to animate markers on entrance. Default: true */
  animate?: boolean;
  /**
   * Bump this (e.g. the timeframe) to remount the markers and replay the
   * stagger. Needed on charts that stay mounted across data swaps (the area
   * chart), where the entrance variant would otherwise never fire again.
   */
  replayKey?: string | number;
  /** Render marker icons edge-to-edge (no 4px inset) — for avatar fills. */
  iconFill?: boolean;
}

// Tooltip content for markers
export interface MarkerTooltipContentProps {
  markers: ChartMarker[];
}

const MAX_TOOLTIP_MARKERS = 2;

export function MarkerTooltipContent({ markers }: MarkerTooltipContentProps) {
  if (markers.length === 0) {
    return null;
  }

  const visibleMarkers = markers.slice(0, MAX_TOOLTIP_MARKERS);
  const hiddenCount = markers.length - MAX_TOOLTIP_MARKERS;

  return (
    <div className="mt-2 space-y-2 border-t border-chart-tooltip-muted pt-2">
      {visibleMarkers.map((marker) => {
        const isClickable = !!(marker.onClick || marker.href);
        return (
          <div className="flex items-start gap-2" key={marker.title}>
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: marker.color || chartCssVars.markerBackground,
                border: `1px solid ${chartCssVars.markerBorder}`,
              }}
            >
              <span className="text-xs" style={{ color: chartCssVars.markerForeground }}>
                {marker.icon}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {marker.content ? (
                marker.content
              ) : (
                <>
                  <div className="flex items-center gap-1.5 truncate text-sm font-medium text-chart-tooltip-foreground">
                    {marker.title}
                    {isClickable && <span className="text-[10px] text-chart-tooltip-muted">↗</span>}
                  </div>
                  {marker.description && (
                    <div className="max-w-[16rem] text-xs break-words whitespace-normal text-chart-tooltip-muted">
                      {marker.description}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div className="pl-7 text-xs text-chart-tooltip-muted">+{hiddenCount} more...</div>
      )}
    </div>
  );
}

export function ChartMarkers({
  items,
  size = 28,
  showLines = true,
  animate = true,
  replayKey,
  iconFill = false,
}: ChartMarkersProps) {
  const { xScale, innerHeight, margin, containerRef, tooltipData, setTooltipData } = useChart();

  // Touch devices skip the entrance stagger — markers mount in place. The
  // left→right cascade is the pricier per-frame work on slow mobile GPUs.
  const isTouch = useTouchPrimaryEager();
  const animateMarkers = animate && !isTouch;

  // Markers under the cursor — drives the anchored hover card (quote etc.).
  const [active, setActive] = useState<{ markers: ChartMarker[]; x: number } | null>(null);
  // Freeze the last shown content so the card can animate out after `active`
  // clears (unmounting would kill the close transition).
  const lastActive = useRef<{ markers: ChartMarker[]; x: number } | null>(null);
  if (active) lastActive.current = active;
  const shown = active ?? lastActive.current;

  // Hovering a marker hides the price crosshair and shows the marker's own card.
  const handleMarkerHover = useCallback(
    (markers: ChartMarker[] | null) => {
      if (markers && markers[0]) {
        setTooltipData(null);
        setActive({ markers, x: xScale(markers[0].date) ?? 0 });
      } else {
        setActive(null);
      }
    },
    [setTooltipData, xScale],
  );

  // Group markers by date
  const markersByDate = useMemo(() => {
    const grouped = new Map<string, ChartMarker[]>();
    for (const marker of items) {
      const dateKey = marker.date.toDateString();
      const existing = grouped.get(dateKey);
      if (existing) existing.push(marker);
      else grouped.set(dateKey, [marker]);
    }
    return grouped;
  }, [items]);

  // Y position for markers (above chart area)
  const markerY = -8;

  // Stagger left→right: order groups by date ascending so the earliest
  // (leftmost) marker gets delay 0, not the newest (items are newest-first).
  const sortedGroups = useMemo(
    () =>
      Array.from(markersByDate.entries()).sort(
        ([, a], [, b]) => (a[0]?.date.getTime() ?? 0) - (b[0]?.date.getTime() ?? 0),
      ),
    [markersByDate],
  );

  // Spread the whole cascade across a fixed window (not a flat per-group step),
  // so a symbol with 30 call dates ripples in just as fast as one with 3 — no
  // multi-second tail. ~1.2s ceiling matches bklit's bar-stagger spec.
  const STAGGER_WINDOW = 1.2;
  const staggerStep =
    sortedGroups.length > 1 ? Math.min(0.08, STAGGER_WINDOW / (sortedGroups.length - 1)) : 0;

  // Crosshair date — resolve once per render, not once per marker group per
  // hover frame (this component re-renders on every scrub via tooltipData).
  let hoveredDateKey: string | undefined;
  if (tooltipData) {
    const point = tooltipData.point;
    const date = point.date instanceof Date ? point.date : new Date(point.date as string | number);
    hoveredDateKey = date.toDateString();
  }

  return (
    <>
      {/* SVG markers rendered in chart space */}
      {sortedGroups.map(([dateKey, dateMarkers], groupIndex) => {
        const markerDate = dateMarkers[0]?.date;
        if (!markerDate) {
          return null;
        }

        const markerX = xScale(markerDate) ?? 0;
        const isActive = tooltipData ? hoveredDateKey === dateKey : undefined;

        // Stagger only — no base wait for the chart draw, leftmost first.
        const markerDelay = animateMarkers ? groupIndex * staggerStep : 0;

        return (
          <MarkerGroup
            animate={animateMarkers}
            animationDelay={markerDelay}
            containerRef={containerRef}
            iconFill={iconFill}
            isActive={isActive}
            // replayKey in the key remounts the group on a timeframe switch so
            // the entrance variant fires again (the area chart never unmounts).
            key={`${dateKey}-${replayKey ?? ""}`}
            lineHeight={innerHeight}
            marginLeft={margin.left}
            marginTop={margin.top}
            markers={dateMarkers}
            onHover={handleMarkerHover}
            showLine={showLines}
            size={size}
            x={markerX}
            y={markerY}
          />
        );
      })}

      {/* Anchored hover card — the marker's own detail (title + description),
          positioned at the marker instead of inside the chart tooltip. Kept
          mounted (content frozen to lastActive while closing) so the open/close
          transition can play on the way out. */}
      {shown &&
        containerRef?.current &&
        createPortal(
          <div
            className={`t-marker-card absolute z-[60] rounded-lg border border-border bg-background px-3 py-2 shadow-lg${active ? " is-open" : ""}`}
            style={{
              left: shown.x + margin.left,
              top: margin.top + markerY + size + 6,
            }}
          >
            {shown.markers.map((m) => (
              <div key={m.title} className="not-first:mt-2">
                <div className="text-sm font-medium text-foreground">{m.title}</div>
                {m.description && (
                  <div className="mt-0.5 max-w-[16rem] text-xs break-words whitespace-normal text-muted-foreground">
                    {m.description}
                  </div>
                )}
              </div>
            ))}
          </div>,
          containerRef.current,
        )}
    </>
  );
}

// Hook to get active markers for tooltip
export function useActiveMarkers(items: ChartMarker[]) {
  const { tooltipData } = useChartHover();

  return useMemo(() => {
    if (!tooltipData) {
      return [];
    }
    const point = tooltipData.point;
    const date = point.date instanceof Date ? point.date : new Date(point.date as string | number);
    const dateKey = date.toDateString();
    return items.filter((m) => m.date.toDateString() === dateKey);
  }, [tooltipData, items]);
}

ChartMarkers.displayName = "ChartMarkers";
// Marker for SVG component detection (renders after mouse overlay for interaction)
(ChartMarkers as { __isChartMarkers?: boolean }).__isChartMarkers = true;
MarkerTooltipContent.displayName = "MarkerTooltipContent";

export default ChartMarkers;

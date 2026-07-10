"use client";

// FF `nav-menu` (registry/default), adapted to our stack: motion/react, #/ aliases.
// Adds `controlledActiveIndex` so an external combobox (the rail's per-section
// search) can drive the hover pill by keyboard; when it's undefined the internal
// proximity-hover takes over. Pairs with `NavItem`. The pill engine (proximity
// hover, overlays, focus/keyboard bookkeeping) lives in `indicator-track.tsx`,
// shared with `TabsList`.
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn, mergeRefs } from "#/lib/utils.ts";
import { shape } from "#/lib/shape.ts";
import { IndicatorOverlays, useIndicatorTrack } from "#/components/ui/indicator-track.tsx";

interface NavMenuContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  registerSlug: (index: number, slug: string | null) => void;
  activeIndex: number | null;
  activeSlug: string | null;
  separated: boolean;
}

const NavMenuContext = createContext<NavMenuContextValue | null>(null);

export function useNavMenu() {
  const ctx = useContext(NavMenuContext);
  if (!ctx) throw new Error("useNavMenu must be used within a NavMenu");
  return ctx;
}

// Bottom-border separator for a bordered NavMenu row, matching the FF table:
// the border above/below the hovered pill fades so the pill reads as one block.
export function rowSeparatorClass(separated: boolean, index: number, activeIndex: number | null) {
  if (!separated) return "";
  const hide = activeIndex !== null && (index === activeIndex || index === activeIndex - 1);
  return cn(
    "border-b transition-[border-color] duration-80 last:border-b-0",
    hide ? "border-transparent" : "border-border",
  );
}

interface NavMenuProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  activeSlug: string | null;
  // When set, overrides the internal proximity-hover index (lets a search
  // combobox drive the hover pill). Pass undefined to use proximity hover.
  controlledActiveIndex?: number | null;
  // Rounded-* class for the pill/focus-ring radius. Defaults to the shape
  // context (pill). Pass e.g. "rounded-md" for softer, list-style rows.
  radius?: string;
  // Layout axis. Vertical (default) is a full-width column (sidebar); horizontal
  // is an inline row (e.g. a pagination strip) with x-axis proximity.
  orientation?: "vertical" | "horizontal";
  // "list" (default) = flat `bg-active` pill on a bare container (sidebar/menus).
  // "tabs" = the FF tab look: a `bg-muted` track with a raised surface-pill
  // indicator (matches `TabsList`), used by the pagination strip.
  variant?: "list" | "tabs";
  // Draw a bottom-border separator between rows (table-style list). Off by
  // default (sidebar/menu look); the hovered pill fades its adjacent borders.
  separated?: boolean;
}

const NavMenu = forwardRef<HTMLElement, NavMenuProps>(
  (
    {
      children,
      activeSlug,
      controlledActiveIndex,
      radius,
      orientation = "vertical",
      variant = "list",
      separated = false,
      className,
      ...props
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLElement>(null);
    const setContainerRef = useMemo(() => mergeRefs(containerRef, ref), [ref]);
    const slugToIndexRef = useRef<Map<string, number>>(new Map());
    const isTabs = variant === "tabs";

    const track = useIndicatorTrack(containerRef, {
      axis: orientation === "horizontal" ? "x" : "y",
      indexAttr: "data-nav-index",
      controlledHoverIndex: controlledActiveIndex,
      keyboardNav: true,
    });
    const { registerItem, measureItems, hoverIndex: activeIndex } = track;

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    // The slug→index map lives in a ref (updated from child effects), but the
    // active-route pill is derived from it during render. Bump a version on every
    // change so a render is scheduled after (re)registration — otherwise a shifted
    // set with byte-identical rects (e.g. the pagination window advancing) leaves
    // the pill on the stale slot, since the rect-equality remeasure bails.
    const [, bumpMapVersion] = useState(0);

    const registerSlug = useCallback((index: number, slug: string | null) => {
      if (slug === null) {
        for (const [s, i] of slugToIndexRef.current) {
          if (i === index) {
            slugToIndexRef.current.delete(s);
            break;
          }
        }
      } else {
        slugToIndexRef.current.set(slug, index);
      }
      bumpMapVersion((v) => v + 1);
    }, []);

    const activeRouteIndex =
      activeSlug !== null ? (slugToIndexRef.current.get(activeSlug) ?? null) : null;

    // Memoized so a hover-frame or version-bump re-render that leaves these four
    // unchanged doesn't churn every NavItem/NavButton consumer. activeRouteIndex is
    // intentionally NOT in context — only this component's own pill render reads it.
    const ctxValue = useMemo<NavMenuContextValue>(
      () => ({ registerItem, registerSlug, activeIndex, activeSlug, separated }),
      [registerItem, registerSlug, activeIndex, activeSlug, separated],
    );

    return (
      <NavMenuContext.Provider value={ctxValue}>
        <nav
          ref={setContainerRef}
          {...track.handlers}
          className={cn(
            "relative flex gap-0.5 select-none",
            orientation === "horizontal" ? "items-center" : "w-full flex-col",
            isTabs && cn("bg-muted p-1", shape.container),
            className,
          )}
          {...props}
        >
          <IndicatorOverlays
            track={track}
            selectedIndex={activeRouteIndex}
            mode="menu"
            raised={isTabs}
            radius={radius}
            ringRadius={radius}
          />

          {children}
        </nav>
      </NavMenuContext.Provider>
    );
  },
);

NavMenu.displayName = "NavMenu";

export { NavMenu };

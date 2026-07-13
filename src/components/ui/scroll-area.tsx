"use client";

// Base UI flavour of the Fluid Functionalism scroll area. Same API and
// behaviour as the Radix flavour (registry/radix/scroll-area.tsx): shape-system
// scrollbar, native overflow fallback on touch-primary devices. Scrollbar
// machinery adapted from Lina by SameerJS6 (https://lina.sameer.sh); built on
// @base-ui/react/scroll-area, whose scrollbars stay mounted while scrollable
// and expose hover/scroll state as data attributes instead of Radix's
// show/hide presence animation.

import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "#/lib/utils.ts";
import { shape } from "#/lib/shape.ts";
import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";

// On touch-primary devices the Base UI machinery is skipped entirely in
// favour of native overflow scrolling (better physics, momentum,
// rubber-banding); the context lets the exported ScrollBar no-op there.
const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  viewportClassName?: string;
  /** Which axes get scrollbars. Defaults to `"vertical"`. */
  orientation?: Orientation;
  /**
   * Registers the scrolling viewport with TanStack Router's scroll restoration
   * (`data-scroll-restoration-id`), so back/forward restores this container's
   * position. Needs a matching entry in the router's `scrollToTopSelectors` for
   * fresh navigations to reset to top. Only for a persistent nested scroller.
   */
  scrollRestorationId?: string;
}

const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  (
    {
      className,
      children,
      viewportClassName,
      orientation = "vertical",
      scrollRestorationId,
      ...props
    },
    ref,
  ) => {
    const isTouch = useTouchPrimary();

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          <div
            ref={ref}
            role="group"
            data-slot="scroll-area"
            aria-roledescription="scroll area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <div
              data-slot="scroll-area-viewport"
              className={cn(
                "size-full rounded-[inherit]",
                orientation === "vertical" && "overflow-y-auto",
                orientation === "horizontal" && "overflow-x-auto",
                orientation === "both" && "overflow-auto",
                viewportClassName,
              )}
              data-scroll-restoration-id={scrollRestorationId}
              tabIndex={0}
            >
              {children}
            </div>
          </div>
        ) : (
          <ScrollAreaPrimitive.Root
            ref={ref}
            data-slot="scroll-area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <ScrollAreaPrimitive.Viewport
              data-slot="scroll-area-viewport"
              className={cn("size-full rounded-[inherit]", viewportClassName)}
              data-scroll-restoration-id={scrollRestorationId}
            >
              {/* Content gives Base UI an intrinsic size to measure horizontal
                  overflow against — it defaults to `min-width: fit-content`. For a
                  vertical-only area that's wrong: a too-wide descendant (e.g. a
                  min-w-max table in its own horizontal ScrollArea) would balloon
                  this content past the viewport and scroll the whole page sideways.
                  Cap it to the viewport width when we don't scroll horizontally. */}
              <ScrollAreaPrimitive.Content
                className={orientation === "vertical" ? "!w-full !min-w-0" : undefined}
              >
                {children}
              </ScrollAreaPrimitive.Content>
            </ScrollAreaPrimitive.Viewport>
            {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
            {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
            {orientation === "both" && <ScrollAreaPrimitive.Corner />}
          </ScrollAreaPrimitive.Root>
        )}
      </ScrollAreaContext.Provider>
    );
  },
);

ScrollArea.displayName = "ScrollArea";

const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isTouch = useContext(ScrollAreaContext);

  if (isTouch) return null;

  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      // Base UI keeps the scrollbar mounted while scrollable; visibility is
      // a plain opacity transition off its hover/scroll state attributes,
      // matching the cue fade — 160ms in, 120ms out (exits faster, per the
      // animation guidelines); spring tokens are framer-motion configs and
      // don't apply here.
      className={cn(
        // The 10px track stays as a comfortable hit target; the thumb inside
        // it rests narrow and low-contrast, then widens + darkens on hover so
        // it gets out of the way until you reach for it.
        "group/scrollbar absolute z-20 flex touch-none select-none",
        // Show immediately; on hide, wait out the 150ms thumb shrink before
        // fading so the thumb visibly narrows back first instead of the fade
        // masking it.
        "opacity-0 transition-opacity delay-160 duration-120 ease-out",
        "data-[hovering]:duration-160 data-[scrolling]:duration-160",
        "data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        "data-[hovering]:delay-0 data-[scrolling]:delay-0",
        orientation === "vertical" && "top-0 right-0 h-full w-2.5",
        orientation === "horizontal" && "bottom-0 left-0 h-2.5 w-full flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative bg-foreground/25 transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-foreground/45 active:!bg-foreground/60",
          shape.bg,
          orientation === "vertical" &&
            "mx-auto my-1 h-[var(--scroll-area-thumb-height)] w-1 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "mx-1 my-auto h-1 w-[var(--scroll-area-thumb-width)] group-hover/scrollbar:h-1.5",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
});

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };

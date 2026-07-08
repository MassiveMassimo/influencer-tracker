"use client";

// Fluid Functionalism / Lina scroll area (fluidfunctionalism.com/docs/scrollbars),
// adapted to this project: the scrollbar stays mounted while scrollable but is quiet —
// a thin, low-contrast thumb that fades in on hover/scroll and widens + darkens as you
// reach for it. On touch-primary devices the machinery steps aside for native overflow
// (better physics). Edge treatment stays OUR chanhdai scroll-driven fade
// (`scroll-fade-effect-*` in styles.css), not shadcn's static mask — same idea, and
// already wired/documented. Scrollbar machinery adapted from Lina by SameerJS6.

import * as React from "react";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "#/lib/utils.ts";

import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";

const ScrollAreaContext = React.createContext<boolean>(false);

type Orientation = "vertical" | "horizontal";

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    /** Extra classes for the scrollbar track (e.g. `w-1.5` for a thinner bar). */
    scrollbarClassName?: string;
    /**
     * Which axis gets the scrollbar + the scroll-driven edge fade (single-axis: the CSS
     * `scroll-fade-effect-*` mask is one-axis).
     * @default "vertical"
     */
    orientation?: Orientation;
  }
>(
  (
    {
      className,
      children,
      viewportClassName,
      scrollbarClassName,
      orientation = "vertical",
      style,
      ...props
    },
    ref,
  ) => {
    const isTouch = useTouchPrimary();
    // chanhdai scroll-driven edge fade (styles.css), matched to the scroll axis.
    const fadeClass =
      orientation === "horizontal" ? "scroll-fade-effect-x" : "scroll-fade-effect-y";

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          // style is peeled off props: Base UI's Root style can be a function, illegal on a native div.
          <div
            ref={ref}
            role="group"
            data-slot="scroll-area"
            aria-roledescription="scroll area"
            className={cn("relative overflow-hidden", className)}
            style={{ ...style }}
            {...props}
          >
            <div
              data-slot="scroll-area-viewport"
              data-native
              className={cn(
                "size-full rounded-[inherit]",
                orientation === "vertical" ? "overflow-y-auto" : "overflow-x-auto",
                fadeClass,
                viewportClassName,
              )}
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
            style={style}
            {...props}
          >
            <ScrollAreaPrimitive.Viewport
              data-slot="scroll-area-viewport"
              className={cn("size-full rounded-[inherit]", fadeClass, viewportClassName)}
            >
              {/* Content gives Base UI an intrinsic size to measure horizontal overflow
                  against — but it sets min-width:fit-content, which forces a stray
                  horizontal scroll on vertical-only lists. So wrap only when an x-axis
                  bar exists; vertical-only puts children straight in the viewport. */}
              {orientation === "vertical" ? (
                children
              ) : (
                <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
              )}
            </ScrollAreaPrimitive.Viewport>

            {orientation === "vertical" ? (
              <ScrollBar orientation="vertical" className={scrollbarClassName} />
            ) : (
              <ScrollBar orientation="horizontal" className={scrollbarClassName} />
            )}
          </ScrollAreaPrimitive.Root>
        )}
      </ScrollAreaContext.Provider>
    );
  },
);

ScrollArea.displayName = "ScrollArea";

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isTouch = React.useContext(ScrollAreaContext);

  if (isTouch) return null;

  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      // Base UI keeps the scrollbar mounted while scrollable; visibility is a plain
      // opacity transition off its hover/scroll state attributes — 160ms in, 120ms out
      // (exits faster). The hide keeps delay-160 so the thumb visibly shrinks back
      // before the fade masks it; show is delay-0.
      className={cn(
        // 10px track = comfortable hit target; the thumb inside rests thin + quiet.
        "group/scrollbar absolute z-20 flex touch-none select-none",
        "opacity-0 transition-opacity delay-160 duration-120 ease-out",
        "data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        "data-[hovering]:delay-0 data-[hovering]:duration-160",
        "data-[scrolling]:delay-0 data-[scrolling]:duration-160",
        orientation === "vertical" && "top-0 right-0 h-full w-2.5",
        orientation === "horizontal" && "bottom-0 left-0 h-2.5 w-full flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative rounded-full bg-foreground/25 transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-foreground/45 active:!bg-foreground/60",
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

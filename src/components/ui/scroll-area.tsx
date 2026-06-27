"use client";

import * as React from "react";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "#/lib/utils.ts";

import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";

const ScrollAreaContext = React.createContext<boolean>(false);

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    /** Extra classes for the scrollbar track (e.g. `w-1.5` for a thinner bar). */
    scrollbarClassName?: string;
    /**
     * Axis the scroll-driven edge fade applies to. The CSS `scroll-fade-effect-*`
     * utility (see `styles.css`) masks content to transparent at the leading and
     * trailing edge as it scrolls — pure CSS via `animation-timeline: scroll()`,
     * no JS measurement. Content fades to transparent, so the surface behind it
     * shows through (no mask-color matching needed).
     * @default "vertical"
     */
    orientation?: "vertical" | "horizontal";
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
              className={cn(
                "size-full overflow-auto rounded-[inherit]",
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
              {children}
            </ScrollAreaPrimitive.Viewport>

            <ScrollBar className={scrollbarClassName} />
            <ScrollBar orientation="horizontal" className={scrollbarClassName} />
            <ScrollAreaPrimitive.Corner />
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
      className={cn(
        "flex touch-none p-px transition-colors duration-150 select-none hover:bg-muted dark:hover:bg-muted/50",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent px-1 pr-1.25",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative flex-1 origin-center rounded-full bg-border transition-[scale]",
          orientation === "vertical" && "my-1 active:scale-y-95",
          orientation === "horizontal" && "active:scale-x-98",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
});

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };

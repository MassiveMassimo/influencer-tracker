"use client";

import * as React from "react";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "#/lib/utils.ts";

import { useTouchPrimary } from "#/hooks/use-has-primary-touch.tsx";

const ScrollAreaContext = React.createContext<boolean>(false);
type Mask = {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
};

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    /**
     * `maskHeight` is the height of the mask in pixels.
     * pass `0` to disable the mask
     * @default 30
     */
    maskHeight?: number;
    maskClassName?: string;
    /** Extra classes for the scrollbar track (e.g. `w-1.5` for a thinner bar). */
    scrollbarClassName?: string;
    /**
     * Color the edge-fade mask blends into. Must match the scroll area's own
     * surface background, or the fade reveals the wrong color at the edges.
     * Defaults to the page background token; override on non-default surfaces.
     * @default "var(--color-background)"
     */
    maskColor?: string;
  }
>(({ className, children, viewportClassName, maskClassName, scrollbarClassName, maskHeight = 30, maskColor = "var(--color-background)", style, ...props }, ref) => {
  const [showMask, setShowMask] = React.useState<Mask>({
    top: false,
    bottom: false,
    left: false,
    right: false,
  });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const isTouch = useTouchPrimary();

  const checkScrollability = React.useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;

    const { scrollTop, scrollLeft, scrollWidth, clientWidth, scrollHeight, clientHeight } = element;
    setShowMask((prev) => ({
      ...prev,
      top: scrollTop > 0,
      bottom: scrollTop + clientHeight < scrollHeight - 1,
      left: scrollLeft > 0,
      right: scrollLeft + clientWidth < scrollWidth - 1,
    }));
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const element = viewportRef.current;
    if (!element) return;

    const controller = new AbortController();
    const { signal } = controller;

    const resizeObserver = new ResizeObserver(checkScrollability);
    resizeObserver.observe(element);

    element.addEventListener("scroll", checkScrollability, { signal });
    window.addEventListener("resize", checkScrollability, { signal });

    // Run an initial check whenever dependencies change (including pointer mode)
    checkScrollability();

    return () => {
      controller.abort();
      resizeObserver.disconnect();
    };
  }, [checkScrollability, isTouch]);

  return (
    <ScrollAreaContext.Provider value={isTouch}>
      {isTouch ? (
        <div
          ref={ref}
          role="group"
          data-slot="scroll-area"
          aria-roledescription="scroll area"
          className={cn("relative overflow-hidden", className)}
          style={{ ["--scroll-mask-color" as string]: maskColor, ...style }}
          {...props}
        >
          <div
            ref={viewportRef}
            data-slot="scroll-area-viewport"
            className={cn("size-full overflow-auto rounded-[inherit]", viewportClassName)}
            tabIndex={0}
          >
            {children}
          </div>

          {maskHeight > 0 && <ScrollMask showMask={showMask} className={maskClassName} maskHeight={maskHeight} />}
        </div>
      ) : (
        <ScrollAreaPrimitive.Root
          ref={ref}
          data-slot="scroll-area"
          className={cn("relative overflow-hidden", className)}
          style={{ ["--scroll-mask-color" as string]: maskColor, ...style }}
          {...props}
        >
          <ScrollAreaPrimitive.Viewport
            ref={viewportRef}
            data-slot="scroll-area-viewport"
            className={cn("size-full rounded-[inherit]", viewportClassName)}
          >
            {children}
          </ScrollAreaPrimitive.Viewport>

          {maskHeight > 0 && <ScrollMask showMask={showMask} className={maskClassName} maskHeight={maskHeight} />}
          <ScrollBar className={scrollbarClassName} />
          <ScrollBar orientation="horizontal" className={scrollbarClassName} />
          <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
      )}
    </ScrollAreaContext.Provider>
  );
});

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
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "bg-border relative flex-1 origin-center rounded-full transition-[scale]",
          orientation === "vertical" && "my-1 active:scale-y-95",
          orientation === "horizontal" && "active:scale-x-98"
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
});

ScrollBar.displayName = "ScrollBar";

const ScrollMask = ({
  showMask,
  maskHeight,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  showMask: Mask;
  maskHeight: number;
}) => {
  return (
    <>
      <div
        {...props}
        aria-hidden="true"
        style={
          {
            "--top-fade-height": showMask.top ? `${maskHeight}px` : "0px",
            "--bottom-fade-height": showMask.bottom ? `${maskHeight}px` : "0px",
          } as React.CSSProperties
        }
        className={cn(
          "pointer-events-none absolute inset-0 z-10",
          "before:absolute before:inset-x-0 before:top-0 before:transition-[height,opacity] before:duration-300 before:content-['']",
          "after:absolute after:inset-x-0 after:bottom-0 after:transition-[height,opacity] after:duration-300 after:content-['']",
          "before:h-(--top-fade-height) after:h-(--bottom-fade-height)",
          showMask.top ? "before:opacity-100" : "before:opacity-0",
          showMask.bottom ? "after:opacity-100" : "after:opacity-0",
          "before:from-(--scroll-mask-color) before:bg-gradient-to-b before:to-transparent",
          "after:from-(--scroll-mask-color) after:bg-gradient-to-t after:to-transparent",
          className
        )}
      />
      <div
        {...props}
        aria-hidden="true"
        style={
          {
            "--left-fade-width": showMask.left ? `${maskHeight}px` : "0px",
            "--right-fade-width": showMask.right ? `${maskHeight}px` : "0px",
          } as React.CSSProperties
        }
        className={cn(
          "pointer-events-none absolute inset-0 z-10",
          "before:absolute before:inset-y-0 before:left-0 before:transition-[width,opacity] before:duration-300 before:content-['']",
          "after:absolute after:inset-y-0 after:right-0 after:transition-[width,opacity] after:duration-300 after:content-['']",
          "before:w-(--left-fade-width) after:w-(--right-fade-width)",
          showMask.left ? "before:opacity-100" : "before:opacity-0",
          showMask.right ? "after:opacity-100" : "after:opacity-0",
          "before:from-(--scroll-mask-color) before:bg-gradient-to-r before:to-transparent",
          "after:from-(--scroll-mask-color) after:bg-gradient-to-l after:to-transparent",
          className
        )}
      />
    </>
  );
};

export { ScrollArea, ScrollBar };

"use client";

// FF `table` (registry/default), adapted to our stack: motion/react, #/ aliases.
// The proximity-hover sliding row background + border-fade + is-active cell
// brighten are FF's. The one deliberate divergence (re-apply on re-sync): the
// table is wrapped in our `ScrollArea` so a too-wide table gets the horizontal
// scroll-driven edge fade — FF's registry ships no scroll-area. The `<table>`
// pairs `w-full` with `min-w-max` so it fills a wide container but never shrinks
// below its content on a narrow one (mobile) — without the min-width it would
// always fit the viewport and the horizontal ScrollArea could never scroll. Body
// rows must pass `index` to opt into the hover animation; header rows omit it.

import {
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn, mergeRefs } from "#/lib/utils.ts";
import { spring } from "#/lib/springs.ts";
import { fontWeights } from "#/lib/font-weight.ts";
import { useProximityHover } from "#/hooks/use-proximity-hover.ts";
import { ScrollArea } from "./scroll-area";

// ── Context ──────────────────────────────────────────────

interface TableContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const TableContext = createContext<TableContextValue | null>(null);

// ── Table ────────────────────────────────────────────────

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

const Table = forwardRef<HTMLTableElement, TableProps>(({ children, className, ...props }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { activeIndex, itemRects, sessionRef, handlers, registerItem, measureItems } =
    useProximityHover(containerRef);

  useEffect(() => {
    measureItems();
  }, [measureItems, children]);

  const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;

  const contextValue = useMemo(() => ({ registerItem, activeIndex }), [registerItem, activeIndex]);

  return (
    <TableContext.Provider value={contextValue}>
      <ScrollArea
        data-slot="table-container"
        className="w-full"
        orientation="horizontal"
        viewportClassName="scroll-fade-x h-auto"
      >
        {/* Proximity-hover container: offset parent for the row rects and the
              absolute hover background, which scrolls with the table content. */}
        <div
          ref={containerRef}
          className="relative"
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
        >
          {/* Hover background */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className="pointer-events-none absolute bg-hover"
                initial={{
                  opacity: 0,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                animate={{
                  opacity: 1,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
              />
            )}
          </AnimatePresence>

          <table
            ref={ref}
            data-slot="table"
            className={cn("w-full min-w-max border-collapse text-[13px]", className)}
            {...props}
          >
            {children}
          </table>
        </div>
      </ScrollArea>
    </TableContext.Provider>
  );
});

Table.displayName = "Table";

// ── TableHeader / TableBody ──────────────────────────────

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("", className)} {...props} />,
);

TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("", className)} {...props} />,
);

TableBody.displayName = "TableBody";

// ── TableRow ─────────────────────────────────────────────

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  index?: number;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ index, className, style, ...props }, ref) => {
    const internalRef = useRef<HTMLTableRowElement>(null);
    const ctx = useContext(TableContext);

    useEffect(() => {
      if (index === undefined || !ctx) return;
      ctx.registerItem(index, internalRef.current);
      return () => ctx.registerItem(index, null);
    }, [index, ctx]);

    const isBodyRow = index !== undefined;
    const activeIdx = ctx?.activeIndex ?? null;
    // Hide the border above/below the active row so the hover pill reads as one
    // block; header row hides its border when the first body row is active.
    const hideBorder =
      activeIdx !== null &&
      ((isBodyRow && (index === activeIdx || index === activeIdx - 1)) ||
        (!isBodyRow && activeIdx === 0));

    return (
      <tr
        ref={mergeRefs(internalRef, ref)}
        data-proximity-index={index}
        className={cn(
          "group/row relative z-10 border-b transition-[border-color] duration-80",
          hideBorder ? "border-transparent" : "border-border",
          isBodyRow && activeIdx === index && "is-active",
          className,
        )}
        style={{
          ...style,
          fontVariationSettings: isBodyRow ? fontWeights.normal : fontWeights.semibold,
        }}
        {...props}
      />
    );
  },
);

TableRow.displayName = "TableRow";

// ── TableHead / TableCell ────────────────────────────────

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("px-3 py-2 text-left text-foreground", className)} {...props} />
  ),
);

TableHead.displayName = "TableHead";

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-3 py-2 text-muted-foreground transition-colors duration-80 group-[.is-active]/row:text-foreground",
        className,
      )}
      {...props}
    />
  ),
);

TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };

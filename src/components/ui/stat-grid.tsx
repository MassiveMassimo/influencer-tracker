import type React from "react";
import { cn } from "#/lib/utils.ts";

/**
 * FF "Surfaces" nested-card pattern: an outer `bg-card` frame (1px padding)
 * carries the surface ring, wrapping an inner `bg-border/60` gap-px grid that
 * paints the hairline dividers between cells. The inner radius is the outer's
 * minus the 1px frame — kept in one place so the two never drift apart.
 */
export function StatGrid({
  id,
  ref,
  gridClassName,
  children,
}: {
  id?: string;
  ref?: React.Ref<HTMLElement>;
  gridClassName: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      id={id}
      ref={ref}
      className="overflow-hidden rounded-2xl bg-card p-px shadow-surface-2"
    >
      <div
        className={cn(
          "grid gap-px overflow-hidden rounded-[calc(var(--radius-2xl)-1px)] bg-border/60",
          gridClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

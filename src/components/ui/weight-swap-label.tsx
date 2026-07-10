"use client";

// Stacked spans: an invisible semibold sizer + the visible label share a grid
// cell so the bold/normal weight swap never reflows the layout. Shared by
// NavItem's `label` mode and TabItem.
import { cn } from "#/lib/utils.ts";
import { fontWeights } from "#/lib/font-weight.ts";

interface WeightSwapLabelProps {
  label?: string;
  /** Visible span's text color: foreground when true, muted-foreground otherwise. */
  colorActive: boolean;
  /** Visible span's weight swap: semibold when true, normal otherwise. */
  weightActive: boolean;
  /** Extra classes on the outer grid wrapper (e.g. `flex-1` vs `whitespace-nowrap`). */
  className?: string;
  /** Transition-duration class on the visible span (differs per call site). */
  durationClassName: string;
}

export function WeightSwapLabel({
  label,
  colorActive,
  weightActive,
  className,
  durationClassName,
}: WeightSwapLabelProps) {
  return (
    <span className={cn("inline-grid text-[13px]", className)}>
      <span
        className="invisible col-start-1 row-start-1 [text-box:trim-both_cap_alphabetic]"
        style={{ fontVariationSettings: fontWeights.semibold }}
        aria-hidden="true"
      >
        {label}
      </span>
      <span
        className={cn(
          "col-start-1 row-start-1 transition-[color,font-variation-settings] [text-box:trim-both_cap_alphabetic]",
          durationClassName,
          colorActive ? "text-foreground" : "text-muted-foreground",
        )}
        style={{
          fontVariationSettings: weightActive ? fontWeights.semibold : fontWeights.normal,
        }}
      >
        {label}
      </span>
    </span>
  );
}

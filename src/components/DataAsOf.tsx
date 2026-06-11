import { relativeTime } from "#/lib/relative-time.ts";

// Subtle staleness indicator. Pages are CDN-cached (~6h SWR), so a viewer may see data
// up to a few hours stale; surfacing "Data as of <relative>" makes that visible. The exact
// timestamp is exposed via title for hover.
export function DataAsOf({ iso, className = "" }: { iso: string; className?: string }) {
  return (
    <span
      title={iso}
      // relativeTime is computed against "now", so the ISR-cached SSR string ("2 hours ago")
      // differs from the client's recompute on hydration. The client value is the correct one;
      // suppress the expected text mismatch rather than emit a hydration warning per page view.
      suppressHydrationWarning
      className={`font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em] ${className}`}
    >
      Data as of {relativeTime(iso)}
    </span>
  );
}

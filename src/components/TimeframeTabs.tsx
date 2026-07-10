import type { Timeframe } from "#/lib/window-series.ts";
import { Tabs, TabsList, TabItem } from "#/components/ui/tabs.tsx";

const TABS: Timeframe[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"];

export function TimeframeTabs({
  value,
  onChange,
  onPrefetch,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  /** Warm the cache for a timeframe before it's clicked (hover/focus). */
  onPrefetch?: (tf: Timeframe) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as Timeframe)}>
      <TabsList>
        {TABS.map((tf) => (
          <TabItem
            key={tf}
            value={tf}
            label={tf}
            className="font-mono"
            // Prefetch is passed through to the underlying Base UI tab (TabItem
            // spreads unknown props); the FF proximity indicator handles the rest.
            onPointerEnter={() => onPrefetch?.(tf)}
            onFocus={() => onPrefetch?.(tf)}
          />
        ))}
      </TabsList>
    </Tabs>
  );
}

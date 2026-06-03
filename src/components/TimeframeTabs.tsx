import { useLayoutEffect, useRef } from "react";
import type { Timeframe } from "#/lib/window-series.ts";

const TABS: Timeframe[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"];

export function TimeframeTabs({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // Position the pill under the active tab. On mount/resize, snap without transition.
  const positionPill = (animate: boolean) => {
    const list = listRef.current, pill = pillRef.current;
    if (!list || !pill) return;
    const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!active) return;
    if (!animate) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
      void pill.offsetWidth; // force reflow
      pill.style.transition = "";
    } else {
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: snap on mount + resize
  useLayoutEffect(() => {
    positionPill(false);
    const onResize = () => positionPill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-position on value change
  useLayoutEffect(() => {
    positionPill(true);
  }, [value]);

  return (
    <div className="t-tabs" role="tablist" ref={listRef}>
      <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />
      {TABS.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={value === tf}
          className="t-tab font-mono"
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

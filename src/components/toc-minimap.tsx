"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { LineNav } from "#/components/line-nav.tsx";

// In-page table of contents rendered as chanhdai's LineNav (line marker expands on
// hover/active). Active section tracked via IntersectionObserver — the right tool for
// scroll-spy: one observer arbitrates a single active id, vs motion's per-element
// useInView which only reports booleans and leaves the arbitration to you. `depth` is
// accepted for API compatibility but not shown (all current TOCs are flat).
export type TOCItem = {
  title: React.ReactNode;
  url: string; // "#section-id"
  depth: number;
};

export function TocMinimap({ items, className }: { items: TOCItem[]; className?: string }) {
  const itemIds = useMemo(() => items.map((item) => item.url.replace("#", "")), [items]);
  const activeHeading = useActiveHeading(itemIds);

  if (!items.length) return null;

  // Default to the first section so the top of the page reads as active before scroll.
  const activeHref = activeHeading ? `#${activeHeading}` : items[0]?.url;

  return (
    <LineNav
      className={className}
      items={items.map((item) => ({ title: item.title, href: item.url }))}
      activeHref={activeHref}
      scrollActiveIntoView={false}
      onItemClick={(item, e) => {
        e.preventDefault();
        // scrollIntoView only — no history.pushState (keeps TanStack Router in sync)
        document.getElementById(item.href.replace("#", ""))?.scrollIntoView({ behavior: "smooth" });
      }}
    />
  );
}

function useActiveHeading(itemIds: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      // Collapse the root to the viewport's vertical centerline: the one section
      // crossing it is active. Robust for tall sections that never hit a high
      // visibility threshold in a thin top band (the old params stuck on section 1).
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );

    for (const id of itemIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [itemIds]);

  return activeId;
}

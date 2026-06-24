"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { PreviewCardPrimitive } from "#/components/ui/preview-card.tsx";
import { cn } from "#/lib/utils.ts";

// Port of chanhdai's TOC minimap (chanhdai.com/components/toc-minimap), adapted to
// the project's Base UI PreviewCard (the upstream pulls radix hover-card) and with
// the @soundcn open-sound dropped. A right-gutter stack of bars; hover reveals the
// full section list. Active section tracked via IntersectionObserver.
export type TOCItem = {
  title: React.ReactNode;
  url: string; // "#section-id"
  depth: number;
};

export function TocMinimap({
  items,
  className,
}: {
  items: TOCItem[];
  className?: string;
}) {
  const itemIds = useMemo(
    () => items.map((item) => item.url.replace("#", "")),
    [items],
  );
  const activeHeading = useActiveHeading(itemIds);

  if (!items.length) return null;

  return (
    <PreviewCardPrimitive.Root>
      <PreviewCardPrimitive.Trigger
        render={
          <div
            // ponytail: caller owns positioning (the page passes a fixed-gutter class)
            className={cn("flex flex-col gap-3 py-3 pl-6", className)}
          />
        }
      >
        {items.map((item) => (
          <span
            key={item.url}
            data-depth={item.depth}
            data-active={item.url === `#${activeHeading}` || undefined}
            className={cn(
              "h-0.5 w-6 shrink-0 rounded-xs bg-ring/50 transition-[background-color] duration-200",
              "data-[depth=3]:ml-2 data-[depth=3]:w-4",
              "data-[depth=4]:ml-4 data-[depth=4]:w-2",
              "data-active:bg-foreground",
            )}
          />
        ))}
      </PreviewCardPrimitive.Trigger>

      <PreviewCardPrimitive.Portal>
        <PreviewCardPrimitive.Positioner
          align="center"
          side="left"
          sideOffset={8}
          className="z-50"
        >
          <PreviewCardPrimitive.Popup className="w-56 overflow-hidden rounded-xl border border-border/60 bg-background shadow-lg transition-[transform,opacity] duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <ul className="flex max-h-[50dvh] flex-col overflow-y-auto overscroll-contain px-6 py-4 text-sm">
              {items.map((item) => (
                <li key={item.url} className="flex py-1">
                  <a
                    href={item.url}
                    data-depth={item.depth}
                    data-active={item.url === `#${activeHeading}` || undefined}
                    onClick={handleItemClick}
                    className={cn(
                      "line-clamp-2 w-full text-muted-foreground transition-[color] duration-200",
                      "hover:text-foreground data-active:text-foreground",
                      "data-[depth=3]:pl-4 data-[depth=4]:pl-8",
                    )}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </PreviewCardPrimitive.Popup>
        </PreviewCardPrimitive.Positioner>
      </PreviewCardPrimitive.Portal>
    </PreviewCardPrimitive.Root>
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
      { rootMargin: "0% 0% -80% 0%", threshold: 0.98 },
    );

    for (const id of itemIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [itemIds]);

  return activeId;
}

function handleItemClick(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  // ponytail: scrollIntoView only — no history.pushState (keeps TanStack Router in sync)
  const id = e.currentTarget.getAttribute("href")?.replace("#", "") ?? "";
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

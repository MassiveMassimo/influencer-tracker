import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { pickAvatarTabs, type SwitcherCreator } from "#/lib/ticker-switcher.ts";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "#/components/ui/tooltip.tsx";

// Sum offsetLeft up the offsetParent chain to `container` (layout-only,
// transform-immune but integer-rounded).
function offsetLeftTo(el: HTMLElement, container: HTMLElement): number {
  let left = 0;
  let current: HTMLElement | null = el;
  while (current && current !== container) {
    left += current.offsetLeft;
    current = current.offsetParent as HTMLElement | null;
  }
  return left;
}

// Exact, transform-immune left of the active tab relative to `list`. The tab
// lives inside .cs-layer-tabs, which animates scale() on open/close and (via
// will-change: transform) is the tab's offsetParent. offsetLeft rounds to
// integers (~0.4px pill drift); getBoundingClientRect is subpixel-exact but
// scaled mid-transition. So measure the tab within its scaled layer and divide
// the scale out — the right-center transform-origin cancels in the rect
// difference — then add the layer's integer-clean offsetLeft (sits at the
// container's 3px padding, no fractional part to lose).
function activeLeftIn(active: HTMLElement, list: HTMLElement): number {
  const layer = active.offsetParent as HTMLElement | null;
  if (!layer || layer === list) {
    return active.getBoundingClientRect().left - list.getBoundingClientRect().left;
  }
  const sx = new DOMMatrixReadOnly(getComputedStyle(layer).transform).a || 1;
  const within = (active.getBoundingClientRect().left - layer.getBoundingClientRect().left) / sx;
  return offsetLeftTo(layer, list) + within;
}

function Avatar({ creator, dimmed }: { creator: SwitcherCreator; dimmed?: boolean }) {
  const dim = dimmed
    ? "grayscale transition-[filter] duration-200"
    : "transition-[filter] duration-200";
  return creator.avatar ? (
    <img src={creator.avatar} alt="" className={`cs-avatar ${dim}`} />
  ) : (
    <span className={`cs-avatar-fallback ${dim}`}>{creator.handle.slice(0, 2)}</span>
  );
}

export function CreatorSwitcher({
  symbol,
  creators,
  selected,
}: {
  symbol: string;
  creators: SwitcherCreator[];
  selected: string | null;
}) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Mirror open into a ref so the mount-only resize handler reads the live value
  // instead of the open === false closure captured at mount.
  const openRef = useRef(open);
  openRef.current = open;

  // Position the pill under the active tab; when the combobox is open the pill
  // expands to fill the whole container and becomes the combobox background.
  // activeLeftIn stays exact through the open/close scale transition (selecting
  // from search re-positions mid-transition via an async navigation).
  const positionPill = (animate: boolean) => {
    const list = listRef.current,
      pill = pillRef.current;
    if (!list || !pill) return;
    const apply = (left: number, width: number) => {
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
    };
    if (!animate) pill.style.transition = "none";
    if (openRef.current) {
      apply(1, list.clientWidth - 2); // inset 1px both sides
    } else {
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) {
        const left = activeLeftIn(active, list);
        if (active.dataset.avatarTab != null) {
          const d = active.offsetHeight;
          apply(left + (active.offsetWidth - d) / 2, d);
        } else {
          apply(left, active.offsetWidth);
        }
      }
    }
    if (!animate) {
      void pill.offsetWidth; // force reflow before re-enabling transition
      pill.style.transition = "";
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: snap on mount + resize
  useLayoutEffect(() => {
    positionPill(false);
    const onResize = () => positionPill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-position on state change
  useLayoutEffect(() => {
    positionPill(true);
    if (open) inputRef.current?.focus();
  }, [open, selected]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Switcher only earns its place with someone to switch to. Returns after all
  // hooks so they stay unconditional (effects no-op while refs are null).
  if (creators.length <= 1) return null;

  const tabs = pickAvatarTabs(creators, selected, 3);
  const go = (creator: string) =>
    navigate({ to: "/t/$symbol/$creator", params: { symbol, creator }, resetScroll: false });

  const filtered = creators
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.handle.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => (b.lastCallDate ?? "").localeCompare(a.lastCallDate ?? ""));

  // Single source of truth for the morph: data-open drives the pill expansion
  // and the crossfade between the tab-row layer and the combobox layer. Both
  // layers stay mounted so neither hard-pops; the inactive one is faded out and
  // made inert (pointer-events/visibility via CSS).
  return (
    <div className="cs-root shrink-0" data-open={open || undefined}>
      <div className="t-tabs cs-tabs" role="tablist" ref={listRef}>
        <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />

        {/* Tab-row layer: All + avatar tabs + the search trigger. */}
        <div className="cs-layer cs-layer-tabs" aria-hidden={open}>
          <button
            type="button"
            role="tab"
            aria-selected={selected === null}
            tabIndex={open ? -1 : 0}
            className="t-tab font-mono"
            onClick={() => go("all")}
          >
            All
          </button>
          <TooltipProvider delay={0}>
            {tabs.map((c) => (
              <Tooltip key={c.handle}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected === c.handle}
                      aria-label={c.name}
                      tabIndex={open ? -1 : 0}
                      className="t-tab"
                      data-avatar-tab=""
                      onClick={() => go(c.handle)}
                    >
                      <Avatar creator={c} dimmed={selected !== c.handle} />
                    </button>
                  }
                />
                <TooltipPopup>{c.name}</TooltipPopup>
              </Tooltip>
            ))}
          </TooltipProvider>
          <button
            type="button"
            aria-label="Search creators"
            tabIndex={open ? -1 : 0}
            className="t-tab cs-search-tab"
            onClick={() => {
              setQ("");
              setOpen(true);
            }}
          >
            <Search size={15} />
          </button>
        </div>

        {/* Combobox layer: the search icon stays put as the morph anchor and
            the input grows out of it. */}
        <div className="cs-layer cs-layer-combobox" aria-hidden={!open}>
          <Search size={15} className="cs-search-icon text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            tabIndex={open ? 0 : -1}
            placeholder="Search creators…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
      </div>

      <div className="cs-panel" role="listbox" data-open={open || undefined}>
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No creators match.</div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.handle}
              type="button"
              role="option"
              aria-selected={selected === c.handle}
              data-active={selected === c.handle}
              tabIndex={open ? 0 : -1}
              className="cs-option"
              onClick={() => {
                setOpen(false);
                go(c.handle);
              }}
            >
              <Avatar creator={c} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{c.name}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {c.callCount} call{c.callCount === 1 ? "" : "s"} · last {c.lastCallDate ?? "—"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

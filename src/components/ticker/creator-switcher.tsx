import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { SearchIcon } from "#/components/icons/search.tsx";
import type { AnimatedIconHandle } from "#/components/icons/types.ts";
import { pickAvatarTabs, type SwitcherCreator } from "#/lib/ticker-switcher.ts";
import { Tooltip, TooltipProvider } from "#/components/ui/tooltip.tsx";
import { NavMenu } from "#/components/ui/nav-menu.tsx";
import { NavItem } from "#/components/ui/nav-item.tsx";

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

export const CreatorSwitcher = memo(function CreatorSwitcher({
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
  const searchIconRef = useRef<AnimatedIconHandle>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Combobox active-descendant (-1 = none; Enter falls back to the first).
  const [activeIndex, setActiveIndex] = useState(-1);
  // Roving tabindex for the closed tab row (-1 = follow the selected tab until
  // the user first arrows). Manual activation: arrows move focus, Enter/Space
  // (native <button>) selects — so arrowing never fires a route navigation.
  const [tabFocus, setTabFocus] = useState(-1);
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

  useLayoutEffect(() => {
    positionPill(false);
    const onResize = () => positionPill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    positionPill(true);
    if (open) inputRef.current?.focus();
  }, [open, selected]);

  // Keep the active option scrolled into view as arrows move it.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`sw-opt-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Memoized so the ticker route's per-hover-frame re-renders don't re-filter/sort
  // this list every frame (the component isn't wrapped in React.memo).
  const tabs = useMemo(() => pickAvatarTabs(creators, selected, 3), [creators, selected]);
  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return creators
      .filter((c) => c.name.toLowerCase().includes(ql) || c.handle.toLowerCase().includes(ql))
      .sort((a, b) => (b.lastCallDate ?? "").localeCompare(a.lastCallDate ?? ""));
  }, [creators, q]);

  // Switcher only earns its place with someone to switch to. Returns after all
  // hooks so they stay unconditional (effects no-op while refs are null).
  if (creators.length <= 1) return null;

  const go = (creator: string) =>
    navigate({ to: "/t/$symbol/$creator", params: { symbol, creator }, resetScroll: false });

  // Tab-row layout: index 0 = "All", 1..N = avatar tabs, N+1 = search trigger.
  const lastTabIndex = tabs.length + 1;
  const selectedTabIndex =
    selected === null
      ? 0
      : (() => {
          const i = tabs.findIndex((c) => c.handle === selected);
          return i >= 0 ? i + 1 : 0;
        })();
  // Until the user arrows, the selected tab is the one in the tab order (ARIA).
  const rovingIndex = tabFocus < 0 ? selectedTabIndex : Math.min(tabFocus, lastTabIndex);

  // Roving arrow-key nav across the closed tab row, mirroring the timeframe tabs.
  const onTabRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const btns = [
      ...(listRef.current?.querySelectorAll<HTMLButtonElement>(".cs-layer-tabs .t-tab") ?? []),
    ];
    if (!btns.length) return;
    const last = btns.length - 1;
    // Read the live focus, not React state — robust to Tab-in and rapid keys.
    const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
    const from = cur >= 0 ? cur : rovingIndex;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = from >= last ? 0 : from + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = from <= 0 ? last : from - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    setTabFocus(next);
    btns[next]?.focus();
  };

  // Single source of truth for the morph: data-open drives the pill expansion
  // and the crossfade between the tab-row layer and the combobox layer. Both
  // layers stay mounted so neither hard-pops; the inactive one is faded out and
  // made inert (pointer-events/visibility via CSS).
  return (
    <div className="cs-root shrink-0" data-open={open || undefined}>
      <div className="t-tabs cs-tabs" ref={listRef}>
        <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />

        {/* Tab-row layer: All + avatar tabs + the search trigger. */}
        <div
          className="cs-layer cs-layer-tabs"
          role="tablist"
          aria-hidden={open}
          onKeyDown={onTabRowKeyDown}
        >
          <button
            type="button"
            role="tab"
            aria-selected={selected === null}
            tabIndex={open ? -1 : rovingIndex === 0 ? 0 : -1}
            className="t-tab font-mono"
            onClick={() => go("all")}
          >
            All
          </button>
          <TooltipProvider delayDuration={0}>
            {tabs.map((c, i) => (
              <Tooltip key={c.handle} content={c.name}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected === c.handle}
                  aria-label={c.name}
                  tabIndex={open ? -1 : rovingIndex === i + 1 ? 0 : -1}
                  className="t-tab"
                  data-avatar-tab=""
                  onClick={() => go(c.handle)}
                >
                  <Avatar creator={c} dimmed={selected !== c.handle} />
                </button>
              </Tooltip>
            ))}
          </TooltipProvider>
          <button
            type="button"
            aria-label="Search creators"
            tabIndex={open ? -1 : rovingIndex === lastTabIndex ? 0 : -1}
            className="t-tab cs-search-tab"
            onClick={() => {
              setQ("");
              setActiveIndex(-1);
              setOpen(true);
            }}
            onMouseEnter={() => searchIconRef.current?.startAnimation()}
            onMouseLeave={() => searchIconRef.current?.stopAnimation()}
          >
            <SearchIcon ref={searchIconRef} size={15} />
          </button>
        </div>

        {/* Combobox layer: the search icon stays put as the morph anchor and
            the input grows out of it. */}
        <div className="cs-layer cs-layer-combobox" aria-hidden={!open}>
          <Search size={15} className="cs-search-icon text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            role="combobox"
            tabIndex={open ? 0 : -1}
            placeholder="Search creators…"
            aria-label="Search creators"
            aria-expanded={open}
            aria-controls="cs-listbox"
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex >= 0 ? `sw-opt-${activeIndex}` : undefined}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setActiveIndex(-1);
            }}
            // Combobox keyboard model: focus stays on the input, arrows move the
            // active descendant, Enter follows it, Escape closes.
            onKeyDown={(e) => {
              const n = filtered.length;
              switch (e.key) {
                case "ArrowDown":
                  e.preventDefault();
                  if (n) setActiveIndex((i) => Math.min(i + 1, n - 1));
                  break;
                case "ArrowUp":
                  e.preventDefault();
                  setActiveIndex((i) => (i <= 0 ? -1 : i - 1));
                  break;
                case "Home":
                  if (n) {
                    e.preventDefault();
                    setActiveIndex(0);
                  }
                  break;
                case "End":
                  if (n) {
                    e.preventDefault();
                    setActiveIndex(n - 1);
                  }
                  break;
                case "Enter": {
                  e.preventDefault();
                  const c = filtered[activeIndex >= 0 ? activeIndex : 0];
                  if (c) {
                    go(c.handle);
                    setOpen(false);
                  }
                  break;
                }
                case "Escape":
                  e.preventDefault();
                  setOpen(false);
                  break;
              }
            }}
          />
        </div>
      </div>

      <div id="cs-listbox" className="cs-panel" role="listbox" data-open={open || undefined}>
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No creators match.</div>
        ) : (
          <NavMenu
            activeSlug={selected ? `sw:${selected}` : null}
            // While searching, the combobox activeIndex drives the hover pill.
            controlledActiveIndex={open ? activeIndex : undefined}
            radius="rounded-[10px]"
            aria-label="Creators"
          >
            {filtered.map((c, i) => (
              <NavItem
                key={c.handle}
                id={`sw-opt-${i}`}
                index={i}
                slug={`sw:${c.handle}`}
                to="/t/$symbol/$creator"
                params={{ symbol, creator: c.handle }}
                resetScroll={false}
                role="option"
                aria-selected={activeIndex === i}
                // Combobox: focus stays on the input, options are activated via
                // aria-activedescendant, never individually tab-focusable.
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => setOpen(false)}
                className="cs-option"
              >
                <Avatar creator={c} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{c.name}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {c.callCount} call{c.callCount === 1 ? "" : "s"} · last {c.lastCallDate ?? "—"}
                  </span>
                </span>
              </NavItem>
            ))}
          </NavMenu>
        )}
      </div>
    </div>
  );
});

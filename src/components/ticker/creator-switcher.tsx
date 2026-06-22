import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { pickAvatarTabs, type SwitcherCreator } from "#/lib/ticker-switcher.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip.tsx";

function Avatar({ creator }: { creator: SwitcherCreator }) {
  return creator.avatar ? (
    <img src={creator.avatar} alt="" className="cs-avatar" />
  ) : (
    <span className="cs-avatar-fallback">{creator.handle.slice(0, 2)}</span>
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
      apply(0, list.clientWidth - 6); // inset 3px both sides
    } else {
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) {
        // Avatar tabs get a circular indicator (square pill, border-radius 48px)
        // centered on the tab so it rings the round avatar instead of boxing it
        // in a wide pill. Text tabs (All) keep the full-width pill.
        if (active.dataset.avatarTab != null) {
          const d = active.offsetHeight;
          apply(active.offsetLeft + (active.offsetWidth - d) / 2, d);
        } else {
          apply(active.offsetLeft, active.offsetWidth);
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
    navigate({ to: "/t/$symbol/$creator", params: { symbol, creator } });

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
    <div className="cs-root" data-open={open || undefined}>
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
                    <Avatar creator={c} />
                  </button>
                }
              />
              <TooltipPopup>{c.name}</TooltipPopup>
            </Tooltip>
          ))}
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

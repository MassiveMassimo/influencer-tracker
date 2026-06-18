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

  // Switcher only earns its place with someone to switch to.
  if (creators.length <= 1) return null;

  const tabs = pickAvatarTabs(creators, selected, 3);
  const go = (creator: string) =>
    navigate({ to: "/t/$symbol/$creator", params: { symbol, creator } });

  // Position the pill under the active tab; when the combobox is open the pill
  // expands to fill the whole container and becomes the combobox background.
  const positionPill = (animate: boolean) => {
    const list = listRef.current, pill = pillRef.current;
    if (!list || !pill) return;
    const apply = (left: number, width: number) => {
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
    };
    if (!animate) pill.style.transition = "none";
    if (open) {
      apply(0, list.clientWidth - 6); // inset 3px both sides
    } else {
      const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (active) apply(active.offsetLeft, active.offsetWidth);
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

  const filtered = creators
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.handle.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.lastCallDate ?? "").localeCompare(a.lastCallDate ?? ""));

  return (
    <div className="relative">
      <div className="t-tabs" role="tablist" ref={listRef}>
        <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />

        {!open && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={selected === null}
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
                      className="t-tab"
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
              className="t-tab"
              onClick={() => { setQ(""); setOpen(true); }}
            >
              <Search size={15} />
            </button>
          </>
        )}

        {open && (
          <div className="cs-combobox">
            <Search size={15} className="text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              placeholder="Search creators…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            />
          </div>
        )}
      </div>

      {open && (
        <div className="cs-panel" role="listbox">
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
                className="cs-option"
                onClick={() => { setOpen(false); go(c.handle); }}
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
      )}
    </div>
  );
}

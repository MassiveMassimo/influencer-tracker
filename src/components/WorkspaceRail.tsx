import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDownIcon, LineChartIcon, UsersIcon } from "lucide-react";
import { HomeIcon } from "./icons/home";
import { CompassIcon } from "./icons/compass";
import { SettingsIcon } from "./icons/settings";
import type { AnimatedIconHandle } from "./icons/types";
import GitHubLink from "./GitHubLink";
import { IconSwap } from "./icon-swap";
import { Button } from "./ui/button";
import { NavMenu } from "./ui/nav-menu";
import { NavItem } from "./ui/nav-item";

// Lazy so Base UI Dialog + vaul Drawer (only used by the settings modal) stay out
// of the every-route rail bundle; loaded on first open, then kept mounted so the
// close transition still plays.
const Preferences = lazy(() => import("./Preferences").then((m) => ({ default: m.Preferences })));
import { ScrollArea } from "./ui/scroll-area";
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { Tooltip } from "./ui/tooltip";
import { usePreferences } from "#/lib/preferences.tsx";
import { RailStocks } from "./RailStocks";
import { RailNavList } from "./RailNavList";
import type { RailStock } from "#/lib/rail-stocks.ts";

export type { RailStock } from "#/lib/rail-stocks.ts";

export interface CreatorRef {
  handle: string;
  name: string;
  avatar?: string;
  platform?: "x" | "instagram"; // derived from the calls-index in __root (numeric shortcode ⇒ X)
  generatedAt?: string; // newest of these across creators drives the backend-health dot
}

const RAIL_SECTIONS_KEY = "rail-sections";
const DEFAULT_OPEN = ["creators", "stocks"];

// Persisted open/closed state for the Creators + Stocks accordion sections.
// SSR-safe: renders the both-open default on the server + first paint, then
// hydrates from localStorage in an effect (mirrors the BackendHealth clock
// pattern). `hydrated` keeps the grid transition off for that first correction,
// so a stored-collapsed section doesn't animate shut on every page load.
function useRailSections() {
  const [open, setOpen] = useState<string[]>(DEFAULT_OPEN);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAIL_SECTIONS_KEY);
      if (raw) setOpen(JSON.parse(raw) as string[]);
    } catch {
      // Ignore malformed storage; keep the default.
    }
    setHydrated(true);
  }, []);
  const update = useCallback((next: string[]) => {
    setOpen(next);
    try {
      window.localStorage.setItem(RAIL_SECTIONS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode); state still applies for the session.
    }
  }, []);
  return { open, update, hydrated };
}

// Per-section search box state (one instance per accordion section). Substring
// filtering; `activeIndex` is the combobox active-descendant (-1 = none, focus
// rests on the input). Typing or closing resets the active option.
function useSectionSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const setQuery = useCallback((v: string) => {
    setQueryState(v);
    setActiveIndex(-1);
  }, []);
  const openSearch = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setQueryState("");
    setActiveIndex(-1);
  }, []);
  return { open, query, setQuery, activeIndex, setActiveIndex, openSearch, close };
}

// Shared rail body, rendered in the desktop aside and inside the mobile drawer.
// onNavigate lets the drawer close itself when a link is followed.
export function RailContent({
  creators,
  stocks,
  onNavigate,
}: {
  creators: CreatorRef[];
  stocks: RailStock[];
  onNavigate?: () => void;
}) {
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Stays true after the first open so the lazy modal remains mounted and can
  // play its close transition (gating render on prefsOpen would cut it).
  const [prefsMounted, setPrefsMounted] = useState(false);
  const settingsRef = useRef<AnimatedIconHandle>(null);
  const { open, update, hydrated } = useRailSections();
  const { reduceMotion } = usePreferences();
  const creatorsOpen = open.includes("creators");
  const stocksOpen = open.includes("stocks");

  // Active-route slugs for the NavMenu pills (matched against each item's slug).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const primaryActive =
    pathname === "/" ? "home" : pathname.startsWith("/explore") ? "explore" : null;
  const activeCreator = pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const creatorsActive = activeCreator ? `c:${activeCreator}` : null;

  const creatorSearch = useSectionSearch();
  const stockSearch = useSectionSearch();
  // Opening a section's search also expands it, so the filtered rows are visible.
  const expand = (key: string) => {
    if (!open.includes(key)) update([...open, key]);
  };
  const cq = creatorSearch.query.trim().toLowerCase();
  const shownCreators = cq
    ? creators.filter(
        (c) => c.handle.toLowerCase().includes(cq) || c.name.toLowerCase().includes(cq),
      )
    : creators;
  return (
    <div className="flex h-full flex-col">
      {/* Toggle button is rendered in __root's overlay layer (right of this
          header), not here, so it isn't scaled/blurred with the collapsing rail. */}
      <Link
        to="/"
        onClick={onNavigate}
        className="flex w-full items-center gap-2.5 border-b border-border/60 px-3.5 py-3 text-left no-underline"
      >
        <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-foreground/80 to-foreground/40 ring-1 ring-border/60">
          <LineChartIcon className="size-4 text-background" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">Signal Tracker</div>
          <div className="truncate font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            vs SPY
          </div>
        </div>
      </Link>

      {/* Primary nav — FF NavMenu (animated hover/active pill). Fixed above the
          collapsible sections (Changelog moved to Preferences). */}
      <div className="shrink-0 px-2 py-3">
        <NavMenu activeSlug={primaryActive} radius="rounded-md" aria-label="Primary">
          <NavItem
            index={0}
            slug="home"
            to="/"
            onClick={onNavigate}
            animatedIcon={HomeIcon}
            label="Home"
          />
          <NavItem
            index={1}
            slug="explore"
            to="/explore"
            onClick={onNavigate}
            animatedIcon={CompassIcon}
            label="Explore calls"
          />
        </NavMenu>
      </div>

      {/* Creators + Stocks split the leftover height equally and collapse. Base
          UI accordion drives open state + keyboard/a11y; grid-template-rows `fr`
          does the equal-fill + collapse — the native Panel is content-height,
          which can't share/fill the column, so it isn't used. Layout is four
          grid rows: auto trigger / fr panel, per section. */}
      <AccordionPrimitive.Root
        multiple
        value={open}
        onValueChange={(v) => update(v as string[])}
        className={`grid min-h-0 flex-1 content-start ${
          hydrated && !reduceMotion
            ? "transition-[grid-template-rows] duration-200 ease-in-out"
            : ""
        }`}
        style={{
          gridTemplateRows: `auto ${creatorsOpen ? "1fr" : "0fr"} auto ${
            stocksOpen ? "1fr" : "0fr"
          }`,
        }}
      >
        <AccordionPrimitive.Item value="creators" className="contents">
          <RailSectionTrigger
            label="Creators"
            searchOpen={creatorSearch.open}
            query={creatorSearch.query}
            onQueryChange={creatorSearch.setQuery}
            onOpenSearch={() => {
              creatorSearch.openSearch();
              expand("creators");
            }}
            onCloseSearch={creatorSearch.close}
            activeIndex={creatorSearch.activeIndex}
            setActiveIndex={creatorSearch.setActiveIndex}
          />
          <div data-rail-section="creators" className="flex min-h-0 flex-col overflow-hidden">
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="overscroll-contain px-2 pb-2 scroll-fade"
            >
              <RailNavList
                items={shownCreators}
                getKey={(c) => c.handle}
                section="creators"
                navAriaLabel="Creators navigation"
                listAriaLabel="Creators"
                activeSlug={creatorsActive}
                // While searching, the combobox activeIndex drives the hover pill;
                // otherwise proximity hover takes over.
                searchOpen={creatorSearch.open}
                activeIndex={creatorSearch.activeIndex}
                setActiveIndex={creatorSearch.setActiveIndex}
                getSlug={(c) => `c:${c.handle}`}
                getLinkProps={(c) => ({ to: "/c/$handle", params: { handle: c.handle } })}
                getItemClassName={(_c, isActiveRoute) =>
                  `gap-2.5 px-2 py-1.5 text-sm ${
                    isActiveRoute ? "text-foreground" : "text-muted-foreground"
                  }`
                }
                onRowClick={() => {
                  onNavigate?.();
                  creatorSearch.close();
                }}
                emptyText={creators.length === 0 ? "No creators yet" : "No matches"}
                renderRow={(c) => (
                  <>
                    {c.avatar ? (
                      <img
                        src={c.avatar}
                        alt=""
                        className="size-4 shrink-0 rounded-full object-cover ring-1 ring-border/60"
                      />
                    ) : (
                      <UsersIcon className="size-3.5 opacity-60" />
                    )}
                    <span className="truncate">@{c.handle}</span>
                  </>
                )}
              />
            </ScrollArea>
          </div>
        </AccordionPrimitive.Item>

        <AccordionPrimitive.Item value="stocks" className="contents">
          <RailSectionTrigger
            label="Stocks"
            searchOpen={stockSearch.open}
            query={stockSearch.query}
            onQueryChange={stockSearch.setQuery}
            onOpenSearch={() => {
              stockSearch.openSearch();
              expand("stocks");
            }}
            onCloseSearch={stockSearch.close}
            activeIndex={stockSearch.activeIndex}
            setActiveIndex={stockSearch.setActiveIndex}
          />
          <div data-rail-section="stocks" className="flex min-h-0 flex-col overflow-hidden">
            <RailStocks
              stocks={stocks}
              onNavigate={onNavigate}
              query={stockSearch.query}
              searchOpen={stockSearch.open}
              activeIndex={stockSearch.activeIndex}
              setActiveIndex={stockSearch.setActiveIndex}
              onSelect={stockSearch.close}
            />
          </div>
        </AccordionPrimitive.Item>
      </AccordionPrimitive.Root>

      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5">
        <BackendHealth creators={creators} />
        <div className="flex items-center gap-1.5">
          <GitHubLink />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setPrefsMounted(true);
              setPrefsOpen(true);
            }}
            onMouseEnter={() => settingsRef.current?.startAnimation()}
            onMouseLeave={() => settingsRef.current?.stopAnimation()}
            aria-label="Preferences"
            title="Preferences"
          >
            <SettingsIcon ref={settingsRef} size={16} />
          </Button>
        </div>
      </div>
      {prefsMounted && (
        <Suspense fallback={null}>
          <Preferences open={prefsOpen} onOpenChange={setPrefsOpen} />
        </Suspense>
      )}
    </div>
  );
}

// Backend-health dot derived from data freshness: the newest dataset `generatedAt` is a
// proxy for "did the daily imos-vm ingest run". The compare against the client clock runs
// post-mount (the server can't know the viewer's clock), so SSR and hydration agree on the
// neutral first paint and only then resolve to live/delayed/stale.
function BackendHealth({ creators }: { creators: CreatorRef[] }) {
  const newest = creators
    .map((c) => c.generatedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  // isClient: false during SSR + the hydrating first paint (matches the server), true after.
  // Avoids a hydration mismatch without a mount-effect — the clock is read inline only once
  // the client snapshot is active. (Date.now() can't be the snapshot itself; it never settles.)
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  let dot = "bg-muted-foreground/40";
  let label = "Backend";
  let detail = newest ? `Data updated ${newest}` : "No data yet";
  if (isClient && newest) {
    const days = Math.floor((Date.now() - Date.parse(newest)) / 86_400_000);
    detail = `Data updated ${newest} · ${days <= 0 ? "today" : `${days}d ago`}`;
    // Daily 13:00 UTC cadence: today/yesterday is healthy, a slipped day is amber, ≥3d stale.
    if (days < 2) {
      dot = "bg-emerald-500";
      label = "Live";
    } else if (days < 3) {
      dot = "bg-amber-500";
      label = "Delayed";
    } else {
      dot = "bg-red-500";
      label = "Stale";
    }
  }
  return (
    <Tooltip content={detail}>
      <span className="flex items-center gap-1.5 truncate font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        <span className={`size-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    </Tooltip>
  );
}

// Collapsible section header: a Base UI accordion trigger (chevron rotates on
// open) with an inline search box. The label crossfades to a text input (blur +
// opacity, the project's layer-swap convention); the chevron + right control
// stay put. Input lives outside the Trigger button (invalid to nest) as an
// absolute overlay; reduced motion is handled globally via data-reduce-motion.
function RailSectionTrigger({
  label,
  searchOpen,
  query,
  onQueryChange,
  onOpenSearch,
  onCloseSearch,
  activeIndex,
  setActiveIndex,
}: {
  label: string;
  searchOpen: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const region = label.toLowerCase();
  const listId = `rail-${region}-results`;
  const optionId = (i: number) => `${region}-opt-${i}`;
  const activeDescendant = searchOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined;
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  // Reset when the user clicks outside this section (header controls + its list
  // both carry data-rail-section, so clicking a result navigates instead of
  // closing — avoids the blur-vs-result-click race).
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest(`[data-rail-section="${region}"]`)) onCloseSearch();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen, region, onCloseSearch]);
  // Keep the active option scrolled into view as it changes.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${region}-opt-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [region, activeIndex]);
  const optionCount = () =>
    document.querySelectorAll(`[data-rail-section="${region}"] [role="option"]`).length;
  // Combobox keyboard model: focus stays on the input, arrows move the active
  // descendant, Enter follows it, Escape closes. (Active option is highlighted
  // via aria-selected on the rows; the input advertises it via aria-activedescendant.)
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const n = optionCount();
        if (n) setActiveIndex(Math.min(activeIndex + 1, n - 1));
        break;
      }
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex(activeIndex <= 0 ? -1 : activeIndex - 1);
        break;
      case "Home":
        if (optionCount()) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End": {
        const n = optionCount();
        if (n) {
          e.preventDefault();
          setActiveIndex(n - 1);
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        const idx = activeIndex >= 0 ? activeIndex : 0;
        document.getElementById(optionId(idx))?.querySelector("a")?.click();
        break;
      }
      case "Escape":
        e.preventDefault();
        onCloseSearch();
        break;
    }
  };
  return (
    <AccordionPrimitive.Header
      data-rail-section={region}
      className="relative flex items-center border-t border-border/60"
    >
      <AccordionPrimitive.Trigger className="group flex flex-1 cursor-pointer items-center gap-1.5 px-3 py-3 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-panel-open:*:data-[slot=accordion-indicator]:rotate-180">
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-[transform,color] duration-200 group-hover:text-foreground"
          data-slot="accordion-indicator"
        />
        <span
          className={`font-mono text-[10px] tracking-[0.25em] text-muted-foreground/70 uppercase transition-[opacity,filter,color] duration-200 group-hover:text-foreground ${
            searchOpen ? "opacity-0 blur-[2px]" : "blur-0 opacity-100"
          }`}
        >
          {label}
        </span>
      </AccordionPrimitive.Trigger>

      {/* Search input — crossfades over the label; chevron + right control stay
          put. Always mounted for the transition; inert when closed. */}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${label.toLowerCase()}…`}
        tabIndex={searchOpen ? 0 : -1}
        aria-hidden={!searchOpen}
        aria-label={`Search ${label.toLowerCase()}`}
        aria-expanded={searchOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        autoComplete="off"
        className={`absolute inset-y-0 right-10 left-9 bg-transparent text-sm text-foreground transition-[opacity,filter] duration-200 outline-none placeholder:text-muted-foreground/50 ${
          searchOpen ? "blur-0 opacity-100" : "pointer-events-none opacity-0 blur-[2px]"
        }`}
      />

      {/* Right control: search opens the box, × closes + clears it. */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
        aria-label={searchOpen ? `Clear ${label} search` : `Search ${label}`}
        className="mr-1 shrink-0 text-muted-foreground/60"
      >
        <IconSwap
          icon={searchOpen ? "icon-[lucide--x]" : "icon-[lucide--search]"}
          className="size-3.5"
        />
      </Button>
    </AccordionPrimitive.Header>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, CompassIcon, HomeIcon, LineChartIcon, SearchIcon, SettingsIcon, UsersIcon, X } from "lucide-react";
import GitHubLink from "./GitHubLink";

// Lazy so Base UI Dialog + vaul Drawer (only used by the settings modal) stay out
// of the every-route rail bundle; loaded on first open, then kept mounted so the
// close transition still plays.
const Preferences = lazy(() => import("./Preferences").then((m) => ({ default: m.Preferences })));
import { ScrollArea } from "./ui/scroll-area";
import { AccordionPrimitive } from "./ui/accordion";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { usePreferences } from "#/lib/preferences.tsx";
import { RailStocks } from "./RailStocks";
import type { RailStock } from "#/lib/rail-stocks.ts";

export type { RailStock } from "#/lib/rail-stocks.ts";

export interface CreatorRef {
  handle: string;
  name: string;
  avatar?: string;
  platform?: "x" | "instagram"; // derived from the calls-index in __root (numeric shortcode ⇒ X)
  generatedAt?: string; // newest of these across creators drives the backend-health dot
}

// Left workspace rail (devl workspace-rail aesthetic): app mark + name, primary
// nav, and a creators section. Wraps all routes via __root.
export function WorkspaceRail({ creators, stocks }: { creators: CreatorRef[]; stocks: RailStock[] }) {
  return (
    <aside className="h-svh border-r border-border/60">
      <RailContent creators={creators} stocks={stocks} />
    </aside>
  );
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
// filtering over the already-loaded ≤20 rows — no index/library warranted at
// this scale (mirrors creator-switcher / call-filter).
function useSectionSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openSearch = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  return { open, query, setQuery, openSearch, close };
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
  const { open, update, hydrated } = useRailSections();
  const { reduceMotion } = usePreferences();
  const creatorsOpen = open.includes("creators");
  const stocksOpen = open.includes("stocks");

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
    <div className="flex h-full flex-col bg-foreground/[0.02]">
      <Link
        to="/"
        onClick={onNavigate}
        className="flex w-full items-center gap-2.5 border-b border-border/60 px-3.5 py-3 text-left no-underline transition-colors hover:bg-foreground/[0.03]"
      >
        <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-foreground/80 to-foreground/40 ring-1 ring-border/60">
          <LineChartIcon className="size-4 text-background" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-sm text-foreground">
            Signal Tracker
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            vs SPY
          </div>
        </div>
      </Link>

      {/* Primary nav — fixed above the collapsible sections (Changelog moved to
          Preferences). */}
      <nav className="shrink-0 px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              to="/"
              onClick={onNavigate}
              activeOptions={{ exact: true }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
              activeProps={{
                className:
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-foreground/[0.06] text-foreground no-underline",
              }}
            >
              <HomeIcon className="size-4 opacity-70" />
              Home
            </Link>
          </li>
          <li>
            <Link
              to="/explore"
              onClick={onNavigate}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
              activeProps={{
                className:
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-foreground/[0.06] text-foreground no-underline",
              }}
            >
              <CompassIcon className="size-4 opacity-70" />
              Explore calls
            </Link>
          </li>
        </ul>
      </nav>

      {/* Creators + Stocks split the leftover height equally and collapse. Base
          UI accordion drives open state + keyboard/a11y; grid-template-rows `fr`
          does the equal-fill + collapse — the native Panel is content-height,
          which can't share/fill the column, so it isn't used. Layout is four
          grid rows: auto trigger / fr panel, per section. */}
      <AccordionPrimitive.Root
        multiple
        value={open}
        onValueChange={(v) => update(v as string[])}
        className={`grid content-start min-h-0 flex-1 ${
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
          />
          <div className="flex min-h-0 flex-col overflow-hidden">
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="px-2 pb-2"
              scrollbarClassName="w-1.5"
            >
              <ul className="flex flex-col gap-0.5">
                {creators.length === 0 ? (
                  <li className="px-2 py-1.5 text-muted-foreground/60 text-xs">
                    No creators yet
                  </li>
                ) : shownCreators.length === 0 ? (
                  <li className="px-2 py-1.5 text-muted-foreground/60 text-xs">
                    No matches
                  </li>
                ) : (
                  shownCreators.map((c) => (
                    <li key={c.handle}>
                      <Link
                        to="/c/$handle"
                        params={{ handle: c.handle }}
                        onClick={onNavigate}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
                        activeProps={{
                          className:
                            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-foreground/[0.06] text-foreground no-underline",
                        }}
                      >
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
                      </Link>
                    </li>
                  ))
                )}
              </ul>
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
          />
          <div className="flex min-h-0 flex-col overflow-hidden">
            <RailStocks
              stocks={stocks}
              onNavigate={onNavigate}
              query={stockSearch.query}
              searchOpen={stockSearch.open}
            />
          </div>
        </AccordionPrimitive.Item>
      </AccordionPrimitive.Root>

      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5">
        <BackendHealth creators={creators} />
        <div className="flex items-center gap-1.5">
          <GitHubLink className="grid place-items-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground" />
          <button
            type="button"
            onClick={() => {
              setPrefsMounted(true);
              setPrefsOpen(true);
            }}
            aria-label="Preferences"
            title="Preferences"
            className="grid place-items-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </button>
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
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            <span className={`size-1.5 rounded-full ${dot}`} />
            {label}
          </span>
        }
      />
      <TooltipPopup>{detail}</TooltipPopup>
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
}: {
  label: string;
  searchOpen: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);
  return (
    <AccordionPrimitive.Header className="relative flex items-center border-t border-border/60">
      <AccordionPrimitive.Trigger className="flex flex-1 cursor-pointer items-center gap-1.5 px-3 py-3 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:-outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring data-panel-open:*:data-[slot=accordion-indicator]:rotate-180">
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200"
          data-slot="accordion-indicator"
        />
        <span
          className={`font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.25em] transition-[opacity,filter] duration-200 ${
            searchOpen ? "opacity-0 blur-[2px]" : "opacity-100 blur-0"
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
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCloseSearch();
        }}
        placeholder={`Search ${label.toLowerCase()}…`}
        tabIndex={searchOpen ? 0 : -1}
        aria-hidden={!searchOpen}
        className={`absolute inset-y-0 left-9 right-10 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50 transition-[opacity,filter] duration-200 ${
          searchOpen ? "opacity-100 blur-0" : "pointer-events-none opacity-0 blur-[2px]"
        }`}
      />

      {/* Right control: search opens the box, × closes + clears it. */}
      <button
        type="button"
        onClick={() => (searchOpen ? onCloseSearch() : onOpenSearch())}
        aria-label={searchOpen ? `Clear ${label} search` : `Search ${label}`}
        className="grid shrink-0 place-items-center px-3 py-3 text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        {searchOpen ? <X className="size-3.5" /> : <SearchIcon className="size-3.5" />}
      </button>
    </AccordionPrimitive.Header>
  );
}

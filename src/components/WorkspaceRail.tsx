import { useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { CompassIcon, HomeIcon, LineChartIcon, SettingsIcon, UsersIcon } from "lucide-react";
import GitHubLink from "./GitHubLink";
import { Preferences } from "./Preferences";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { RailStocks } from "./RailStocks";
import type { RailStock } from "#/lib/rail-stocks.ts";

export type { RailStock } from "#/lib/rail-stocks.ts";

export interface CreatorRef {
  handle: string;
  name: string;
  avatar?: string;
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

      {/* Mask defaults to --color-background; the rail's bg-foreground/[0.02]
          overlay is ~background, so the edge fade reads correctly. */}
      <ScrollArea className="mt-3 min-h-0 flex-1" viewportClassName="px-2 pb-4">
        <nav>
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

        <SectionLabel>Creators</SectionLabel>
        <ul className="flex flex-col gap-0.5">
          {creators.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground/60 text-xs">
              No creators yet
            </li>
          ) : (
            creators.map((c) => (
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
        </nav>
      </ScrollArea>

      <SectionLabel>Stocks</SectionLabel>
      <RailStocks stocks={stocks} onNavigate={onNavigate} />

      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5">
        <BackendHealth creators={creators} />
        <div className="flex items-center gap-1.5">
          <GitHubLink className="grid place-items-center rounded-full border border-border/60 bg-background p-2 text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-foreground/[0.05] hover:text-foreground" />
          <button
            type="button"
            onClick={() => setPrefsOpen(true)}
            aria-label="Preferences"
            title="Preferences"
            className="grid place-items-center rounded-full border border-border/60 bg-background p-2 text-muted-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </button>
        </div>
      </div>
      <Preferences open={prefsOpen} onOpenChange={setPrefsOpen} />
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex items-center justify-between px-2">
      <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-[0.25em]">
        {children}
      </span>
    </div>
  );
}

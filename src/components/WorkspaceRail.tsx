import { Link } from "@tanstack/react-router";
import { HomeIcon, LineChartIcon, UsersIcon } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

interface CreatorRef {
  handle: string;
  name: string;
}

// Left workspace rail (devl workspace-rail aesthetic): app mark + name, primary
// nav, and a creators section. Wraps all routes via __root.
export function WorkspaceRail({ creators }: { creators: CreatorRef[] }) {
  return (
    <aside className="flex h-svh flex-col border-r border-border/60 bg-foreground/[0.02]">
      <Link
        to="/"
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

      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-4">
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              to="/"
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
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
                  activeProps={{
                    className:
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-foreground/[0.06] text-foreground no-underline",
                  }}
                >
                  <UsersIcon className="size-3.5 opacity-60" />
                  <span className="truncate">@{c.handle}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </nav>

      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5">
        <div className="flex size-7 items-center justify-center rounded-full bg-foreground font-medium text-[11px] text-background">
          S
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">Signal Tracker</div>
          <div className="flex items-center gap-1.5 truncate text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Influencer accuracy
          </div>
        </div>
        <ThemeToggle />
      </div>
    </aside>
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

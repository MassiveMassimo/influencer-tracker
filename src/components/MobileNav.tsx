import { useState } from "react";
import { LineChartIcon, MenuIcon } from "lucide-react";
import { useMatch, useParams } from "@tanstack/react-router";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { type CreatorRef, type RailStock, RailContent } from "./WorkspaceRail";
import { useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { profileUrl, platformIcon } from "#/lib/platform.ts";

// Mobile-only top bar (hidden at md+). Hosts the menu trigger and a contextual
// mark: creator avatar + name on a creator page, a mono ticker badge + company
// on a ticker page, the app brand elsewhere. The GitHub link lives in the rail
// drawer, so it's intentionally absent here.
export function MobileNav({ creators, stocks }: { creators: CreatorRef[]; stocks: RailStock[] }) {
  const [open, setOpen] = useState(false);
  // MobileNav wraps every route, so read whichever id the active route exposes
  // (strict:false → {} when none). handle = creator page, symbol = ticker page.
  const { handle, symbol } = useParams({ strict: false }) as { handle?: string; symbol?: string };
  const creator = handle ? creators.find((c) => c.handle === handle) : undefined;
  const sym = symbol?.toUpperCase();
  // Company name comes from the ticker route's loader (Yahoo-derived, same source
  // as the desktop heading) — not the rail `stocks` list, which is capped at the
  // top 20 by last-call and silently drops the company for every other ticker.
  const tickerMatch = useMatch({ from: "/t/$symbol/$creator", shouldThrow: false });
  const company = tickerMatch?.loaderData?.company;
  // Halal badge between the symbol and company (opt-in; renders nothing when the
  // toggle is off or the symbol is unrated). Reads the route loader's prefetch.
  const getHalal = useHalalStatus(sym ? [sym] : []);
  // Platform icon + profile link for the creator mark (mirrors the desktop
  // CreatorHeading). platform is derived in __root from the calls-index.
  const creatorHref = creator ? profileUrl(creator.platform, creator.handle) : "";
  const creatorIcon = platformIcon(creator?.platform);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-md md:hidden">
      <Drawer
        direction="left"
        shouldScaleBackground
        open={open}
        onOpenChange={setOpen}
      >
        <DrawerTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <MenuIcon className="size-[18px]" />
          </button>
        </DrawerTrigger>
        <DrawerContent className="p-0">
          <DrawerTitle className="sr-only">Navigation</DrawerTitle>
          <DrawerDescription className="sr-only">
            Primary navigation and tracked creators
          </DrawerDescription>
          <RailContent creators={creators} stocks={stocks} onNavigate={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>

      <div className="flex min-w-0 items-center gap-2">
        {creator ? (
          <a
            href={creatorHref}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-w-0 items-center gap-2 no-underline"
          >
            {creator.avatar ? (
              <img src={creator.avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] uppercase text-muted-foreground">
                {creator.handle.slice(0, 2)}
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-sm text-foreground leading-tight group-hover:underline group-hover:underline-offset-2">{creator.name}</span>
                <span className={`${creatorIcon} shrink-0 text-muted-foreground transition-colors group-hover:text-foreground`} aria-hidden />
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground leading-tight">@{creator.handle}</span>
            </span>
          </a>
        ) : sym ? (
          <>
            <span className="flex h-6 shrink-0 items-center rounded-md border border-border/60 px-1.5 font-mono text-[11px] font-medium text-foreground">
              {sym}
            </span>
            <HalalIndicator info={getHalal(sym)} />
            {company && (
              <span className="truncate text-sm text-muted-foreground">{company}</span>
            )}
          </>
        ) : (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-foreground/80 to-foreground/40 ring-1 ring-border/60">
              <LineChartIcon className="size-3.5 text-background" />
            </div>
            <span className="font-medium text-sm text-foreground">Signal Tracker</span>
          </>
        )}
      </div>
    </div>
  );
}

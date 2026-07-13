import { LineChartIcon } from "lucide-react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { useMatch, useParams } from "@tanstack/react-router";
import { type CreatorRef } from "./WorkspaceRail";
import { W } from "#/lib/use-mobile-drawer.ts";
import { useHalalStatus } from "#/lib/halal-query.ts";
import { HalalIndicator } from "#/components/halal/halal-badge.tsx";
import { profileUrl, platformIcon } from "#/lib/platform.ts";

// Mobile-only top bar (hidden at md+). Holds a contextual mark: creator avatar +
// name on a creator page, a mono ticker badge + company on a ticker page, the app
// brand elsewhere. The GitHub link lives in the rail, so it's intentionally absent
// here. The menu toggle is an overlay in __root (it slides between here and the
// rail header, like the desktop toggle), so a spacer reserves its slot; the mark
// fades out while the rail is open so its brand logo doesn't double the rail's.
export function MobileNav({
  creators,
  progress,
}: {
  creators: CreatorRef[];
  // Drawer timeline (1 = open, 0 = closed). The mark fades out as the drawer
  // opens; the top-left rounded corner is painted by __root's fixed .t-corner-notch-top
  // (an opaque gutter notch), not this bar — the window scrolls under the bar, so
  // the bar's own rounded corner would reveal scrolling content, not the gutter.
  progress: MotionValue<number>;
}) {
  const markOpacity = useTransform(progress, [0, 1], [1, 0]);
  // The bar slides with the panel, but transforms ITSELF (not via a translated
  // ancestor) so its sticky top-0 keeps pinning when the page is scrolled. Slides
  // by the rail width, exactly like the panel beneath it (shared W → can't desync).
  const barX = useTransform(progress, [0, 1], [0, W]);
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
    <motion.div
      style={{ x: barX }}
      className="sticky top-0 z-30 flex items-center gap-2.5 overflow-hidden border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-md md:hidden"
    >
      {/* Reserves the slot for the __root overlay toggle (size-8 = icon-sm), so
          the mark stays put as the toggle slides in/out over it. */}
      <div aria-hidden className="size-8 shrink-0" />

      <div className="flex min-w-0 items-center gap-2">
        {creator ? (
          <a
            href={creatorHref}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-w-0 items-center gap-2 no-underline"
          >
            {creator.avatar ? (
              <img
                src={creator.avatar}
                alt=""
                className="size-6 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground uppercase">
                {creator.handle.slice(0, 2)}
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm leading-tight font-medium text-foreground group-hover:underline group-hover:underline-offset-2">
                  {creator.name}
                </span>
                <span
                  className={`${creatorIcon} shrink-0 text-muted-foreground transition-colors group-hover:text-foreground`}
                  aria-hidden
                />
              </span>
              <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
                @{creator.handle}
              </span>
            </span>
          </a>
        ) : sym ? (
          <>
            <span className="flex h-6 shrink-0 items-center rounded-md border border-border/60 px-1.5 font-mono text-[11px] font-medium text-foreground">
              {sym}
            </span>
            <HalalIndicator info={getHalal(sym)} />
            {company && <span className="truncate text-sm text-muted-foreground">{company}</span>}
          </>
        ) : (
          // Only the brand logo fades as the drawer opens (the rail shows its own
          // brand, so this would double it). Creator/ticker marks aren't duplicated
          // by the rail, so they stay put.
          <motion.div className="flex items-center gap-2" style={{ opacity: markOpacity }}>
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-foreground/80 to-foreground/40 ring-1 ring-border/60">
              <LineChartIcon className="size-3.5 text-background" />
            </div>
            <span className="text-sm font-medium text-foreground">Signal Tracker</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { motion, useTransform } from "motion/react";
import type { QueryClient } from "@tanstack/react-query";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { RailContent } from "../components/WorkspaceRail";
import { MobileNav } from "../components/MobileNav";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SidebarToggle } from "#/components/sidebar-toggle.tsx";
import { listCreators, fetchCallsIndex } from "../lib/data";
import { topStocksByLastCall } from "../lib/rail-stocks";
import { platformOf, type Platform } from "../lib/platform";
import { useMobileDrawer } from "#/lib/use-mobile-drawer.ts";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { HapticsProvider } from "#/lib/haptics.tsx";
import { Analytics } from "#/lib/analytics.tsx";
import { Agentation } from "agentation";
import { siteUrl } from "#/og/site.ts";

import appCss from "../styles.css?url";

// Pre-paint: apply the CSS-driven prefs (theme, reduce-motion, badge-style) before first
// paint so they never flash. All ride localStorage (not cookies) because the serve routes
// are ISR-cached — Vercel strips cookies from cacheable requests, so an SSR cookie read
// would always miss there. Applying client-side pre-paint sidesteps the cache entirely:
// theme's `auto` resolves against prefers-color-scheme (client-only anyway), and badge-style
// picks which of the two rendered badge variants CSS shows (see trait-badges.tsx).
const THEME_INIT_SCRIPT = `(function(){try{var root=document.documentElement;var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;if(window.localStorage.getItem('reduce-motion')==='true'){root.setAttribute('data-reduce-motion','true')}else{root.removeAttribute('data-reduce-motion')}root.setAttribute('data-badge-style',window.localStorage.getItem('badge-style')==='candy'?'candy':'enamel')}catch(e){}})();`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    const [creators, index] = await Promise.all([listCreators(), fetchCallsIndex()]);
    // Platform is a per-creator constant (a handle is scraped from one source);
    // derive it from the first indexed shortcode (numeric ⇒ X tweet id, else IG)
    // so MobileNav can show the platform icon + profile link without the dataset.
    const platformByHandle = new Map<string, Platform>();
    for (const e of index) {
      if (!platformByHandle.has(e.handle)) {
        platformByHandle.set(e.handle, platformOf(e.shortcode));
      }
    }
    const creatorsWithPlatform = creators.map((c) => ({
      ...c,
      platform: platformByHandle.get(c.handle),
    }));
    return { creators: creatorsWithPlatform, stocks: topStocksByLastCall(index) };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Signal Tracker — influencer accuracy vs SPY" },
      {
        name: "description",
        content:
          "Forward returns of finfluencer stock calls, measured from post date and net of SPY.",
      },
      { name: "theme-color", content: "#173a40" },
      { property: "og:site_name", content: "Signal Tracker" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Signal Tracker — influencer accuracy vs SPY" },
      { property: "og:description", content: "Forward returns of stock calls, net of SPY." },
      { property: "og:url", content: siteUrl("/") },
      { property: "og:image", content: siteUrl("/og.png") },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Signal Tracker" },
      { name: "twitter:description", content: "Forward returns of stock calls, net of SPY." },
      { name: "twitter:image", content: siteUrl("/og.png") },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

// Shared collapse curve/duration across the rail visual, padding reclaim, and
// corner radius so they move as one; motion-reduce kills it. Tailwind v4 sets
// the independent scale/translate properties (not the transform shorthand), so
// those must be named in the transition list — else they snap.
const RAIL_ANIM =
  "transition-[scale,translate,opacity,filter,padding,border-radius] duration-300 " +
  "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

function RootComponent() {
  const { creators, stocks } = Route.useLoaderData();
  // Desktop-only collapsible rail. The desktop layout is CSS-driven (md:
  // breakpoints), so it's correct on the very first SSR paint — no JS media
  // query that would render mobile-then-flip. The collapse is a data-attribute
  // + CSS transition (ease-out, off main thread, respects reduced motion).
  const [collapsed, setCollapsed] = useState(false);
  const toggleRail = useCallback(() => setCollapsed((v) => !v), []);
  // Mobile reveal drawer: the opaque content panel slides right to uncover a
  // static rail underneath (mirror of the desktop cover/reveal). The hook owns the
  // whole open/close model — `mobileOpen` drives the scrim/inert/icon, the
  // drag-to-close visual is written straight to refs, and tap/drag/escape dismissals
  // all live inside it. Separate from `collapsed` — the only opener is the
  // mobile-only hamburger, so `mobileOpen` is never true at md+.
  //
  // NOTE: no overflow scroll-lock — any overflow lock lives on an ancestor
  // (html/body), which turns it into a scroll container and breaks the sticky top
  // bar (it would detach from the viewport during the whole locked close animation).
  // Touch-scrolling the background is already blocked by the scrim's touch-none.
  const {
    isOpen: mobileOpen,
    progress,
    scrimRef,
    railRef,
    toggleRef,
    panelRef,
    cornerRef,
    cornerTopRef,
    open: openMobile,
    close: closeMobile,
    scrimHandlers,
  } = useMobileDrawer();
  // Same-timeline chrome: the top-bar mark and the menu glyph fade OUT as the
  // drawer opens (visible when closed); the X glyph fades IN. All bound to the one
  // drawer progress, so they interpolate with the drag instead of snapping at commit.
  const closedOpacity = useTransform(progress, [0, 1], [1, 0]);
  return (
    <PreferencesProvider>
      <HapticsProvider>
        <Analytics />
        {import.meta.env.DEV && (
          <>
            <Agentation
              endpoint="http://localhost:4747"
              onSessionCreated={(sessionId) => console.log("Session started:", sessionId)}
            />
            {/* Dev-only — gated here (not in RootDocument) so the panel JS is
                DCE'd from the prod bundle; the router code-splitter parses the
                route component with importMeta, but not RootDocument. */}
            <TanStackDevtools
              config={{ position: "bottom-right" }}
              plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
            />
          </>
        )}
        {/* Shell gutter behind the inset panel — below FF's page floor
            (surface-1), so it's a bespoke sub-page color, not a surface token.
            Shows in the panel's rounded-left corners + behind the transparent rail. */}
        {/* overflow-x-clip contains the mobile content slide (translated panel
            runs past the right edge) without making a scroll container — sticky
            + window scroll survive, unlike overflow-x-hidden. */}
        <div className="relative flex min-h-svh overflow-x-clip bg-zinc-100 text-foreground dark:bg-zinc-950">
          {/* Desktop rail — OUT of flow (absolute), fixed 260px, hidden on mobile
              via md: (the mobile rail below covers that), and below the content
              panel (z-10 vs z-20). Collapsing slides the opaque panel left OVER it
              (cover) while the rail recedes — scale 0.92 + fade + 12px blur. */}
          <aside
            id="workspace-rail"
            data-collapsed={collapsed}
            // inert pulls the collapsed rail's links out of the tab order and
            // hides it from AT — supersedes aria-hidden (which is a WCAG 4.1.2
            // violation on focusable content) and covers pointer-events too.
            inert={collapsed || undefined}
            className={`absolute top-0 left-0 z-10 hidden h-svh w-[260px] origin-left md:block ${RAIL_ANIM} data-[collapsed=true]:scale-[0.92] data-[collapsed=true]:opacity-0 data-[collapsed=true]:blur-[12px]`}
          >
            <RailContent creators={creators} stocks={stocks} />
          </aside>

          {/* Mobile rail — underneath, uncovered when the content panel slides
              right; the hook writes its scale/fade/blur inline so it recedes in
              sync with the drag/slide (closed = receded under the opaque content;
              open = resolved). md:hidden; the desktop aside owns md+. Transparent
              like desktop, so it sits on the same zinc gutter. fixed (not absolute)
              so it stays pinned to the viewport — the mobile page scrolls the
              window, and an absolute rail would scroll away with it. opacity-0 is
              the pre-JS closed baseline; the hook's inline styles override it. */}
          <aside
            id="mobile-rail"
            ref={railRef}
            inert={!mobileOpen || undefined}
            className="fixed top-0 left-0 z-10 block h-svh w-[260px] origin-left opacity-0 md:hidden"
          >
            <RailContent creators={creators} stocks={stocks} onNavigate={closeMobile} />
          </aside>

          {/* Content column — stays UNTRANSFORMED so the sticky top bar inside it
              isn't broken by an ancestor transform when the page is scrolled.
              Desktop reclaims the rail's space via padding-left; the mobile slide
              is applied to the pieces (scrim/panel here, top bar via motion), each
              of which the hook translates by the rail width. Mobile scrolls the
              WINDOW (not an internal ScrollArea): the frosted top bars blur the
              content scrolling behind them and the creator page's IntersectionObserver
              stat-reveal both depend on window scroll — an internal scroller's
              clip/mask isolates the layer and breaks backdrop-filter + the IO root. */}
          <div
            data-collapsed={collapsed}
            // z-20 pins the whole column above both z-10 rails so the sliding
            // pieces uncover the rail beneath. The column spans the full width and
            // is transparent over the rail's strip (desktop padding gap / mobile
            // slid-away area), so it's pointer-events-none — otherwise its
            // transparent box would eat clicks meant for the rail underneath.
            // Interactive children below re-enable pointer-events (it inherits).
            className={`pointer-events-none relative z-20 flex min-w-0 flex-1 flex-col md:h-svh md:overflow-hidden md:pl-[260px] ${RAIL_ANIM} data-[collapsed=true]:md:pl-0`}
          >
            {/* Drag surface over the pushed content (mobile only; no dim). Sits
                outside the inert inner so it stays interactive while open: a
                left-swipe drags the panel closed with fling momentum, a tap
                closes. touch-none so the browser doesn't scroll/gesture mid-drag.
                Slides with the panel (hook-painted) so it always covers the pushed
                content and leaves the uncovered rail tappable. */}
            <div
              ref={scrimRef}
              aria-hidden
              data-mopen={mobileOpen}
              {...scrimHandlers}
              className="pointer-events-none absolute inset-0 z-40 touch-none data-[mopen=true]:pointer-events-auto md:hidden"
            />
            {/* One toggle button that slides (translateX) between the rail header
                (open, +208px) and the collapsed top-left (0) — the icon swaps by
                state. Overlay layer (z above the rail). Desktop-only via md:. */}
            <div
              data-collapsed={collapsed}
              className={`pointer-events-auto absolute top-2.5 left-3 z-30 hidden md:block ${RAIL_ANIM} data-[collapsed=false]:translate-x-[208px]`}
            >
              <SidebarToggle collapsed={collapsed} onClick={toggleRail} />
            </div>
            {/* Everything else goes inert while the mobile rail is open (modal
                semantics — the scrim above stays live to close it). On desktop
                mopen is always false, so this never inerts there. */}
            <div
              className="pointer-events-auto flex min-h-0 flex-1 flex-col"
              inert={mobileOpen || undefined}
            >
              <MobileNav creators={creators} progress={progress} />
              {/* Opaque panel that covers the rail (the column's z-20 already
                  sits the whole column above both z-10 rails; keeps its own z-20
                  stacking context for route content). Rounds into the gutter —
                  desktop both left corners; mobile-open only the bottom-left (the
                  top bar owns the top-left, so the panel's top-left stays square
                  to butt flush under it). */}
              <div
                ref={panelRef}
                data-collapsed={collapsed}
                className={`group/panel relative z-20 min-h-0 flex-1 bg-background md:overflow-hidden md:rounded-l-3xl ${RAIL_ANIM} data-[collapsed=true]:md:rounded-l-none`}
              >
                {/* No scroll-fade here: this viewport wraps page content that
                    contains sticky frosted headers (creator/ticker bars,
                    bg-background/80 backdrop-blur). scroll-fade sets mask-image,
                    which makes the viewport a backdrop root — a descendant
                    backdrop-filter would then sample an empty backdrop and blur
                    nothing. The whole-page edge fade isn't worth losing the frost. */}
                <ScrollArea
                  id="main-scroll"
                  scrollRestorationId="main-scroll"
                  // Below md the window scrolls (matches main): both the ScrollArea
                  // root (base overflow-hidden) and viewport are forced overflow-visible
                  // so neither is a scroll container. Otherwise the root's overflow-hidden
                  // becomes #overview's nearest scrollport and the creator-bar reveal's
                  // view-timeline (scroll-driven, keyed to #overview's exit) reads a
                  // container that doesn't scroll → the bar only lands at page bottom.
                  className="max-md:!overflow-visible md:h-full"
                  viewportClassName="max-md:h-auto max-md:!overflow-visible"
                >
                  <Outlet />
                </ScrollArea>
              </div>
            </div>
          </div>

          {/* Mobile menu toggle — overlay at WRAPPER level (not the translating
              content column), so it slides between the top-bar slot (closed) and
              the rail header right (open). fixed so it tracks the sticky top bar on
              window scroll instead of scrolling away with the tall wrapper; z-50
              stays above the scrim so it's tappable while open. The hook writes the
              slide inline on toggleRef, riding the same progress as the panel so it
              tracks the drag + spring exactly (no separate CSS transition to desync). */}
          <div ref={toggleRef} className="fixed top-2.5 left-3 z-50 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-rail"
              onClick={mobileOpen ? closeMobile : openMobile}
            >
              {/* menu↔X crossfade on the drawer progress (stacked in one grid cell
                  so it never shifts layout), so the glyph morphs along the drag. */}
              <span className="inline-grid place-items-center text-[18px] leading-none">
                <motion.span
                  aria-hidden
                  className="icon-[lucide--menu] [grid-area:1/1]"
                  style={{ opacity: closedOpacity }}
                />
                <motion.span
                  aria-hidden
                  className="icon-[lucide--x] [grid-area:1/1]"
                  style={{ opacity: progress }}
                />
              </span>
            </Button>
          </div>

          {/* Faux bottom-left corner for the OPEN drawer (mobile). Closed stays
              full-bleed; open, the inset panel's left edge should read rounded
              like desktop's rounded-l inset — but below md the WINDOW is the
              scroller (URL-bar auto-hide, frosted-bar blur, the creator-bar
              view-timeline), so the panel is content-height and its real
              bottom-left corner sits below the fold. This fixed, click-through
              notch pins that corner to the viewport bottom: gutter-colored
              (currentColor = the wrapper's bg-zinc-100/dark:bg-zinc-950) with an
              inverse-radius gradient. The hook's paint() slides it with the panel
              (translateX(progress·W)) and fades it in with open progress;
              opacity-0 is the pre-JS closed baseline. The .t-corner-notch-top
              twin owns the top-left. */}
          <div
            ref={cornerRef}
            aria-hidden
            className="t-corner-notch text-zinc-100 opacity-0 md:hidden dark:text-zinc-950"
          />
          {/* Top-left twin — the frosted top bar's own rounded corner reveals
              scrolling content (faint), not the gutter, because the window scrolls
              under it. This opaque gutter notch paints the corner crisply over the
              bar, matching the bottom-left. Same paint() slide + open-fade. */}
          <div
            ref={cornerTopRef}
            aria-hidden
            className="t-corner-notch-top text-zinc-100 opacity-0 md:hidden dark:text-zinc-950"
          />
        </div>
      </HapticsProvider>
    </PreferencesProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-mono [overflow-wrap:anywhere] antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

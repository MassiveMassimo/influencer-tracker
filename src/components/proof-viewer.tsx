import { useRef } from "react";
import { X } from "lucide-react";
import { NavMenu } from "#/components/ui/nav-menu.tsx";
import { NavItem } from "#/components/ui/nav-item.tsx";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "#/components/ui/drawer.tsx";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";
import { ReportButton } from "#/components/report-button.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import { useSurface, SurfaceProvider } from "#/lib/surface-context.tsx";
import { surfaceClasses } from "#/lib/surface-classes.ts";
import { cn } from "#/lib/utils.ts";

// The viewer only reads these fields. `Call` (ticker page) satisfies it; so does a
// slim cross-creator `CallIndexEntry` (explore) — which has no `quote`, so the quote
// block is conditional. The embed itself shows the verbatim post, so a missing quote
// is no real loss.
export type ProofCall = {
  shortcode: string;
  ticker: string;
  postDate: string;
  summary?: string;
  quote?: string;
};

// Calls carry only a shortcode. X tweet ids are numeric snowflakes; IG reel
// codes are alphanumeric. Map each to its no-script iframe embed + canonical URL.
export function proof(shortcode: string) {
  const isTweet = /^\d+$/.test(shortcode);
  return isTweet
    ? {
        kind: "tweet" as const,
        embed: `https://platform.twitter.com/embed/Tweet.html?id=${shortcode}`,
        source: `https://x.com/i/status/${shortcode}`,
      }
    : {
        kind: "reel" as const,
        embed: `https://www.instagram.com/reel/${shortcode}/embed`,
        source: `https://www.instagram.com/reel/${shortcode}/`,
      };
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

export type SiblingCall = { ticker: string; company: string };

// Other scored tickers named in the same post. Links to each sibling's page for
// the same creator; `onNavigate` closes the viewer before the route switches.
function OtherCalls({
  siblings,
  handle,
  onNavigate,
}: {
  siblings: SiblingCall[];
  handle: string;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Other stocks in this post</Label>
      <ScrollArea
        className="rounded-lg border border-border/60"
        viewportClassName="max-h-72 scroll-fade"
      >
        <NavMenu
          activeSlug={null}
          radius="rounded-none"
          separated
          aria-label="Other stocks in this post"
        >
          {siblings.map((s, i) => (
            <NavItem
              key={s.ticker}
              index={i}
              slug={s.ticker}
              to="/t/$symbol/$creator"
              params={{ symbol: s.ticker, creator: handle }}
              onClick={onNavigate}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-heading">{s.ticker}</span>
                <span className="truncate text-xs text-muted-foreground">{s.company}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">↗</span>
            </NavItem>
          ))}
        </NavMenu>
      </ScrollArea>
    </div>
  );
}

// Shared body rendered inside both the desktop dialog and the mobile drawer.
// `handle` is threaded separately because the Call shape carries only a shortcode.
function ProofContent({
  call,
  handle,
  siblings,
  onNavigate,
}: {
  call: ProofCall;
  handle: string;
  siblings: SiblingCall[];
  onNavigate: () => void;
}) {
  const p = proof(call.shortcode);
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start">
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label>{p.kind === "tweet" ? "Tweet" : "Reel"} · proof</Label>
          <a
            href={p.source}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Open original ↗
          </a>
        </div>
        {call.summary && (
          <div className="space-y-1">
            <Label>What the post is about</Label>
            <p className="text-sm leading-relaxed text-foreground">{call.summary}</p>
          </div>
        )}
        {call.quote && (
          <div className="space-y-1">
            <Label>Quote</Label>
            <p className="text-sm leading-relaxed text-muted-foreground">“{call.quote}”</p>
          </div>
        )}
        {siblings.length > 0 && (
          <OtherCalls siblings={siblings} handle={handle} onNavigate={onNavigate} />
        )}
        <ReportButton handle={handle} shortcode={call.shortcode} ticker={call.ticker} />
      </div>
      <iframe
        src={p.embed}
        title={`Proof for ${call.ticker} call on ${call.postDate}`}
        loading="lazy"
        className="mx-auto block w-full max-w-[400px] shrink-0 rounded-xl border border-border/60 bg-background md:mx-0"
        style={{ height: p.kind === "tweet" ? 560 : 620 }}
      />
    </div>
  );
}

function Heading({ call }: { call: ProofCall }) {
  return (
    <>
      <span className="font-heading text-lg">{call.ticker}</span>
      <span className="ml-2 font-mono text-xs text-muted-foreground tabular-nums">
        {call.postDate}
      </span>
    </>
  );
}

// Row click opens this. Desktop → centered dialog; mobile → bottom drawer (vaul).
// `call` null means closed; both surfaces are controlled off the same state.
export function ProofViewer({
  call,
  handle,
  siblings,
  onClose,
}: {
  call: ProofCall | null;
  handle: string;
  siblings?: Record<string, SiblingCall[]>;
  onClose: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Dialog lifts +4 above its substrate (FF convention) and provides that level
  // to descendants, so a popover opened inside stays visible at the right depth.
  const dialogLevel = Math.min(useSurface() + 4, 8);
  const open = call != null;
  // Retain the last call's content through the close animation (same latch as
  // chart-markers' `lastActive`). `open` drives the exit transition, but the body
  // renders off `shown`, so it stays mounted and fades out intact instead of
  // flashing empty.
  const lastShown = useRef<{ call: ProofCall; handle: string; siblings: SiblingCall[] } | null>(
    null,
  );
  if (call) lastShown.current = { call, handle, siblings: siblings?.[call.shortcode] ?? [] };
  const shown = lastShown.current;

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup
            className={cn(
              "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              surfaceClasses(dialogLevel),
            )}
          >
            {shown && (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <Dialog.Title render={<h2 className="flex items-baseline" />}>
                    <Heading call={shown.call} />
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Proof media and context for the {shown.call.ticker} call.
                </Dialog.Description>
                <SurfaceProvider value={dialogLevel}>
                  <ProofContent
                    call={shown.call}
                    handle={shown.handle}
                    siblings={shown.siblings}
                    onNavigate={onClose}
                  />
                </SurfaceProvider>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className={cn("h-[92vh]", surfaceClasses(dialogLevel))}>
        {shown && (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="px-5 pt-2 pb-8">
            <div className="mb-4">
              <DrawerTitle asChild>
                <h2 className="flex items-baseline">
                  <Heading call={shown.call} />
                </h2>
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                Proof media and context for the {shown.call.ticker} call.
              </DrawerDescription>
            </div>
            <SurfaceProvider value={dialogLevel}>
              <ProofContent
                call={shown.call}
                handle={shown.handle}
                siblings={shown.siblings}
                onNavigate={onClose}
              />
            </SurfaceProvider>
          </ScrollArea>
        )}
      </DrawerContent>
    </Drawer>
  );
}

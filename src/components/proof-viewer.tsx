import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";
import { ReportButton } from "#/components/report-button.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import type { Call } from "#/lib/types.ts";

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
    <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
      {children}
    </div>
  );
}

// Shared body rendered inside both the desktop dialog and the mobile drawer.
// `handle` is threaded separately because the Call shape carries only a shortcode.
function ProofContent({ call, handle }: { call: Call; handle: string }) {
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
        <div className="space-y-1">
          <Label>Quote</Label>
          <p className="text-sm leading-relaxed text-muted-foreground">“{call.quote}”</p>
        </div>
        <ReportButton handle={handle} shortcode={call.shortcode} />
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

function Heading({ call }: { call: Call }) {
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
  onClose,
}: {
  call: Call | null;
  handle: string;
  onClose: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const open = call != null;

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-6 shadow-xl transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            {call && (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <Dialog.Title render={<h2 className="flex items-baseline" />}>
                    <Heading call={call} />
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Proof media and context for the {call.ticker} call.
                </Dialog.Description>
                <ProofContent call={call} handle={handle} />
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} shouldScaleBackground>
      <DrawerContent className="h-[92vh]">
        {call && (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="px-5 pt-2 pb-8">
            <div className="mb-4">
              <DrawerTitle asChild>
                <h2 className="flex items-baseline">
                  <Heading call={call} />
                </h2>
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                Proof media and context for the {call.ticker} call.
              </DrawerDescription>
            </div>
            <ProofContent call={call} handle={handle} />
          </ScrollArea>
        )}
      </DrawerContent>
    </Drawer>
  );
}

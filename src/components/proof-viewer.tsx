import { X } from "lucide-react";
import { Dialog, VisuallyHidden } from "radix-ui";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
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
function ProofContent({ call }: { call: Call }) {
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
export function ProofViewer({ call, onClose }: { call: Call | null; onClose: () => void }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const open = call != null;

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-6 shadow-xl duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            {call && (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <Dialog.Title asChild>
                    <h2 className="flex items-baseline">
                      <Heading call={call} />
                    </h2>
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <VisuallyHidden.Root>
                  <Dialog.Description>
                    Proof media and context for the {call.ticker} call.
                  </Dialog.Description>
                </VisuallyHidden.Root>
                <ProofContent call={call} />
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} shouldScaleBackground>
      <DrawerContent className="max-h-[92vh]">
        {call && (
          <div className="overflow-y-auto px-5 pt-2 pb-8">
            <div className="mb-4">
              <DrawerTitle asChild>
                <h2 className="flex items-baseline">
                  <Heading call={call} />
                </h2>
              </DrawerTitle>
              <VisuallyHidden.Root>
                <DrawerDescription>
                  Proof media and context for the {call.ticker} call.
                </DrawerDescription>
              </VisuallyHidden.Root>
            </div>
            <ProofContent call={call} />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

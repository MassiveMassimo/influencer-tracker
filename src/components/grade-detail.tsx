// src/components/grade-detail.tsx
// Wraps the GradeMedallion with an explainer surface: desktop hovers a small
// PreviewCard (score + nickname + "Read more" → full Dialog); mobile taps straight
// into a vaul Drawer. Same desktop-dialog / mobile-drawer split as ProofViewer.
import { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { GradeMedallion } from "#/components/grade-medallion";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "#/components/ui/drawer.tsx";
import { ScrollArea } from "#/components/ui/scroll-area.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import { useSurface, SurfaceProvider } from "#/lib/surface-context.tsx";
import { surfaceClasses } from "#/lib/surface-classes.ts";
import { cn } from "#/lib/utils.ts";
import { LETTER_MEANING, PERSONA_BLURB, type Grade } from "#/lib/grade";

const FRAUNCES = { fontVariationSettings: "'opsz' 144, 'wght' 900, 'SOFT' 100, 'WONK' 1" };

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
      {children}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
function Delta({ n }: { n: number }) {
  const r = Math.round(n);
  const cls = r > 0 ? "text-emerald-500" : r < 0 ? "text-rose-500" : "text-muted-foreground";
  return (
    <span className={`shrink-0 font-mono text-xs whitespace-nowrap tabular-nums ${cls}`}>
      {`${r >= 0 ? "+" : "−"}${Math.abs(r)} pts`}
    </span>
  );
}

// Big score + nickname + one-line blurb — shown in the hover card and reused atop
// the full breakdown.
export function GradeHead({ grade }: { grade: Grade }) {
  const score = Math.round(grade.score);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <span className="display-title text-4xl leading-[0.9]" style={FRAUNCES}>
          {grade.grade}
        </span>
        <div className="shrink-0 text-right">
          <Label>Score</Label>
          <div className="mt-0.5 font-mono text-sm text-foreground tabular-nums">
            {score}
            <span className="text-muted-foreground">/100</span>
          </div>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/80"
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {LETTER_MEANING[grade.letter]}
      </p>
      <div className="rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5">
        <div className="font-heading text-sm text-foreground">{grade.label}</div>
        {PERSONA_BLURB[grade.label] && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {PERSONA_BLURB[grade.label]}
          </p>
        )}
      </div>
    </div>
  );
}

// The score math — starts at 50 (C), then the two components move it.
function GradeBreakdown({ grade }: { grade: Grade }) {
  const d = grade.detail;
  return (
    <div className="space-y-3">
      <Label>How it's scored</Label>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Every creator starts at <span className="text-foreground">50 (C)</span> — matching SPY —
        then two things move it.
      </p>
      <div className="overflow-hidden rounded-xl border border-border/60 text-sm">
        <div className="flex items-baseline justify-between gap-3 bg-muted/40 px-3.5 py-2.5">
          <span className="text-muted-foreground">Baseline — matches SPY</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            50 pts
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border/50 px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-foreground">
              Hit rate <span className="tabular-nums">{pct(d.pooledHit)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              1m + 3m pooled · 50% = coin flip
            </div>
          </div>
          <Delta n={d.hitPoints} />
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border/50 px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-foreground">
              Avg excess <span className="tabular-nums">{signedPct(d.pooledExcess)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">vs SPY, per scored call</div>
          </div>
          <Delta n={d.excessPoints} />
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border/60 bg-muted/40 px-3.5 py-2.5">
          <span className="font-heading text-foreground">Composite score</span>
          <span className="shrink-0 font-heading text-foreground tabular-nums">
            {Math.round(grade.score)} <span className="text-muted-foreground">→</span> {grade.grade}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground/80">
        Based on <span className="tabular-nums">{d.scoredN}</span> scored calls.
      </p>
    </div>
  );
}

// The full breakdown Dialog (desktop). Shared by GradeDetail's desktop branch and
// IdentityMenu so the popup markup + a11y wiring live in one place.
export function GradeBreakdownDialog({
  grade,
  open,
  onOpenChange,
}: {
  grade: Grade;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Dialog lifts +4 above substrate (FF convention) + provides it to descendants.
  const dialogLevel = Math.min(useSurface() + 4, 8);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            surfaceClasses(dialogLevel),
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <Dialog.Title className="font-heading text-lg">Grade breakdown</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            How this creator's {grade.grade} grade was scored.
          </Dialog.Description>
          <SurfaceProvider value={dialogLevel}>
            <div className="space-y-5">
              <GradeHead grade={grade} />
              <GradeBreakdown grade={grade} />
            </div>
          </SurfaceProvider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GradeDetail({
  grade,
  fontSize,
  letterClassName,
  active = true,
}: {
  grade: Grade;
  fontSize?: string;
  letterClassName?: string;
  // The route mounts one instance in the header and one in the mobile grid cell
  // (only one visible at a time). `active` freezes the hidden instance's spin +
  // shimmer so the off-screen copy doesn't run ~30 infinite tweens per frame.
  active?: boolean;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  // Drawer (mobile dialog equivalent) lifts +4 + provides its level to descendants.
  const dialogLevel = Math.min(useSurface() + 4, 8);
  const medallion = (
    <GradeMedallion
      grade={grade}
      fontSize={fontSize}
      letterClassName={letterClassName}
      active={active}
    />
  );

  if (isDesktop) {
    return (
      <>
        <PreviewCard>
          <PreviewCardTrigger
            delay={0}
            render={
              <button
                type="button"
                aria-label={`Grade ${grade.grade} — ${grade.label}. Details`}
                className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpen(true)}
              />
            }
          >
            {medallion}
          </PreviewCardTrigger>
          <PreviewCardPopup className="flex-col gap-3">
            <GradeHead grade={grade} />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="self-start text-xs font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground"
            >
              Read more →
            </button>
          </PreviewCardPopup>
        </PreviewCard>
        <GradeBreakdownDialog grade={grade} open={open} onOpenChange={setOpen} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Grade ${grade.grade} — ${grade.label}. Details`}
        className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
      >
        {medallion}
      </button>
      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground>
        <DrawerContent className={cn("h-[80vh]", surfaceClasses(dialogLevel))}>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="px-5 pt-2 pb-8">
            <div className="mb-4">
              <DrawerTitle className="font-heading text-lg">Grade breakdown</DrawerTitle>
              <DrawerDescription className="sr-only">
                How this creator's {grade.grade} grade was scored.
              </DrawerDescription>
            </div>
            <SurfaceProvider value={dialogLevel}>
              <div className="space-y-5">
                <GradeHead grade={grade} />
                <GradeBreakdown grade={grade} />
              </div>
            </SurfaceProvider>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </>
  );
}

"use client";

// Desktop-only shared hover surface. The trait badges and the grade medallion live in
// ONE Base UI NavigationMenu, so a single popup morphs (size + position) as the pointer
// travels across triggers and never closes between them — triggers are padded, not
// gapped, so the pointer never leaves the menu. Mobile keeps the per-item
// PreviewCard/Drawer path (the route renders TraitBadges + GradeDetail there instead).
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NavigationMenu } from "@base-ui/react/navigation-menu";
import { GradeMedallion } from "#/components/grade-medallion";
import { GradeHead, GradeBreakdownDialog } from "#/components/grade-detail";
import { BadgeShape, TraitBlurb } from "#/components/trait-badges";
import { EASE_OUT } from "#/lib/ease.ts";
import type { Trait } from "#/lib/traits";
import type { Grade } from "#/lib/grade";

// Cross-navigation badge animation (same recipe as icon-swap): when the creator changes,
// the IdentityMenu persists (same /c/$handle route), so keying items by trait.id lets a
// shared badge slide to its new slot (layout) while badges the new creator lacks/gains
// blur-crossfade out/in. popLayout so survivors reflow immediately (no held slot).
// popLayout gives exiting badges position:absolute, resolved against the nearest
// non-static ancestor (motion.dev). That MUST be a full-width, left-stable frame — the
// Root below (relative w-full) — else a right-pinned shrink-to-content frame collapses
// leftward and drags the frozen exits across the medallion.
const BADGE_SWAP = { duration: 0.28, ease: EASE_OUT } as const;
const BADGE_HIDDEN = { scale: 0.4, opacity: 0, filter: "blur(3px)" };
const BADGE_SHOWN = { scale: 1, opacity: 1, filter: "blur(0px)" };

export function IdentityMenu({
  grade,
  traits,
  active,
}: {
  grade: Grade;
  traits: Trait[];
  // Freezes the medallion's spin + shimmer when this menu is off-screen (the header is
  // max-md:hidden, so on mobile it must not run its animations behind display:none).
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <NavigationMenu.Root
      orientation="horizontal"
      delay={0}
      closeDelay={50}
      // relative + w-full: the stable, full-width offset parent that catches the
      // popLayout-exited badges (see the badge-animation note above). justify-end keeps
      // the badges + medallion packed on the right.
      className="relative flex w-full min-w-0 justify-end"
    >
      <NavigationMenu.List className="flex min-w-0 items-center">
        {/* Plain flex row (no scroll area): the popLayout exit animates a badge to
            position:absolute, and any overflow/mask clip box crops it while the row
            shrinks. Badges max out at ~5 and the right zone is flex-1, so they fit
            without scrolling — overflow-visible lets the exit + hover glow breathe.
            py gives the glow vertical room; px spaces the badges (the padding IS the
            hit area, so adjacent triggers touch and the shared popup morphs). */}
        <div className="flex items-center px-2 py-4">
          <AnimatePresence initial={false} mode="popLayout">
            {traits.map((t) => (
              <NavigationMenu.Item
                key={t.id}
                value={t.id}
                render={
                  reduce ? (
                    <li />
                  ) : (
                    <motion.li
                      layout
                      initial={BADGE_HIDDEN}
                      animate={BADGE_SHOWN}
                      exit={BADGE_HIDDEN}
                      transition={BADGE_SWAP}
                    />
                  )
                }
              >
                <NavigationMenu.Trigger
                  aria-label={`Trait: ${t.name}`}
                  className="rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BadgeShape trait={t} size={44} />
                </NavigationMenu.Trigger>
                <NavigationMenu.Content className="t-nav-content flex w-64 flex-col p-4">
                  <TraitBlurb trait={t} />
                </NavigationMenu.Content>
              </NavigationMenu.Item>
            ))}
          </AnimatePresence>
        </div>

        <NavigationMenu.Item value="grade">
          {/* pl-0.5 → less padding toward the medallion than between badges. */}
          <NavigationMenu.Trigger
            aria-label={`Grade ${grade.grade} — ${grade.label}. Details`}
            onClick={() => setOpen(true)}
            className="rounded-full pl-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GradeMedallion grade={grade} active={active} />
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="t-nav-content flex w-72 flex-col p-4">
            <GradeHead grade={grade} />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 self-start text-xs font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground"
            >
              Read more →
            </button>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      <NavigationMenu.Portal>
        <NavigationMenu.Positioner
          className="t-nav-positioner z-50"
          sideOffset={10}
          align="center"
          collisionPadding={12}
        >
          <NavigationMenu.Popup className="t-nav-popup rounded-lg border bg-popover text-popover-foreground shadow-lg/5">
            <NavigationMenu.Viewport className="t-nav-viewport" />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>

      {/* Click the medallion → full grade breakdown (shared with GradeDetail). */}
      <GradeBreakdownDialog grade={grade} open={open} onOpenChange={setOpen} />
    </NavigationMenu.Root>
  );
}

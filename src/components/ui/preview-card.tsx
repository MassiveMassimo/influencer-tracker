"use client";

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import type React from "react";
import { cn } from "#/lib/utils.ts";
import { useSurface, SurfaceProvider } from "#/lib/surface-context.tsx";
import { surfaceClasses } from "#/lib/surface-classes.ts";

export const PreviewCard: typeof PreviewCardPrimitive.Root = PreviewCardPrimitive.Root;

export function PreviewCardTrigger({
  ...props
}: PreviewCardPrimitive.Trigger.Props): React.ReactElement {
  return <PreviewCardPrimitive.Trigger data-slot="preview-card-trigger" {...props} />;
}

export function PreviewCardPopup({
  className,
  children,
  align = "center",
  sideOffset = 4,
  anchor,
  portalProps,
  ...props
}: PreviewCardPrimitive.Popup.Props & {
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
  anchor?: PreviewCardPrimitive.Positioner.Props["anchor"];
  portalProps?: PreviewCardPrimitive.Portal.Props;
}): React.ReactElement {
  // Popover reads its substrate from context and lifts +2 (FF convention),
  // so it stays visible whether it opens on the page or inside a dialog.
  // Shadow is pinned to level 3 — bg tracks depth, shadow weight stays constant.
  const level = Math.min(useSurface() + 2, 8);
  return (
    <PreviewCardPrimitive.Portal {...portalProps}>
      <PreviewCardPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="z-50"
        data-slot="preview-card-positioner"
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            // FF-surface-pure: bg + ring + highlight + drop all come from
            // surfaceClasses. No manual border / before-highlight overlay.
            "relative flex w-64 origin-(--transform-origin) rounded-lg p-4 text-sm text-balance text-popover-foreground transition-[scale,opacity] data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            surfaceClasses(level, 3),
            className,
          )}
          data-slot="preview-card-content"
          {...props}
        >
          <SurfaceProvider value={level}>{children}</SurfaceProvider>
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export {
  PreviewCardPrimitive,
  PreviewCard as HoverCard,
  PreviewCardTrigger as HoverCardTrigger,
  PreviewCardPopup as HoverCardContent,
};

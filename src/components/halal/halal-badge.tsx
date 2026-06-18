"use client";

import { CircleQuestionMark } from "lucide-react";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";
import { badgeKindFor, type HalalInfo } from "#/lib/halal/types.ts";
import { HalalCardContent } from "./halal-card-content.tsx";

export function HalalBadge({ info }: { info: HalalInfo }) {
  const kind = badgeKindFor(info.status);
  if (kind === "halal") {
    return (
      <span
        role="img"
        aria-label="Shariah-compliant (Musaffa)"
        className="icon-[hugeicons--halal] size-[1.1em] text-emerald-500 align-[-0.15em]"
      />
    );
  }
  if (kind === "doubtful") {
    return (
      <CircleQuestionMark
        aria-label="Shariah compliance questionable (Musaffa)"
        className="size-[1.1em] text-amber-500 align-[-0.15em]"
      />
    );
  }
  return null;
}

export function HalalIndicator({ info }: { info: HalalInfo }) {
  if (badgeKindFor(info.status) === null) return null;
  return (
    <PreviewCard>
      {/* Badge + popup often sit inside a row-level <Link>; clicks bubble through the
          React tree (even from the portaled popup) to the row. Contain them at the two
          subtree roots — trigger and popup — so HalalCardContent stays Link-agnostic. */}
      <PreviewCardTrigger
        render={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex cursor-default items-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Halal compliance details"
          />
        }
      >
        <HalalBadge info={info} />
      </PreviewCardTrigger>
      <PreviewCardPopup
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl border border-border/60 bg-background p-3 shadow-lg"
      >
        <HalalCardContent info={info} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

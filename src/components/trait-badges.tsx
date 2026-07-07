// Trait badges: 0-N independently-earned behavioral signals next to the grade
// medallion. Each trait has its own SVG silhouette, a subtle same-hue gradient
// fill, and a filled icon; hover/tap opens a preview card with the blurb.
// Data layer: src/lib/traits.ts. Spec: docs/superpowers/specs/2026-07-08-*.md.
import { useMemo } from "react";
import type { Call } from "#/lib/types";
import { traitsFor, type Trait } from "#/lib/traits";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";

const VISIBLE = 3;

// 12-scallop award-seal silhouette, generated once (deterministic).
const ROSETTE = (() => {
  const n = 12;
  const r = 9.6;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)] as const;
  });
  const chord = 2 * r * Math.sin(Math.PI / n);
  const bump = ((chord / 2) * 1.25).toFixed(2);
  return (
    `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}` +
    pts
      .map((_, i) => {
        const [x, y] = pts[(i + 1) % n];
        return `A${bump} ${bump} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join("") +
    "Z"
  );
})();

// 24x24 silhouettes. `ticket` is the user-supplied side-notched stub (spec).
const SHAPES: Record<Trait["shape"], string> = {
  hexagon: "M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z",
  "triangle-down": "M3 4h18a1 1 0 0 1 .86 1.5l-9 15.6a1 1 0 0 1-1.73 0l-9-15.6A1 1 0 0 1 3 4z",
  ticket:
    "M19 4C19.7956 4 20.5585 4.3163 21.1211 4.87891C21.6837 5.44152 22 6.20435 22 7V10C22 10.2449 21.9098 10.481 21.7471 10.6641C21.5843 10.8471 21.3604 10.9645 21.1172 10.9932L21 11C20.7452 11.0003 20.4998 11.0976 20.3145 11.2725C20.1291 11.4474 20.0179 11.687 20.0029 11.9414C19.988 12.1958 20.0708 12.4462 20.2344 12.6416C20.3979 12.837 20.6298 12.963 20.8828 12.9932L21 13C21.2652 13 21.5195 13.1054 21.707 13.293C21.8946 13.4805 22 13.7348 22 14V17C22 17.7956 21.6837 18.5585 21.1211 19.1211C20.5585 19.6837 19.7956 20 19 20H5C4.20435 20 3.44152 19.6837 2.87891 19.1211C2.3163 18.5585 2 17.7956 2 17V14C2.00003 13.7551 2.09021 13.519 2.25293 13.3359C2.41565 13.1529 2.63963 13.0355 2.88281 13.0068L3 13C3.25483 12.9997 3.50022 12.9024 3.68555 12.7275C3.87088 12.5526 3.98213 12.313 3.99707 12.0586C4.012 11.8042 3.92917 11.5538 3.76563 11.3584C3.60207 11.163 3.37022 11.037 3.11719 11.0068L3 11C2.73478 11 2.48051 10.8946 2.29297 10.707C2.10543 10.5195 2 10.2652 2 10V7C1.9995 6.25172 2.27948 5.52999 2.78418 4.97754C3.28876 4.42542 3.98162 4.08168 4.72656 4.01465L4.94922 4.00098L19 4Z",
  shield: "M12 2l8 3.2V11c0 4.9-3.4 8.5-8 10.8C7.4 19.5 4 15.9 4 11V5.2L12 2z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.45 4.73L5.82 21 12 17.27z",
  rosette: ROSETTE,
};

// Full literal class strings (Tailwind purges interpolated names). `v` is the
// Tailwind v4 color custom property driving the SVG gradient stops.
const HUES: Record<Trait["hue"], { icon: string; v: string }> = {
  orange: { icon: "text-orange-600 dark:text-orange-400", v: "--color-orange-500" },
  red: { icon: "text-red-600 dark:text-red-400", v: "--color-red-500" },
  violet: { icon: "text-violet-600 dark:text-violet-400", v: "--color-violet-500" },
  amber: { icon: "text-amber-600 dark:text-amber-400", v: "--color-amber-500" },
  emerald: { icon: "text-emerald-600 dark:text-emerald-400", v: "--color-emerald-500" },
  rose: { icon: "text-rose-600 dark:text-rose-400", v: "--color-rose-500" },
  teal: { icon: "text-teal-600 dark:text-teal-400", v: "--color-teal-500" },
  fuchsia: { icon: "text-fuchsia-600 dark:text-fuchsia-400", v: "--color-fuchsia-500" },
};

function BadgeShape({ trait }: { trait: Trait }) {
  const hue = HUES[trait.hue];
  // Gradient ids collide across the desktop-header and mobile-cell instances
  // (both mounted, CSS-hidden) — harmless: same hue resolves either way.
  const gid = `tb-${trait.id}`;
  return (
    <span className="relative grid size-8 place-items-center">
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`var(${hue.v})`} stopOpacity="0.28" />
            <stop offset="1" stopColor={`var(${hue.v})`} stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <path
          d={SHAPES[trait.shape]}
          fill={`url(#${gid})`}
          stroke={`var(${hue.v})`}
          strokeOpacity="0.3"
          strokeWidth="1"
        />
      </svg>
      <span
        className={`${trait.icon} relative text-[13px] ${hue.icon} ${trait.shape === "triangle-down" ? "-translate-y-0.5" : ""}`}
      />
    </span>
  );
}

function TraitBlurb({ trait }: { trait: Trait }) {
  return (
    <div className="flex items-start gap-2.5">
      <BadgeShape trait={trait} />
      <div className="min-w-0">
        <div className="font-heading text-sm text-foreground">{trait.name}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{trait.blurb}</p>
      </div>
    </div>
  );
}

function Badge({ trait }: { trait: Trait }) {
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={0}
        render={
          <button
            type="button"
            aria-label={`Trait: ${trait.name}`}
            className="cursor-default rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <BadgeShape trait={trait} />
      </PreviewCardTrigger>
      <PreviewCardPopup className="w-64 flex-col">
        <TraitBlurb trait={trait} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

export function TraitBadges({ calls, className }: { calls: Call[]; className?: string }) {
  const traits = useMemo(() => traitsFor(calls), [calls]);
  if (!traits.length) return null;
  const shown = traits.slice(0, VISIBLE);
  const rest = traits.slice(VISIBLE);
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      {shown.map((t) => (
        <Badge key={t.id} trait={t} />
      ))}
      {rest.length > 0 && (
        <PreviewCard>
          <PreviewCardTrigger
            delay={0}
            render={
              <button
                type="button"
                aria-label={`${rest.length} more traits`}
                className="cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <span className="grid size-8 place-items-center rounded-full border border-border/60 bg-muted/40 font-mono text-[10px] text-muted-foreground">
              +{rest.length}
            </span>
          </PreviewCardTrigger>
          <PreviewCardPopup className="w-64 flex-col gap-3">
            {rest.map((t) => (
              <TraitBlurb key={t.id} trait={t} />
            ))}
          </PreviewCardPopup>
        </PreviewCard>
      )}
    </div>
  );
}

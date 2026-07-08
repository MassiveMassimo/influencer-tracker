// Trait badges: 0-N independently-earned behavioral signals next to the grade
// medallion. Each trait has its own bg shape (an iconify icon used as a mask over a
// same-hue gradient) with a filled icon on top; hover/tap opens a preview card.
// Data layer: src/lib/traits.ts. Spec: docs/superpowers/specs/2026-07-08-*.md.
import { type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { type Trait } from "#/lib/traits";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";

const VISIBLE = 3;

// Bg shape = an iconify icon used as a mask; the same-hue gradient paints through it
// (like bg-clip-text, but mask-image instead of background-clip). The @iconify/tailwind4
// plugin supplies the mask via these literal `icon-[…]` classes.
const SHAPE_ICON: Record<Trait["shape"], string> = {
  hexagon: "icon-[tabler--hexagon-filled]",
  ticket: "icon-[ri--ticket-fill]",
  shield: "icon-[solar--shield-minimalistic-bold]",
  rosette: "icon-[tabler--rosette-filled]",
  star: "icon-[material-symbols--kid-star]",
};

// OKLCH anchor per hue = the Tailwind -500 stop (each hue's vibrant peak: L% C H).
// The fill ramps lightness around this at FIXED hue+chroma, so every badge is a clean
// light→dark shade of ONE color. Ramping the palette instead (300→600) drifted the hue
// (amber slid yellow→orange) and interpolating in sRGB muddied the middle — both gone.
const HUE_OKLCH: Record<Trait["hue"], { l: number; c: number; h: number }> = {
  red: { l: 63.7, c: 0.237, h: 25.331 },
  orange: { l: 70.5, c: 0.213, h: 47.604 },
  amber: { l: 76.9, c: 0.188, h: 70.08 },
  emerald: { l: 69.6, c: 0.17, h: 162.48 },
  teal: { l: 70.4, c: 0.14, h: 182.503 },
  violet: { l: 60.6, c: 0.25, h: 292.717 },
  fuchsia: { l: 66.7, c: 0.295, h: 322.15 },
  rose: { l: 64.5, c: 0.246, h: 16.439 },
};

const DL = 13; // lightness swing around the anchor (± = lighter top, darker bottom)
const oklchStr = (l: number, c: number, h: number) =>
  `oklch(${l.toFixed(1)}% ${c.toFixed(3)} ${h})`;

// Rim: a duplicate of the shape mask, scaled up and filled with a deep solid stop, sitting
// behind the fill so it peeks out as a shape-following outline. Cheap (no filter — the
// drop-shadow approach was correct but 12 chained shadows/badge hammered the GPU). A box
// `ring` would trace the square; scaling the mask traces the actual silhouette. Trade-off:
// uniform scale from center = slightly uneven width on spiky shapes (star tips), accepted.
// Theme-aware via CSS light-dark() (color-scheme is set on <html> by the theme init
// script): a lighter rim in light mode, the deep rim in dark mode.
const rimColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return `light-dark(${oklchStr(l - 12, c, h)}, ${oklchStr(l - 23, c, h)})`;
};

// Dark-mode drop-shadow is a colored glow of the hue (styles.css .dark .t-tilt reads
// --glow) instead of the neutral shadow used in light mode. ~30% alpha, like rose-500/30.
const glowColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return `oklch(${l.toFixed(1)}% ${c.toFixed(3)} ${h} / 0.3)`;
};

// Light top → deep vibrant bottom. Chroma is tapered at the light end (×0.8) — lighter
// tints are naturally less chromatic (mirrors the palette), and it keeps wide-gamut hues
// (violet/fuchsia) inside sRGB instead of being clamped to a dull grey.
const gradientFill = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return `linear-gradient(to bottom, ${oklchStr(l + DL, c * 0.8, h)}, ${oklchStr(l - DL, c, h)})`;
};

// The rim/glow/gradient strings depend only on hue (8 values), so resolve them once at
// module load instead of rebuilding them on every BadgeShape render (badges re-render on
// any parent update, e.g. the grade dialog toggling).
const HUE_STYLE = Object.fromEntries(
  (Object.keys(HUE_OKLCH) as Trait["hue"][]).map((hue) => [
    hue,
    { rim: rimColor(hue), glow: glowColor(hue), gradient: gradientFill(hue) },
  ]),
) as Record<Trait["hue"], { rim: string; glow: string; gradient: string }>;

// Pointer-tracked 3D tilt (Transitions.dev card-tilt pattern, scaled to the badge):
// write the four --tilt-* vars on the flat outer .t-tilt and toggle is-tilting/is-hover.
function tiltMove(e: RPointerEvent<HTMLSpanElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  const MAX = 20; // deg
  el.style.setProperty("--tilt-ry", `${(px - 0.5) * 2 * MAX}deg`);
  el.style.setProperty("--tilt-rx", `${(0.5 - py) * 2 * MAX}deg`);
  el.style.setProperty("--tilt-gx", `${px * 100}%`);
  el.style.setProperty("--tilt-gy", `${py * 100}%`);
  el.classList.add("is-tilting", "is-hover");
}
function tiltLeave(e: RPointerEvent<HTMLSpanElement>) {
  const el = e.currentTarget;
  el.classList.remove("is-tilting", "is-hover");
  el.style.setProperty("--tilt-rx", "0deg");
  el.style.setProperty("--tilt-ry", "0deg");
}

export function BadgeShape({ trait, size = 32 }: { trait: Trait; size?: number }) {
  const style = HUE_STYLE[trait.hue];
  return (
    <span
      className="t-tilt relative grid shrink-0 place-items-center"
      style={{ width: size, height: size, "--glow": style.glow } as CSSProperties}
      onPointerMove={tiltMove}
      onPointerLeave={tiltLeave}
    >
      <span className="t-tilt-card grid size-full place-items-center">
        {/* Rim: scaled-up duplicate of the shape mask, deep solid stop, behind the fill. */}
        <span
          aria-hidden
          className={`${SHAPE_ICON[trait.shape]} absolute inset-0 scale-[1.14]`}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: style.rim,
          }}
        />
        {/* Fill: the shape icon masks a same-hue gradient (transparent bg-color so only
            the gradient shows through; inline styles beat the plugin's currentColor). */}
        <span
          aria-hidden
          className={`${SHAPE_ICON[trait.shape]} absolute inset-0`}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "transparent",
            backgroundImage: style.gradient,
          }}
        />
        {/* Icon: white→white/70 gradient clipped by the icon mask. text-transparent
            zeroes the plugin's currentColor fill so only the gradient shows. Icon
            scales with the badge (≈0.4 of the box, matching the 13px-in-32px default). */}
        <span
          className={`${trait.icon} relative bg-linear-to-b from-white to-white/70 text-transparent`}
          style={{ fontSize: size * 0.4 }}
        />
        {/* Glare: radial sheen (from .t-tilt-glare) masked to the icon shape; screen-
            blends and tracks the pointer via --tilt-gx/gy. */}
        <span
          aria-hidden
          className={`${SHAPE_ICON[trait.shape]} t-tilt-glare absolute inset-0`}
          style={{ width: "100%", height: "100%", backgroundColor: "transparent" }}
        />
      </span>
    </span>
  );
}

export function TraitBlurb({ trait }: { trait: Trait }) {
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

// NOTE: no stopPropagation on the trigger — the v1 mounts (creator-overview header
// + mobile grid cell) are not inside a linked row. If badges are ever reused inside a
// <Link> (e.g. an explore row), add it like HalalIndicator does or the row navigates.
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

// Takes the already-computed traits (the route memoizes `traitsFor(ds.calls)` once and
// shares it with the header IdentityMenu) rather than recomputing from `calls` here.
export function TraitBadges({ traits, className }: { traits: Trait[]; className?: string }) {
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

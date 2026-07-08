// Trait badges: 0-N independently-earned behavioral signals next to the grade
// medallion. Each trait has its own bg shape (a gradient-filled inline SVG path with an
// outer vector stroke) and a filled icon on top; hover/tap opens a preview card.
// Data layer: src/lib/traits.ts. Spec: docs/superpowers/specs/2026-07-08-*.md.
import { type CSSProperties, type PointerEvent as RPointerEvent, useId } from "react";
import { type Trait } from "#/lib/traits";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";

const VISIBLE = 3;

// Bg shape as a real inline SVG path (24×24 viewBox), so we can vector-stroke the exact
// silhouette (sharp tips, uniform width) instead of faking a border on a mask. Vendored
// verbatim from @iconify/json (dev-only) — see the SHAPE_ICON sources below for provenance;
// rosette gets a trailing `z` the source omits, so the stroke closes cleanly.
const SHAPE_PATH: Record<Trait["shape"], string> = {
  hexagon:
    "M10.425 1.414L3.65 5.41A3.21 3.21 0 0 0 2 8.217v7.285a3.23 3.23 0 0 0 1.678 2.826l6.695 4.237c1.034.57 2.22.57 3.2.032l6.804-4.302c.98-.537 1.623-1.618 1.623-2.793V8.218l-.005-.204a3.22 3.22 0 0 0-1.284-2.39l-.107-.075l-.007-.007a1 1 0 0 0-.181-.133L13.64 1.414a3.33 3.33 0 0 0-3.216 0z",
  ticket:
    "M20.75 5c.69 0 1.25.56 1.25 1.25v2.259a.75.75 0 0 1-.697.748a2.75 2.75 0 0 0 0 5.486a.75.75 0 0 1 .697.748v2.259c0 .69-.56 1.25-1.25 1.25H3.25C2.56 19 2 18.44 2 17.75v-2.259a.75.75 0 0 1 .697-.748a2.75 2.75 0 0 0 0-5.486A.75.75 0 0 1 2 8.509V6.25C2 5.56 2.56 5 3.25 5h17.5z",
  shield:
    "M3 10.417c0-3.198 0-4.797.378-5.335c.377-.537 1.88-1.052 4.887-2.081l.573-.196C10.405 2.268 11.188 2 12 2s1.595.268 3.162.805l.573.196c3.007 1.029 4.51 1.544 4.887 2.081C21 5.62 21 7.22 21 10.417v1.574c0 5.638-4.239 8.375-6.899 9.536C13.38 21.842 13.02 22 12 22s-1.38-.158-2.101-.473C7.239 20.365 3 17.63 3 11.991z",
  rosette:
    "M12.01 2.011a3.2 3.2 0 0 1 2.113.797l.154.145l.698.698a1.2 1.2 0 0 0 .71.341L15.82 4h1a3.2 3.2 0 0 1 3.195 3.018l.005.182v1c0 .27.092.533.258.743l.09.1l.697.698a3.2 3.2 0 0 1 .147 4.382l-.145.154l-.698.698a1.2 1.2 0 0 0-.341.71l-.008.135v1a3.2 3.2 0 0 1-3.018 3.195l-.182.005h-1a1.2 1.2 0 0 0-.743.258l-.1.09l-.698.697a3.2 3.2 0 0 1-4.382.147l-.154-.145l-.698-.698a1.2 1.2 0 0 0-.71-.341L8.2 20.02h-1a3.2 3.2 0 0 1-3.195-3.018L4 16.82v-1a1.2 1.2 0 0 0-.258-.743l-.09-.1l-.697-.698a3.2 3.2 0 0 1-.147-4.382l.145-.154l.698-.698a1.2 1.2 0 0 0 .341-.71L4 8.2v-1l.005-.182a3.2 3.2 0 0 1 3.013-3.013L7.2 4h1a1.2 1.2 0 0 0 .743-.258l.1-.09l.698-.697a3.2 3.2 0 0 1 2.269-.944z",
  star: "m7.625 6.4l2.8-3.625q.3-.4.713-.587T12 2t.863.188t.712.587l2.8 3.625l4.25 1.425q.65.2 1.025.738t.375 1.187q0 .3-.088.6t-.287.575l-2.75 3.9l.1 4.1q.025.875-.575 1.475t-1.4.6q-.05 0-.55-.075L12 19.675l-4.475 1.25q-.125.05-.275.063T6.975 21q-.8 0-1.4-.6T5 18.925l.1-4.125l-2.725-3.875q-.2-.275-.288-.575T2 9.75q0-.625.363-1.162t1.012-.763z",
};

// Glare still masks to the shape via the @iconify/tailwind4 plugin's literal `icon-[…]`
// classes (mask-image). Also the provenance of the SHAPE_PATH data above.
const SHAPE_ICON: Record<Trait["shape"], string> = {
  hexagon: "icon-[tabler--hexagon-filled]",
  ticket: "icon-[fluent--ticket-24-filled]",
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
const oklchStr = (l: number, c: number, h: number, a?: number) =>
  `oklch(${l.toFixed(1)}% ${c.toFixed(3)} ${h}${a === undefined ? "" : ` / ${a}`})`;

// Two-stop gradient endpoints (top→bottom), shared by the fill + halo layers.
type Stops = { top: string; bot: string };

// Rim: the crisp THIN-px inner border, a vector stroke on the shape path (paint-order
// stroke, so it sits just outside the fill and hugs the silhouette exactly — star tips
// included). Theme-aware via CSS light-dark() (color-scheme is set on <html> by the theme
// init script): a lighter rim in light mode, the deep rim in dark mode.
const rimColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return `light-dark(${oklchStr(l - 12, c, h)}, ${oklchStr(l - 23, c, h)})`;
};

// Dark-mode drop-shadow is a colored glow of the hue (styles.css .dark .t-tilt reads
// --glow) instead of the neutral shadow used in light mode. ~30% alpha, like rose-500/30.
const glowColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return oklchStr(l, c, h, 0.3);
};

// Fill gradient stops (top→bottom): light top, deep vibrant bottom. Chroma is tapered at
// the light end (×0.8) — lighter tints are naturally less chromatic (mirrors the palette),
// and it keeps wide-gamut hues (violet/fuchsia) inside sRGB instead of a dull grey.
const fillStops = (hue: Trait["hue"]): Stops => {
  const { l, c, h } = HUE_OKLCH[hue];
  return { top: oklchStr(l + DL, c * 0.8, h), bot: oklchStr(l - DL, c, h) };
};

// Faded halo gradient stops for the thick outer glow. Theme-aware, each stop a light-dark()
// so the browser swaps by color-scheme. The fade lives in the stop ALPHA (not a path-wide
// opacity) so each mode can carry its own curve:
//   • light — a light tint fading in place: top ≈ shade 300 → bottom ≈ shade 50, both at
//     ~0.35 alpha (a soft, uniform wash of the light tints).
//   • dark  — one dark shade fading OUT: top = shade 950 @ full → bottom = shade 950 @ 0.2
//     (i.e. from-<hue>-950 to-<hue>-950/20).
// Shade L/C values map to the Tailwind v4 OKLCH palette.
const haloStops = (hue: Trait["hue"]): Stops => {
  const { c, h } = HUE_OKLCH[hue];
  const ld = (lightL: number, lightC: number, lightA: number, darkA: number) =>
    `light-dark(${oklchStr(lightL, lightC, h, lightA)}, ${oklchStr(40, c * 0.6, h, darkA)})`; // dark = shade 950
  return {
    top: ld(81, c * 0.48, 0.35, 0.5), // light shade ~300 @.35 / dark 950 @.5
    bot: ld(97, c * 0.06, 0.35, 0.1), // light shade ~50  @.35 / dark 950 @.1
  };
};

// The rim/glow/gradient strings depend only on hue (8 values), so resolve them once at
// module load instead of rebuilding them on every BadgeShape render (badges re-render on
// any parent update, e.g. the grade dialog toggling).
type HueStyle = { rim: string; glow: string; fill: Stops; halo: Stops };
const HUE_STYLE = Object.fromEntries(
  (Object.keys(HUE_OKLCH) as Trait["hue"][]).map((hue) => [
    hue,
    {
      rim: rimColor(hue),
      glow: glowColor(hue),
      fill: fillStops(hue),
      halo: haloStops(hue),
    },
  ]),
) as Record<Trait["hue"], HueStyle>;

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

// Outer-border widths in px, constant across badge sizes via non-scaling-stroke (the
// 1px/5px spec is literal, not scaled). Each stroke is drawn double-width and the opaque
// fill on top covers its inner half, so THIN/HALO is the amount that shows OUTSIDE the edge.
const THIN = 1; // crisp inner rim, on top
const HALO = 5; // faded gradient glow behind → ~HALO-THIN px shows past the rim (≈4px)

// One shape layer: a gradient-filled/stroked 24×24 path. Both the halo and the fill+rim
// layers are the same SVG scaffold (viewBox, non-scaling round-join stroke, 2-stop vertical
// gradient), differing only in colors/width/paint-order — so they share this, kept in sync.
function ShapeSvg({
  shape,
  gid,
  stops,
  fill,
  stroke,
  strokeWidth,
  paintOrderStroke = false,
  className = "",
}: {
  shape: Trait["shape"];
  gid: string;
  stops: Stops;
  fill: string;
  stroke: string;
  strokeWidth: number;
  paintOrderStroke?: boolean; // draw the stroke outside the fill (crisp outer rim)
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`absolute inset-0 size-full overflow-visible ${className}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stops.top} />
          <stop offset="100%" stopColor={stops.bot} />
        </linearGradient>
      </defs>
      <path
        d={SHAPE_PATH[shape]}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={paintOrderStroke ? { paintOrder: "stroke" } : undefined}
      />
    </svg>
  );
}

export function BadgeShape({ trait, size = 32 }: { trait: Trait; size?: number }) {
  const style = HUE_STYLE[trait.hue];
  // Unique gradient ids per instance — the same trait renders at two sizes on one page
  // (header 44, overview 32); shared ids would make both reuse the first def.
  const uid = useId().replace(/:/g, "");
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      {/* Static halo — deliberately OUTSIDE .t-tilt, so the hover scale + 3D tilt don't move
          it: the badge lifts and tilts over a fixed glow. A wide faded stroke; the opaque
          fill on the tilt layer covers its inner half, leaving ~HALO px of glow outside the
          shape edge (~HALO-THIN px past the crisp rim). */}
      <ShapeSvg
        shape={trait.shape}
        gid={`h-${uid}`}
        stops={style.halo}
        fill="none"
        stroke={`url(#h-${uid})`}
        strokeWidth={HALO * 2}
        className="pointer-events-none"
      />
      <span
        className="t-tilt relative grid size-full place-items-center"
        style={{ "--glow": style.glow } as CSSProperties}
        onPointerMove={tiltMove}
        onPointerLeave={tiltLeave}
      >
        <span className="t-tilt-card grid size-full place-items-center">
          {/* Shape fill + crisp THIN-px rim (paint-order: stroke so the rim hugs the
              silhouette just outside the fill). This layer scales + tilts on hover; the
              halo behind it stays put. */}
          <ShapeSvg
            shape={trait.shape}
            gid={`f-${uid}`}
            stops={style.fill}
            fill={`url(#f-${uid})`}
            stroke={style.rim}
            strokeWidth={THIN * 2}
            paintOrderStroke
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
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: "transparent",
            }}
          />
        </span>
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

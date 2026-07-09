// Trait badges: 0-N independently-earned behavioral signals next to the grade
// medallion. Each trait has its own bg shape rendered as an enamel pin — a gold metal
// rim with saturated enamel fill and glassy gloss — plus a dark-gold icon on top.
// Hover/tap opens a preview card. Data layer: src/lib/traits.ts.
import {
  type CSSProperties,
  type PointerEvent as RPointerEvent,
  type ReactNode,
  useId,
} from "react";
import { type Trait } from "#/lib/traits";
import { type BadgeStyle } from "#/lib/preferences.tsx";
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

// Inline SVG icon bodies (vendored from @iconify/json), keyed by the Trait.icon string.
// Real SVG paths give the emboss drop-shadow actual alpha to follow — the Iconify
// mask-image approach doesn't produce alpha that filter: drop-shadow can read.
const ICON_SVG: Record<string, { body: string; viewBox?: string }> = {
  "icon-[tabler--target-arrow]": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M12 7a5 5 0 1 0 5 5"/><path d="M13 3.055A9 9 0 1 0 20.941 11"/><path d="M15 6v3h3l3-3h-3V3zm0 3l-3 3"/></g>',
  },
  "icon-[tabler--compass-off]": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m13 9l3-1l-1 3m-1 3l-6 2l2-6"/><path d="M20.042 16.045A9 9 0 0 0 7.955 3.958M5.637 5.635a9 9 0 1 0 12.725 12.73M12 3v2m0 14v2m-9-9h2m14 0h2M3 3l18 18"/></g>',
  },
  "icon-[local--bull]": {
    body: '<path fill="currentColor" d="M604 432.8c-18.8 11-46 30.7-68.2 49.4a594 594 0 0 0-61.8 62.3c-29.4 36.8-49.7 75.6-58.6 112-8.5 35.1-7 74.5 4.2 105.7 18.3 50.9 66.8 93.1 136.2 118.7 39.9 14.7 87.6 24.6 151.5 31.6 14.3 1.5 17.7 2.5 17.7 5.1 0 .8-3 4.5-6.8 8.2a74 74 0 0 1-29 17.4c-5.6 1.2-7.3 1.1-26.7-2.8a269 269 0 0 0-60.3-1 224 224 0 0 0-71.8 23.5c-30.2 15.7-63.4 41.8-63.4 49.9 0 4.5 4.7 10 15.7 18.4 30.1 23.1 56.8 36.2 85.6 42 15.7 3.2 43.4 3.2 58.4 0 25-5.4 48.3-16.7 75.6-36.8 3.2-2.3 4.1-2.6 6.2-1.6 3.3 1.5 4.1 5.2 6 27.2a863 863 0 0 0 9.1 73.5c6.9 41.6 13.9 66.1 25.4 89.3 9.8 19.6 17.5 30.8 49.8 72.2 17.5 22.4 27.6 39.5 33.1 56.4 6.5 19.6 9.9 37.4 10.8 55.6.5 12.1.4 13.1-3.6 30.5-6.4 28.3-7.1 36.4-5.1 59.5 2.1 22.5 7.6 37.4 18 47.9a57 57 0 0 0 27.1 14.7c15 4.2 17.6 6 27.5 19.1 16.5 21.8 32.8 32.6 55.9 37 7 1.4 11 1.4 32.8.3 17.4-.9 30.7-1 44.5-.4 41.5 1.9 50.4 1.1 66-6.2 14.3-6.5 25.3-16.2 37.6-33a57 57 0 0 1 9.2-10.3c1.8-1.2 8.3-3.8 14.6-5.8 15.4-4.8 22.1-8.4 29.3-15.7 13.1-13.2 18.5-32.1 18.5-64.6 0-13.9-1.2-22.5-6.2-44l-4-17.5 1.1-13.5c1.4-16.1 6-40 10.2-52.5 7-20.8 14.6-33.3 40.4-66.5 26.3-33.8 36.4-49 45.1-67.6 15-32 24.9-80 31.9-154.9 2-21.3 2.8-26.4 4.3-28.5 1.1-1.4 2.5-2.6 3.3-2.8 1.5-.2 2.1.1 18.4 11.4a221 221 0 0 0 44.8 22.9c17.1 5.6 25.7 6.9 46.7 6.9 16.4 0 21.1-.3 29.7-2.2 28.3-6.1 53.4-18.3 81.5-39.4 19.4-14.6 22.1-19.4 15.6-27.6-9.4-11.8-40.9-34.2-64.3-45.7a201 201 0 0 0-94-22.5c-17.3 0-25.3.8-42.7 4.2-13.3 2.6-17 2.1-29.1-3.9-7-3.6-10.9-6.3-16.4-11.9-7.3-7.2-9-10.8-5.5-11.8.9-.3 11.8-1.7 24.2-3.1 78-8.8 134.3-23.6 180.5-47.4 81.2-41.8 117.5-106.6 105.9-189.1-11.3-80-78-167.8-176.5-232.3-17.8-11.7-21.8-13.7-26.7-13.7a15 15 0 0 0-11.9 7c-.7 1.4-1.3 4.9-1.3 7.7 0 5.1.3 5.7 9.3 17.5 77.5 102.3 104.4 174.2 83.2 222.5-12.2 27.6-42.9 48.6-86.9 59.4-39 9.5-99.1 11.4-151.6 4.8-12.6-1.6-14-2.2-20.8-9.8-11.4-12.7-19.3-16.5-47.6-22.6a792 792 0 0 0-164.6-17.2 945 945 0 0 0-134.5 6.3 679 679 0 0 0-86 16.5 60 60 0 0 0-25.8 17.7c-5.1 6.8-6.7 7.4-23.8 9.6a482 482 0 0 1-116.4 0c-65.1-8.2-107.1-32.8-120.8-70.9-11.5-32-1.4-77.3 29.4-132.3a674 674 0 0 1 51.6-78.4c6.9-9.2 12.9-18.3 13.4-20.3 1.2-4.4-.3-10.4-3.3-13.2-6.2-5.6-11.8-5.8-20.8-.5"/>',
    viewBox: "307.6 311.4 1439.7 1439.7",
  },
  "icon-[tabler--arrow-big-up-line]": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12H5.414a1 1 0 0 1-.707-1.707l6.586-6.586a1 1 0 0 1 1.414 0l6.586 6.586A1 1 0 0 1 18.586 12H15v6H9zm0 9h6"/>',
  },
  "icon-[tabler--arrow-big-down-line]": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12h3.586a1 1 0 0 1 .707 1.707l-6.586 6.586a1 1 0 0 1-1.414 0l-6.586-6.586A1 1 0 0 1 5.414 12H9V6h6zm0-9H9"/>',
  },
  "icon-[tabler--dice-6]": {
    body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path fill="currentColor" d="M8 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m7 0a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0M8 12a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m7 0a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m0 4.5a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0m-7 0a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0"/></g>',
  },
  "icon-[tabler--flame]": {
    body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10.941c2.333-3.308.167-7.823-1-8.941c0 3.395-2.235 5.299-3.667 6.706C5.903 10.114 5 12 5 14.294C5 17.998 8.134 21 12 21s7-3.002 7-6.706c0-1.712-1.232-4.403-2.333-5.588c-2.084 3.353-3.257 3.353-4.667 2.235"/>',
  },
};

// Renders a trait icon as inline SVG with an emboss (white top-left, black bottom-right)
// that follows the icon shape — only possible with real SVG paths, not mask-image.
function IconSvg({ icon, uid, size }: { icon: string; uid: string; size: number }) {
  const data = ICON_SVG[icon];
  // Fallback for an icon with no vendored path (e.g. a trait added without an ICON_SVG
  // entry): render the Iconify class flat with the gold ramp — no emboss, but visible,
  // never a blank pin.
  if (!data)
    return (
      <span
        aria-hidden
        className={`${icon} relative bg-linear-to-b from-[#E8C547] to-[#6B5210] text-transparent`}
        style={{ fontSize: size }}
      />
    );
  return (
    <svg
      aria-hidden
      viewBox={data.viewBox ?? "0 0 24 24"}
      fill="currentColor"
      className="relative"
      style={{
        width: size,
        height: size,
        filter:
          "drop-shadow(-0.5px -0.5px 0.5px rgb(255 255 255 / 0.5)) drop-shadow(0.5px 0.5px 0.5px rgb(0 0 0 / 0.3))",
      }}
    >
      <defs>
        <linearGradient id={`i-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8C547" />
          <stop offset="50%" stopColor="#A07B16" />
          <stop offset="100%" stopColor="#6B5210" />
        </linearGradient>
      </defs>
      <g
        fill={`url(#i-${uid})`}
        stroke={`url(#i-${uid})`}
        dangerouslySetInnerHTML={{
          __html: data.body.replace(/currentColor/g, `url(#i-${uid})`),
        }}
      />
    </svg>
  );
}

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

const DL = 8; // flatter gradient for enamel (less swing than the old 13)
const oklchStr = (l: number, c: number, h: number, a?: number) =>
  `oklch(${l.toFixed(1)}% ${c.toFixed(3)} ${h}${a === undefined ? "" : ` / ${a}`})`;

// Two-stop gradient endpoints (top→bottom), shared by the enamel fill layer.
type Stops = { top: string; bot: string };

// Dark-mode drop-shadow is a colored glow of the hue (styles.css .dark .t-tilt reads
// --glow) instead of the neutral shadow used in light mode. ~30% alpha, like rose-500/30.
const glowColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return oklchStr(l, c, h, 0.3);
};

// Enamel fill gradient stops (top→bottom): saturated, with a subtle lightness ramp. Full
// chroma at both ends (no taper) — enamel colors are vivid and flat, and the reduced DL
// keeps wide-gamut hues in sRGB without a chroma taper.
const fillStops = (hue: Trait["hue"]): Stops => {
  const { l, c, h } = HUE_OKLCH[hue];
  return { top: oklchStr(l + DL, c, h), bot: oklchStr(l - DL, c, h) };
};

// The rim/glow/gradient strings depend only on hue (8 values), so resolve them once at
// module load instead of rebuilding them on every BadgeShape render (badges re-render on
// any parent update, e.g. the grade dialog toggling).
type HueStyle = { glow: string; fill: Stops };
const HUE_STYLE = Object.fromEntries(
  (Object.keys(HUE_OKLCH) as Trait["hue"][]).map((hue) => [
    hue,
    { glow: glowColor(hue), fill: fillStops(hue) },
  ]),
) as Record<Trait["hue"], HueStyle>;

// --- Candy style (the original gradient-rim + halo look from main) ----------------
// Reconstructed here so BadgeShape can toggle between enamel and candy via preference.
const CANDY_DL = 13;

// Candy rim: theme-aware crisp inner border (light-dark via CSS color-scheme).
const candyRimColor = (hue: Trait["hue"]) => {
  const { l, c, h } = HUE_OKLCH[hue];
  return `light-dark(${oklchStr(l - 12, c, h)}, ${oklchStr(l - 23, c, h)})`;
};

// Candy fill: chroma-tapered at the light end (×0.8) to keep wide-gamut hues in sRGB.
const candyFillStops = (hue: Trait["hue"]): Stops => {
  const { l, c, h } = HUE_OKLCH[hue];
  return { top: oklchStr(l + CANDY_DL, c * 0.8, h), bot: oklchStr(l - CANDY_DL, c, h) };
};

// Candy halo: faded gradient glow behind the shape, theme-aware via light-dark().
const candyHaloStops = (hue: Trait["hue"]): Stops => {
  const { c, h } = HUE_OKLCH[hue];
  const ld = (lightL: number, lightC: number, lightA: number, darkA: number) =>
    `light-dark(${oklchStr(lightL, lightC, h, lightA)}, ${oklchStr(40, c * 0.6, h, darkA)})`;
  return {
    top: ld(81, c * 0.48, 0.35, 0.5),
    bot: ld(97, c * 0.06, 0.35, 0.1),
  };
};

type CandyHueStyle = { rim: string; glow: string; fill: Stops; halo: Stops };
const CANDY_STYLE = Object.fromEntries(
  (Object.keys(HUE_OKLCH) as Trait["hue"][]).map((hue) => [
    hue,
    {
      rim: candyRimColor(hue),
      glow: glowColor(hue),
      fill: candyFillStops(hue),
      halo: candyHaloStops(hue),
    },
  ]),
) as Record<Trait["hue"], CandyHueStyle>;

const CANDY_THIN = 1;
const CANDY_HALO = 5;

// Candy masks a solid glyph (mask-image → white gradient), so it needs the FILLED icon
// variant. traits.ts stores the outline variant that enamel's ICON_SVG paths key off;
// map those back to their filled form so candy renders a solid icon, not a hollow outline.
const CANDY_ICON: Record<string, string> = {
  "icon-[tabler--arrow-big-up-line]": "icon-[tabler--arrow-big-up-line-filled]",
  "icon-[tabler--arrow-big-down-line]": "icon-[tabler--arrow-big-down-line-filled]",
  "icon-[tabler--dice-6]": "icon-[fa7-solid--dice]",
  "icon-[tabler--flame]": "icon-[tabler--flame-filled]",
};
const candyIconClass = (icon: string) => CANDY_ICON[icon] ?? icon;

function CandyShapeSvg({
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
  paintOrderStroke?: boolean;
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

// Gold metal rim width in screen px (non-scaling-stroke, constant across badge sizes).
// Drawn double-width with the opaque fill covering its inner half, so RIM is the amount
// that shows OUTSIDE the fill edge.
const RIM = 2;

// Gold metal gradient for the raised rim — light at top-left, dark at bottom-right,
// so the rim reads as a single directional light source.
const METAL: { o: string; c: string }[] = [
  { o: "0%", c: "#FFF0B3" },
  { o: "50%", c: "#D4A522" },
  { o: "100%", c: "#8B6914" },
];

// Enamel pin SVG: gold metal rim + saturated enamel fill + glassy gloss. The rim is a
// thick diagonal gold stroke (paint-order: stroke, so it sits outside the fill). A thin
// dark inner-shadow line at the boundary shows the enamel is recessed below the raised
// metal. A clipped white gradient overlay adds the glassy sheen of fired enamel.
function EnamelPinSvg({ shape, uid, fill }: { shape: Trait["shape"]; uid: string; fill: Stops }) {
  const d = SHAPE_PATH[shape];
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-full overflow-visible">
      <defs>
        <linearGradient id={`m-${uid}`} x1="0" y1="0" x2="1" y2="1">
          {METAL.map((s) => (
            <stop key={s.o} offset={s.o} stopColor={s.c} />
          ))}
        </linearGradient>
        <linearGradient id={`e-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill.top} />
          <stop offset="100%" stopColor={fill.bot} />
        </linearGradient>
        <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.28} />
          <stop offset="45%" stopColor="#fff" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`s-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0.9} />
        </linearGradient>
        <clipPath id={`c-${uid}`}>
          <path d={d} />
        </clipPath>
        <filter id={`b-${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>
      {/* Enamel fill + gold metal rim (paint-order: stroke → rim outside the fill) */}
      <path
        d={d}
        fill={`url(#e-${uid})`}
        stroke={`url(#m-${uid})`}
        strokeWidth={RIM * 2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ paintOrder: "stroke" }}
      />
      {/* Inner shadow (dark top-left, light bottom-right) + glassy gloss, clipped to
          the shape so only the interior half of the stroke shows — reads as the raised
          rim casting a shadow onto the recessed enamel. */}
      <g clipPath={`url(#c-${uid})`}>
        <path
          d={d}
          fill="none"
          stroke={`url(#s-${uid})`}
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          filter={`url(#b-${uid})`}
        />
        <rect x="0" y="0" width="24" height="24" fill={`url(#g-${uid})`} />
      </g>
    </svg>
  );
}

// Shared scaffolding for both styles: sizing box → optional static halo (kept OUTSIDE
// .t-tilt so the hover scale + 3D tilt don't move it) → tilt layer (--glow + pointer
// tilt) → tilt-card holding the pin/icon/glare stack.
function BadgeShell({
  size,
  glow,
  tiltClass,
  halo,
  dataBadge,
  children,
}: {
  size: number;
  glow: string;
  tiltClass?: string;
  halo?: ReactNode;
  dataBadge?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-badge={dataBadge}
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      {halo}
      <span
        className={`t-tilt relative grid size-full place-items-center${tiltClass ? ` ${tiltClass}` : ""}`}
        style={{ "--glow": glow } as CSSProperties}
        onPointerMove={tiltMove}
        onPointerLeave={tiltLeave}
      >
        <span className="t-tilt-card grid size-full place-items-center">{children}</span>
      </span>
    </span>
  );
}

// Radial sheen masked to the shape silhouette; screen-blends and tracks the pointer via
// --tilt-gx/gy from .t-tilt-glare. backgroundColor:transparent zeroes the Iconify class's
// currentColor fill so only the glare gradient shows through the mask.
function Glare({ shape }: { shape: Trait["shape"] }) {
  return (
    <span
      aria-hidden
      className={`${SHAPE_ICON[shape]} t-tilt-glare absolute inset-0 size-full`}
      style={{ backgroundColor: "transparent" }}
    />
  );
}

export function EnamelBadgeShape({
  trait,
  size = 32,
  dataBadge,
}: {
  trait: Trait;
  size?: number;
  dataBadge?: string;
}) {
  const style = HUE_STYLE[trait.hue];
  const uid = useId().replace(/:/g, "");
  return (
    <BadgeShell size={size} glow={style.glow} tiltClass="t-tilt-enamel" dataBadge={dataBadge}>
      <EnamelPinSvg shape={trait.shape} uid={uid} fill={style.fill} />
      <IconSvg icon={trait.icon} uid={uid} size={size * 0.4} />
      <Glare shape={trait.shape} />
    </BadgeShell>
  );
}

export function CandyBadgeShape({
  trait,
  size = 32,
  dataBadge,
}: {
  trait: Trait;
  size?: number;
  dataBadge?: string;
}) {
  const style = CANDY_STYLE[trait.hue];
  const uid = useId().replace(/:/g, "");
  return (
    <BadgeShell
      size={size}
      glow={style.glow}
      dataBadge={dataBadge}
      halo={
        <CandyShapeSvg
          shape={trait.shape}
          gid={`h-${uid}`}
          stops={style.halo}
          fill="none"
          stroke={`url(#h-${uid})`}
          strokeWidth={CANDY_HALO * 2}
          className="pointer-events-none"
        />
      }
    >
      {/* Fill + crisp rim */}
      <CandyShapeSvg
        shape={trait.shape}
        gid={`f-${uid}`}
        stops={style.fill}
        fill={`url(#f-${uid})`}
        stroke={style.rim}
        strokeWidth={CANDY_THIN * 2}
        paintOrderStroke
      />
      {/* Icon: filled glyph, white→white/70 gradient via Iconify mask-image */}
      <span
        className={`${candyIconClass(trait.icon)} relative bg-linear-to-b from-white to-white/70 text-transparent`}
        style={{ fontSize: size * 0.4 }}
      />
      <Glare shape={trait.shape} />
    </BadgeShell>
  );
}

// Forced-style renderer — the shared core for the picker preview and the public component.
export function BadgeShapePreview({
  trait,
  size = 32,
  style,
}: {
  trait: Trait;
  size?: number;
  style: BadgeStyle;
}) {
  return style === "candy" ? (
    <CandyBadgeShape trait={trait} size={size} />
  ) : (
    <EnamelBadgeShape trait={trait} size={size} />
  );
}

// Public API — renders BOTH variants; CSS (html[data-badge-style]) hides the inactive
// one. The pre-paint script in __root sets data-badge-style from localStorage, so the
// choice is applied before first paint with no flash — including on the ISR-cached serve
// routes, where a cookie would be stripped by Vercel's edge cache. display:none means the
// hidden variant costs no layout/paint (only a few badges render, header-only), so the
// double render is free. Live toggling flips the <html> attr (see setBadgeStyle).
export function BadgeShape({ trait, size = 32 }: { trait: Trait; size?: number }) {
  return (
    <>
      <EnamelBadgeShape trait={trait} size={size} dataBadge="enamel" />
      <CandyBadgeShape trait={trait} size={size} dataBadge="candy" />
    </>
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

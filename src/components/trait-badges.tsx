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

// Custom inline-SVG icons that can't come from Iconify (e.g. a traced raster).
// Keyed by trait id; when present, BadgeShape renders the path as an inline SVG
// with the same white→white/70 gradient fill instead of the Iconify mask span.
const CUSTOM_ICONS: Record<string, { d: string; viewBox: string }> = {
  "bull-only": {
    viewBox: "296.5 289.3 1476.7 1476.7",
    d: "M604.4 614.2a89 89 0 0 0 28.4 59.1c6.7 6.2 14.9 11.4 30.6 19.4 7.2 3.6 15.6 8.3 18.6 10.3a49 49 0 0 1 15.6 16.5 19 19 0 0 1-.1 14.4c-3.5 6.8-15.3 14.3-30 19.1-9.3 3-13.2 6.1-16.4 12.9-2.2 4.7-2.6 7-2.6 14.6 0 8 .3 9.7 3.2 15.7 4 8.5 10 15 17.2 18.5 13.8 6.8 34.1 1.4 60.1-16a83 83 0 0 0 35.6-49.4 78 78 0 0 0-1.9-37.1c-8.8-25.1-30-42.4-65-53.3L672 651a120 120 0 0 1-56.4-34.4l-11.9-12.1zm309.1 40.5c-10.4.9-30.3 4.9-42.5 8.4a323 323 0 0 0-51 19.7c-36.6 16.7-38.1 17.4-37.4 19.1 3.5 8.4 6.4 23.2 6.4 33 0 7-2.7 21.2-5.5 29.3a77 77 0 0 1-10.5 20.3q-3.9 2.4 6.8 2.5c22.8 0 50.1 9.5 74.2 25.8 10.5 7.2 10.9 8.4 5.1 18.2a142 142 0 0 1-37 39.9 97 97 0 0 1-81.8 12.6c-9.7-3.1-13.3-6.3-13.3-12.1 0-8.4 6.8-12.5 16.3-9.8 2.9.8 8.8 2.1 13.2 3 25.6 4.9 56.1-8.3 74.6-32.3 4.9-6.3 5.5-5.5-7.6-11.8-23.3-11.3-50.2-14.5-69.7-8.2-4.3 1.4-15.8 6.8-25.5 12-20.3 10.9-30.5 14.7-41.4 15.4a55.5 55.5 0 0 1-53.7-31.7 59 59 0 0 1-7.2-28q0-13.7 6.2-25.2c1.7-3.2 2.9-6 2.7-6.3-.9-.8-15.8 2.8-29 7.1-9.8 3.2-16.5 4.7-23.7 5.4-21.1 2-33.3 9.2-43.9 25.7A110 110 0 0 0 526 822a181 181 0 0 1-13.8 42.1c-10.8 24.2-10.5 30.8 1.9 52.9 4 7.2 3.9 8-5 49-9.4 43.1-11.4 50.8-16.6 61.8-5.4 11.4-6.2 16-4.1 24.1 2 8 5.4 12.8 16.1 22.9 20.1 19.1 30 22.2 64.8 20.2 10-.5 20-1.5 22.2-2.1a44 44 0 0 0 27-22.9c9.5-17.6 15.9-22.4 39.8-30.1 25-8 41.7-17.6 56.4-32.5 15-15.3 26.4-36.8 28.8-54.3 1-7.1 4.6-11.1 10-11.1 4.9 0 9 2.3 10.5 6 3.8 9.3-4.9 36.5-18.2 56.5A171 171 0 0 1 709 1041a148.5 148.5 0 0 1 32.2 31c2.6 3.6 10.1 16.4 16.8 28.5a629 629 0 0 0 17.3 29.5 188 188 0 0 0 100.2 75.4c15.3 5 39.5 10.4 39.5 8.8 0-.3-4.6-9.3-10.2-20.1-13-25-15.3-29.9-18.9-38.8-3.7-9.4-8.4-27.3-10.3-39.2-1.3-7.9-1.3-9.8-.2-12.6 2.7-6.4 9.1-8.3 15.3-4.6 3.6 2.2 3.5 2.1 6.2 15.7a202 202 0 0 0 23.6 63c18.8 33.6 21.3 41.7 22.5 73.4.9 23.9 1.7 28.8 6.7 40.5 7.2 16.6 7.5 17.5 7.4 26.7a180 180 0 0 1-6.1 40c-1.5 4.9-5 11.1-12.5 22.3a189 189 0 0 0-22.9 43.7c-4.2 11.2-4.5 14.7-1.5 17.4 2 1.8 4.1 1.9 39.3 1.9 28.1 0 38-.3 40.8-1.3 7.8-2.8 11-10 12.7-28.5.5-5.9 1.5-11.4 2.1-12.2s3.4-2.1 6.1-3c9.4-3.2 9.8-4.6 7.7-32.2-2.1-28.4.6-45.4 11.3-71.1a111 111 0 0 0 10.9-45.1q1.6-25.3 7.1-41.2c1.2-3.5 6.7-16.1 12.1-27.9 17.1-37 20.4-49.8 19.5-76.5-.7-18.2-2.8-30.2-8.2-45.3-4.3-11.9-4.4-15.2-.7-19.3 4.6-5.1 12.5-4 16.7 2.5 2.7 4.1 8.7 22.5 11.2 34.6a190 190 0 0 1 1.9 57 207 207 0 0 1-18 51c-6.1 12.8-8 17.6-7 17.8a246 246 0 0 0 33.9-6.4 460 460 0 0 0 65.5-23.2c53.7-22.4 80.1-30.7 109.4-34.4 5.3-.7 9.6-1.5 9.6-1.9s-2.2-5.3-4.9-11c-9.4-20.1-19.1-50.2-19.1-59.7 0-5.4 1.2-7.7 5-9.7 4.1-2.1 8.5-1.9 11.5.7 2 1.8 3.6 5.6 7 17.3 13 44.5 33.5 79.6 64.4 110.6 21.9 21.8 39.6 34.1 76.7 53.2a546 546 0 0 1 33.4 18.2 138 138 0 0 1 32.6 33c14.6 22.4 27.2 62.1 26.2 82.4-.4 8.3-.8 9.5-6.5 21.7-9.4 19.9-15.1 37.7-13.8 43.6 1.4 6.2 2.1 6.3 42 6.3 40.4 0 39.6.1 43.6-6.9 2.3-3.9 2.4-4.8 2.1-20.7l-.2-16.6 3.5-4.9c7.5-10.4 7.6-10.7 7.2-15.4-.2-2.5-3.1-10.7-6.5-18.7a229 229 0 0 1-14.6-44.3 541 541 0 0 1-10.2-79.5c-.5-8.7-1.2-13-2.5-15.7a66 66 0 0 0-13.8-13.3c-30.5-24.3-43.5-46.9-47.3-81.7-.9-8.7-.9-15.5.3-34.1 2-33.1 1.8-72.9-.4-88.2-5.2-35-14.7-61.2-30.8-85.3-2.7-4-4.9-7.6-4.9-8.1 0-1.9 11.9-3.6 25.5-3.6 11.9 0 15.1.4 21.5 2.3a73.7 73.7 0 0 1 52 71.3c0 12.4-1.8 21.9-8.6 44.3-7.2 23.7-8.8 33.1-8.1 47.1a60 60 0 0 0 8.4 30.5 77 77 0 0 0 22.7 22.9 78 78 0 0 0 47.4 10.1c13.2-1.5 13.3-1.6 6.3-6.2-11.7-7.6-17.7-16.9-24.6-37.8-2.1-6.3-4.4-12.8-5.2-14.4a58 58 0 0 0-17.3-17q-7.6-5.4-9-8.5c-2.1-5.1-.6-14.2 5.3-32.6 7.5-23.6 9.1-33 8.4-50.8a94.7 94.7 0 0 0-42.9-77.4c-30.2-20.1-66.5-24.6-105.6-13.1l-7.3 2.1-2.7-2.1a302 302 0 0 0-35.7-22.9c-23.2-11.8-42.9-17.5-88.5-25.8-59.8-10.8-81.8-16.3-111.4-27.9-52.6-20.7-73.7-33.3-133.6-80.1-45.7-35.7-66.8-48.9-91-56.9a185 185 0 0 0-70.5-8.9M637.6 878.6c.4 1.4.4 6.2.1 10.6-.9 13.2-6.1 21.2-16.3 25.2-8 3.2-30.4 5-30.4 2.5 0-.6 1.2-3.9 2.6-7.5 7.3-18.4 16.7-27.6 32.4-31.8 8.5-2.3 10.8-2.1 11.6 1M417.3 673.2a114 114 0 0 0-19 70 74 74 0 0 0 8.8 37.3 94 94 0 0 0 51.1 45.9c9.4 3.9 25.5 8.1 34.9 9.2 7.1.8 6.3 2.1 11.9-21.2 3.7-15.3 7.6-26.8 12.1-35.6l2.1-4.1-6.4.7c-7.5.8-24.5-.7-33.7-3a70 70 0 0 1-37.8-23.8c-11.9-15.7-17.4-37-17.7-67.8 0-8.7-.3-15.8-.6-15.8a55 55 0 0 0-5.7 8.2m319.1 457.5c-3.4 5.4-10.3 17.1-15.5 26.1s-12.4 20.4-16.2 25.5c-10.5 13.8-13.4 18.6-15.7 25.1a48 48 0 0 0 2.6 38.5c3 6.1 6.2 10 18.9 23.1a287 287 0 0 1 40.4 51.4c16 23.9 20.2 27.6 37.1 32.6 4.1 1.2 12.9 4.4 19.5 7 13.4 5.3 22.9 8.1 35.4 10.4 8.8 1.7 19.8 2.1 21.8.8 3.5-2.2 3.3-11.2-.8-32.7-3.8-20.3-12.9-44-18.5-48.4-3.2-2.5-7.1-2.6-21.9-.6-12.1 1.7-11.9 1.8-12.9-4.7-1-6-4.1-11.4-7.3-12.6-1.5-.6-5.4-1.8-8.7-2.7q-11.4-3.1-18.8-18.5c-5.2-10.7-5.5-12.4-2.5-15.2 1.4-1.3 9-5 16.9-8.2 15-6.1 37.8-17.3 37.8-18.4 0-.4-2.4-2.1-5.3-3.9a216 216 0 0 1-72.7-74.2 75 75 0 0 0-6.8-10.1c-.4 0-3.5 4.4-6.8 9.7m557.1 29.9c-23.6 3.6-45 9.2-66 17.1-11.7 4.5-41.6 17-42.4 17.8-.6.7 7.7 14.4 13.5 22.1 2.9 3.9 12.1 14.1 20.6 22.6 18.7 18.9 21.3 23 21.2 33.8 0 8.8-1.9 15.1-8 27-7.2 14-26.9 39.1-47.6 60.7a160 160 0 0 0-35.3 57.5c-2.6 7.3-2.7 7.9-1.1 10.2a7 7 0 0 0 4.8 3.1c1.8.3 18.2.5 36.3.3 31.1-.3 33.2-.4 36.9-2.4 5.1-2.6 7.1-6.6 9.7-19 3.5-16 3-15.4 10.6-15.4 8.2 0 10.4-2 13.3-12.1 7.5-25.7 10.9-32.9 22.2-48.1 4-5.3 13.6-16.5 21.3-24.8 34.8-37.6 34.7-37.5 34.7-46.9 0-4.5-1-8.1-5-17.6a78 78 0 0 1-8-38.8 63 63 0 0 1 2.8-17.8l2.2-6.7-6.1-7.6c-3.3-4.2-7.4-9.7-9.1-12.1-3-4.3-3.3-4.5-7.8-4.4-2.6.1-8.7.7-13.7 1.5",
  },
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
          {/* Icon: white→white/70 gradient. Iconify icons are rendered via the
              plugin's CSS mask (the span's bg-gradient shows through the mask).
              Custom icons (CUSTOM_ICONS) render as an inline SVG path with the
              same gradient applied as a fill. Both scale with the badge (≈0.4 of
              the box, matching the 13px-in-32px default). */}
          {CUSTOM_ICONS[trait.id] ? (
            <svg
              aria-hidden
              viewBox={CUSTOM_ICONS[trait.id].viewBox}
              className="relative"
              style={{ width: size * 0.4, height: size * 0.4 }}
            >
              <defs>
                <linearGradient id={`ic-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="white" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.7)" />
                </linearGradient>
              </defs>
              <path d={CUSTOM_ICONS[trait.id].d} fill={`url(#ic-${uid})`} />
            </svg>
          ) : (
            <span
              className={`${trait.icon} relative bg-linear-to-b from-white to-white/70 text-transparent`}
              style={{ fontSize: size * 0.4 }}
            />
          )}
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

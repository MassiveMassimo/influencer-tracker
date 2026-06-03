// Decorative faded chart motif. Handle-seeded so each card is stable but distinct;
// trend biased by the creator's excess sign. Rendered as a standalone SVG (full
// mask/gradient fidelity via resvg), then embedded as an <img> in the satori card.
import type { OgPalette } from "./theme";

export interface MotifPoint {
  x: number; // 0..1 across width
  y: number; // 0..1, higher = visually higher (inverted to SVG coords in buildMotifSvg)
}

// xmur3 string hash → 32-bit seed.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// mulberry32 PRNG.
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 26; // points across the chart

/** Deterministic random walk, biased by `up`, normalized to [0,1]. */
export function motifPoints(seed: string, up: boolean): MotifPoint[] {
  const rnd = mulberry32(xmur3(seed)());
  const drift = up ? 0.05 : -0.05;
  let v = up ? 0.25 : 0.75;
  const raw: number[] = [];
  for (let i = 0; i < N; i++) {
    v += drift + (rnd() - 0.5) * 0.22;
    raw.push(v);
  }
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const span = max - min || 1;
  // pad to [0.08, 0.92] so the stroke never clips the edges
  return raw.map((r, i) => ({
    x: i / (N - 1),
    y: 0.08 + ((r - min) / span) * 0.84,
  }));
}

// Catmull-Rom → cubic bezier path through points (in pixel space).
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export interface MotifOpts {
  seed: string;
  up: boolean;
  palette: OgPalette;
  width: number;
  height: number;
}

/** Self-contained SVG: lagoon→palm vertical gradient area + stroke, with a
 *  horizontal edge-fade mask matching the chart fade (0/15/85/100). */
export function buildMotifSvg({ seed, up, palette, width, height }: MotifOpts): string {
  // Place the motif in the lower ~62% of the card so text sits above it.
  const top = height * 0.38;
  const h = height - top;
  const px = motifPoints(seed, up).map((p) => ({
    x: p.x * width,
    y: top + (1 - p.y) * h, // invert: higher y → higher on screen
  }));
  const line = smoothPath(px);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="fill" x1="0" y1="${top}" x2="0" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${palette.lagoon}" stop-opacity="0.42"/>
      <stop offset="55%" stop-color="${palette.lagoonDeep}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${palette.palm}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
      <stop offset="15%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="85%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="fade"><rect x="0" y="0" width="${width}" height="${height}" fill="url(#edge)"/></mask>
  </defs>
  <g mask="url(#fade)">
    <path d="${area}" fill="url(#fill)"/>
    <path d="${line}" fill="none" stroke="${palette.lagoon}" stroke-width="3" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

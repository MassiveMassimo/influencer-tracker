// Full OG card background: solid base + trend-colored radial glow + the faded
// chart motif, as one self-contained SVG. resvg rasterizes it; both the live
// renderer and the preview script consume this single source so they match.
import { buildMotifSvg } from "./motif";
import type { OgPalette } from "./theme";
import type { OgTheme } from "./solar";

// Hex-only (#rrggbb). Callers pass palette.lagoon / palette.down, never the
// palette's rgba() tokens — those go straight into SVG fill attributes.
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export interface CardBgOpts {
  seed: string;
  up: boolean;
  theme: OgTheme;
  palette: OgPalette;
  width: number;
  height: number;
}

export function buildCardBackgroundSvg({
  seed,
  up,
  theme,
  palette,
  width,
  height,
}: CardBgOpts): string {
  const motifInner = buildMotifSvg({ seed, up, palette, width, height, theme })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  const glowColor = up ? palette.lagoon : palette.down;
  const glowA = theme === "dark" ? 0.22 : 0.16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="70%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${hexToRgba(glowColor, glowA)}"/>
      <stop offset="100%" stop-color="${hexToRgba(glowColor, 0)}"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${palette.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${motifInner}
</svg>`;
}

export interface LineBgOpts {
  closes: number[];
  up: boolean;
  theme: OgTheme;
  palette: OgPalette;
  width: number;
  height: number;
}

// Ticker-card background: solid base + trend glow + the symbol's price line drawn
// across the lower band of the card (so it never collides with the headline text).
// Downsamples to <=64 points; degrades to base+glow for empty/flat series.
export function buildLineChartBackgroundSvg({
  closes,
  up,
  theme,
  palette,
  width,
  height,
}: LineBgOpts): string {
  const lineColor = up ? palette.lagoon : palette.down;
  const glowA = theme === "dark" ? 0.22 : 0.16;

  // Downsample evenly to at most 64 points.
  const MAX = 64;
  let pts = closes;
  if (closes.length > MAX) {
    pts = Array.from(
      { length: MAX },
      (_, i) => closes[Math.round((i * (closes.length - 1)) / (MAX - 1))],
    );
  }

  // Lower band of the card: y in [bandTop, bandBottom].
  const bandTop = height * 0.5;
  const bandBottom = height * 0.94;
  let linePath = "";
  let areaPath = "";
  if (pts.length >= 2) {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const xy = pts.map((c, i) => {
      const x = (i / (pts.length - 1)) * width;
      const y = bandBottom - ((c - min) / span) * (bandBottom - bandTop);
      return [x, y] as const;
    });
    linePath = xy
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    areaPath = `${linePath} L${width} ${bandBottom} L0 ${bandBottom} Z`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="70%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${hexToRgba(lineColor, glowA)}"/>
      <stop offset="100%" stop-color="${hexToRgba(lineColor, 0)}"/>
    </radialGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${hexToRgba(lineColor, 0.18)}"/>
      <stop offset="100%" stop-color="${hexToRgba(lineColor, 0)}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${palette.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${areaPath ? `<path d="${areaPath}" fill="url(#area)"/>` : ""}
  ${linePath ? `<path d="${linePath}" fill="none" stroke="${hexToRgba(lineColor, 0.55)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
</svg>`;
}

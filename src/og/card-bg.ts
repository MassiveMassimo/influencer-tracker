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

export function buildCardBackgroundSvg({ seed, up, theme, palette, width, height }: CardBgOpts): string {
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

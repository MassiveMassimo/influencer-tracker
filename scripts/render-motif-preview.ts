// Standalone motif preview — renders the faded chart motif alone (no fonts/cards)
// so the style can be reviewed before any card work. resvg has full SVG support.
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { buildMotifSvg } from "../src/og/motif";
import { palette } from "../src/og/theme";

const W = 1200;
const H = 630;
const out = ".og-preview";
mkdirSync(out, { recursive: true });

const cases = [
  { seed: "kevvonz", up: true, theme: "light" as const },
  { seed: "kevvonz", up: false, theme: "light" as const },
  { seed: "kevvonz", up: true, theme: "dark" as const },
  { seed: "kevvonz", up: false, theme: "dark" as const },
];

for (const c of cases) {
  const pal = palette(c.theme);
  const svg = buildMotifSvg({ seed: c.seed, up: c.up, palette: pal, width: W, height: H, theme: c.theme });
  // paint the card background (solid + soft lagoon glow) behind the motif
  const glowOpacity = c.theme === "dark" ? 0.22 : 0.16;
  const glowColor = c.up ? pal.lagoon : pal.down; // glow follows the trend tone
  const framed = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="70%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${glowColor}" stop-opacity="${glowOpacity}"/>
      <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${pal.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>`;
  const png = new Resvg(framed, { fitTo: { mode: "width", value: W } }).render().asPng();
  const name = `motif-${c.theme}-${c.up ? "up" : "down"}-${c.seed}.png`;
  writeFileSync(`${out}/${name}`, png);
  console.log("wrote", `${out}/${name}`);
}

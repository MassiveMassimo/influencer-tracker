// Standalone motif preview — renders the full card background (base + glow + motif)
// so the style can be reviewed before any card work. resvg has full SVG support.
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { buildCardBackgroundSvg } from "../src/og/card-bg";
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
  const svg = buildCardBackgroundSvg({
    seed: c.seed,
    up: c.up,
    theme: c.theme,
    palette: pal,
    width: W,
    height: H,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  const name = `motif-${c.theme}-${c.up ? "up" : "down"}-${c.seed}.png`;
  writeFileSync(`${out}/${name}`, png);
  console.log("wrote", `${out}/${name}`);
}

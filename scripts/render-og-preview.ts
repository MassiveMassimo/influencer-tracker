// Full OG preview — renders every card type in both themes (theme overridden so
// the sunrise/sunset switch doesn't depend on wall-clock). Output: .og-preview/.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { renderOgPng } from "../src/og/render";

const out = ".og-preview";
mkdirSync(out, { recursive: true });

const idx = JSON.parse(readFileSync("data/creators/index.json", "utf8")) as {
  handle: string;
  name: string;
  totalCalls: number;
  avgExcess3m: number;
  avatar?: string;
}[];
const c = idx[0];

const cards: { file: string; card: Parameters<typeof renderOgPng>[0] }[] = [
  { file: "og-home-light.png", card: { kind: "home", theme: "light" } },
  { file: "og-home-dark.png", card: { kind: "home", theme: "dark" } },
];
if (c) {
  for (const theme of ["light", "dark"] as const) {
    cards.push({
      file: `og-creator-${theme}.png`,
      card: {
        kind: "creator",
        theme,
        name: c.name,
        handle: c.handle,
        avatar: c.avatar,
        excess3m: c.avgExcess3m,
        totalCalls: c.totalCalls,
      },
    });
  }
  cards.push({
    file: "og-ticker-light.png",
    card: {
      kind: "ticker",
      theme: "light",
      symbol: "NVDA",
      company: "NVIDIA",
      name: c.name,
      handle: c.handle,
      excess3m: 0.082,
    },
  });
  cards.push({
    file: "og-ticker-dark.png",
    card: {
      kind: "ticker",
      theme: "dark",
      symbol: "TSLA",
      company: "Tesla",
      name: c.name,
      handle: c.handle,
      excess3m: -0.041,
    },
  });
}

for (const { file, card } of cards) {
  writeFileSync(`${out}/${file}`, await renderOgPng(card));
  console.log("wrote", `${out}/${file}`);
}

# SEO: Favicon + Dynamic OG Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the influencer-tracker dashboard SEO/social-share ready with an on-brand favicon, runtime-generated dynamic OG images (home / creator / ticker) that flip light↔dark by real sunrise/sunset, and complete head metadata + sitemap.

**Architecture:** A shared OG renderer turns a typed `OgCard` into a 1200×630 PNG via `satori` (JSX→SVG) + `@resvg/resvg-js` (SVG→PNG). The decorative faded chart motif is generated as a standalone SVG (handle-seeded, edge-fade mask, lagoon→palm gradient), rasterized by resvg into a data-URI `<img>` embedded in the card — sidestepping satori's weak SVG/mask support. Three TanStack Start server routes serve the PNGs; per-route `head:` wires absolute OG/Twitter tags. Favicon is generated once from the app's `LineChartIcon` mark and committed as static files.

**Tech Stack:** TanStack Start (React 19), satori, @resvg/resvg-js, @fontsource/fraunces + @fontsource/geist-mono (static woff for satori), bun test, TypeScript. `#/` alias → `src/`.

---

## File Structure

**Create:**

- `src/og/solar.ts` — pure sunrise/sunset (solar altitude) → `light|dark`
- `src/og/solar.test.ts`
- `src/og/motif.ts` — seeded PRNG + point gen + standalone faded-chart SVG string
- `src/og/motif.test.ts`
- `src/og/fonts.ts` — load static woff font bytes for satori (cached)
- `src/og/theme.ts` — `OgPalette` light/dark color tokens (from `styles.css`)
- `src/og/render.tsx` — `renderOgPng(card)`, `OgCard` union, motif rasterize + compose
- `src/og/render.test.ts`
- `src/og/site.ts` — `siteUrl()` absolute origin
- `src/routes/og[.]png.ts` — `/og.png` (home)
- `src/routes/og.$handle[.]png.ts` — `/og/$handle.png` (creator)
- `src/routes/og.$handle.$symbol[.]png.ts` — `/og/$handle/$symbol.png` (ticker)
- `src/routes/sitemap[.]xml.ts` — `/sitemap.xml`
- `scripts/render-motif-preview.ts` — motif checkpoint
- `scripts/render-og-preview.ts` — full preview checkpoint
- `scripts/gen-icons.ts` — favicon/app icons
- `src/og/icon-mark.ts` — the app-mark SVG (shared by icons + cards)

**Modify:**

- `src/routes/__root.tsx` — favicon links, default OG/Twitter, theme-color
- `src/routes/index.tsx` — `head:`
- `src/routes/c.$handle.index.tsx` — `head:`
- `src/routes/c.$handle.ticker.$symbol.tsx` — `head:`
- `public/manifest.json` — brand name/colors/icons
- `public/robots.txt` — Sitemap line
- `public/favicon.ico`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `public/icon.svg` (generated; old `logo192.png`/`logo512.png` removed)

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install**

Run:

```bash
cd /Users/imo/Documents/GitHub/stonks/influencer-tracker
bun add satori @resvg/resvg-js @fontsource/fraunces @fontsource/geist-mono
```

- [ ] **Step 2: Confirm the static woff files exist (satori needs ttf/otf/woff — NOT woff2)**

Run:

```bash
ls node_modules/@fontsource/fraunces/files/ | grep -E 'latin-600-normal' ; \
ls node_modules/@fontsource/geist-mono/files/ | grep -E 'latin-(400|600)-normal'
```

Expected: lines including `fraunces-latin-600-normal.woff`, `geist-mono-latin-400-normal.woff`, `geist-mono-latin-600-normal.woff`.
If only `.woff2` appears (no `.woff`), STOP and tell the user — satori can't read woff2; we'll need to vendor TTFs instead.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock 2>/dev/null || git add package.json
git commit -m "build: add satori, resvg, og fonts"
```

---

## Task 2: Solar day/night helper (TDD)

**Files:**

- Create: `src/og/solar.ts`
- Test: `src/og/solar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/og/solar.test.ts
import { describe, expect, it } from "bun:test";
import { isDaytime, ogTheme, NYC } from "#/og/solar.ts";

describe("solar", () => {
  // NYC summer solstice: ~16:00 UTC is local noon (EDT) → day; 05:00 UTC ~1am → night.
  it("is day at local noon", () => {
    expect(isDaytime(new Date("2026-06-21T16:00:00Z"), NYC.lat, NYC.lng)).toBe(true);
  });
  it("is night after local midnight", () => {
    expect(isDaytime(new Date("2026-06-21T05:00:00Z"), NYC.lat, NYC.lng)).toBe(false);
  });
  it("is night in winter pre-dawn", () => {
    expect(isDaytime(new Date("2026-12-21T10:00:00Z"), NYC.lat, NYC.lng)).toBe(false);
  });
  it("ogTheme maps day→light, night→dark", () => {
    expect(ogTheme(new Date("2026-06-21T16:00:00Z"))).toBe("light");
    expect(ogTheme(new Date("2026-06-21T05:00:00Z"))).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/og/solar.test.ts`
Expected: FAIL — `Cannot find module '#/og/solar.ts'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/og/solar.ts
// Low-precision solar position (NOAA approximation, accurate to ~0.01°).
// Used only to pick OG background theme by real day/night — no exact times needed.

export const NYC = {
  lat: Number(process.env.OG_LAT ?? 40.7128),
  lng: Number(process.env.OG_LNG ?? -74.006),
};

/** Sun's altitude above the horizon, in degrees, at `date` for the given location. */
export function solarAltitudeDeg(date: Date, lat: number, lng: number): number {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86_400_000 + 2_440_587.5; // Julian date
  const n = jd - 2_451_545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude (deg)
  const g = ((357.528 + 0.9856003 * n) % 360) * rad; // mean anomaly (rad)
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic long
  const epsilon = 23.439 * rad; // obliquity of the ecliptic
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda)); // declination
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)); // right ascension
  const gmst = (280.46061837 + 360.98564736629 * n) % 360; // Greenwich mean sidereal time
  const ha = (gmst + lng) * rad - ra; // local hour angle
  const latR = lat * rad;
  const alt = Math.asin(
    Math.sin(latR) * Math.sin(delta) + Math.cos(latR) * Math.cos(delta) * Math.cos(ha),
  );
  return alt / rad;
}

/** True when the sun is above the horizon (−0.833° accounts for refraction + solar radius). */
export function isDaytime(date: Date, lat: number, lng: number): boolean {
  return solarAltitudeDeg(date, lat, lng) > -0.833;
}

export type OgTheme = "light" | "dark";

/** OG background theme for the moment `date` at the configured location (NYC default). */
export function ogTheme(date: Date = new Date(), loc = NYC): OgTheme {
  return isDaytime(date, loc.lat, loc.lng) ? "light" : "dark";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/og/solar.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/og/solar.ts src/og/solar.test.ts
git commit -m "feat(og): sunrise/sunset theme helper"
```

---

## Task 3: Faded chart motif — seeded SVG (TDD)

**Files:**

- Create: `src/og/theme.ts`, `src/og/motif.ts`
- Test: `src/og/motif.test.ts`

- [ ] **Step 1: Create the palette module**

```ts
// src/og/theme.ts
// OG color tokens lifted from src/styles.css (:root / .dark). Hex only — satori/resvg
// don't resolve CSS vars or oklch reliably.
import type { OgTheme } from "./solar";

export interface OgPalette {
  bg: string;
  bgAccent: string; // subtle radial/hero tint
  fg: string; // primary text
  fgMuted: string; // secondary text
  lagoon: string;
  lagoonDeep: string;
  palm: string;
  line: string; // hairline / card border
  card: string; // island-shell surface
  up: string; // positive stat
  down: string; // negative stat
}

const LIGHT: OgPalette = {
  bg: "#e7f3ec",
  bgAccent: "rgba(79,184,178,0.30)",
  fg: "#173a40",
  fgMuted: "#416166",
  lagoon: "#4fb8b2",
  lagoonDeep: "#328f97",
  palm: "#2f6a4a",
  line: "rgba(23,58,64,0.14)",
  card: "rgba(255,255,255,0.86)",
  up: "#2f6a4a",
  down: "#b3402f",
};

const DARK: OgPalette = {
  bg: "#0a1418",
  bgAccent: "rgba(96,215,207,0.18)",
  fg: "#d7ece8",
  fgMuted: "#afcdc8",
  lagoon: "#60d7cf",
  lagoonDeep: "#8de5db",
  palm: "#6ec89a",
  line: "rgba(141,229,219,0.20)",
  card: "rgba(16,30,34,0.82)",
  up: "#6ec89a",
  down: "#e0846f",
};

export function palette(theme: OgTheme): OgPalette {
  return theme === "dark" ? DARK : LIGHT;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/og/motif.test.ts
import { describe, expect, it } from "bun:test";
import { motifPoints, buildMotifSvg } from "#/og/motif.ts";
import { palette } from "#/og/theme.ts";

describe("motif", () => {
  it("is deterministic per seed", () => {
    expect(motifPoints("alpha", true)).toEqual(motifPoints("alpha", true));
  });
  it("differs across seeds", () => {
    expect(motifPoints("alpha", true)).not.toEqual(motifPoints("beta", true));
  });
  it("normalizes y into [0,1]", () => {
    for (const p of motifPoints("gamma", false)) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
  it("uptrend ends higher than it starts (in chart-space, y inverted later)", () => {
    const pts = motifPoints("delta", true);
    expect(pts[pts.length - 1].y).toBeGreaterThan(pts[0].y);
  });
  it("builds a self-contained svg with gradient + mask", () => {
    const svg = buildMotifSvg({
      seed: "x",
      up: true,
      palette: palette("light"),
      width: 1200,
      height: 630,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("<mask");
    expect(svg).toContain("</svg>");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/og/motif.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/og/motif.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/og/motif.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/og/theme.ts src/og/motif.ts src/og/motif.test.ts
git commit -m "feat(og): seeded faded chart motif svg + palette"
```

---

## Task 4: Motif preview — CHECKPOINT (is it pretty?)

**Files:**

- Create: `scripts/render-motif-preview.ts`

This renders the motif alone to PNGs (no fonts/cards needed) so the user can judge
the style before any card work. resvg has full SVG support.

- [ ] **Step 1: Write the preview script**

```ts
// scripts/render-motif-preview.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { buildMotifSvg } from "../src/og/motif";
import { palette } from "../src/og/theme";

const W = 1200;
const H = 630;
const out = ".og-preview";
mkdirSync(out, { recursive: true });

const cases = [
  { seed: "warikin", up: true, theme: "light" as const },
  { seed: "warikin", up: false, theme: "light" as const },
  { seed: "another-creator", up: true, theme: "dark" as const },
  { seed: "signal-tracker", up: true, theme: "dark" as const },
];

for (const c of cases) {
  const pal = palette(c.theme);
  const svg = buildMotifSvg({ seed: c.seed, up: c.up, palette: pal, width: W, height: H });
  // paint the card background behind the motif so the fade reads correctly
  const framed = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${pal.bg}"/>${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>`;
  const png = new Resvg(framed, { fitTo: { mode: "width", value: W } }).render().asPng();
  const name = `motif-${c.theme}-${c.up ? "up" : "down"}-${c.seed}.png`;
  writeFileSync(`${out}/${name}`, png);
  console.log("wrote", `${out}/${name}`);
}
```

- [ ] **Step 2: Run it**

Run:

```bash
bun run scripts/render-motif-preview.ts
```

Expected: 4 `.png` files in `.og-preview/`.

- [ ] **Step 3: CHECKPOINT — send PNGs to the user**

Send the 4 files via SendUserFile and ask: "Is the motif style right (curve smoothness, fade softness, gradient, stroke weight)?" Iterate on `buildMotifSvg`/`motifPoints` (stroke width, opacities, gradient stops, point count `N`, drift) until approved. Do NOT proceed past this task without sign-off.

- [ ] **Step 4: Add `.og-preview/` to .gitignore + commit script**

```bash
grep -qxF '.og-preview/' .gitignore || echo '.og-preview/' >> .gitignore
git add scripts/render-motif-preview.ts .gitignore
git commit -m "chore(og): motif preview script"
```

---

## Task 5: Font loader for satori

**Files:**

- Create: `src/og/fonts.ts`

- [ ] **Step 1: Write the loader**

```ts
// src/og/fonts.ts
// Static woff bytes for satori (it can't read the variable woff2 we already ship).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

function read(pkg: string, file: string): Buffer {
  return readFileSync(require.resolve(`${pkg}/files/${file}`));
}

let cache: SatoriFont[] | null = null;

/** Geist Mono (labels/stats) + Fraunces (display). Cached at module scope. */
export function ogFonts(): SatoriFont[] {
  if (cache) return cache;
  cache = [
    {
      name: "Geist Mono",
      data: read("@fontsource/geist-mono", "geist-mono-latin-400-normal.woff"),
      weight: 400,
      style: "normal",
    },
    {
      name: "Geist Mono",
      data: read("@fontsource/geist-mono", "geist-mono-latin-600-normal.woff"),
      weight: 600,
      style: "normal",
    },
    {
      name: "Fraunces",
      data: read("@fontsource/fraunces", "fraunces-latin-600-normal.woff"),
      weight: 600,
      style: "normal",
    },
  ];
  return cache;
}
```

- [ ] **Step 2: Smoke-check it loads (no test file — fs/resolve only)**

Run:

```bash
bun -e 'import("./src/og/fonts.ts").then(m=>console.log(m.ogFonts().map(f=>[f.name,f.weight,f.data.byteLength])))'
```

Expected: three rows with non-zero byte lengths. If `require.resolve` throws, the package's `exports` may not expose `./files/*` — fall back to a hardcoded `node_modules/...` path read.

- [ ] **Step 3: Commit**

```bash
git add src/og/fonts.ts
git commit -m "feat(og): satori font loader"
```

---

## Task 6: OG card renderer

**Files:**

- Create: `src/og/render.tsx`
- Test: `src/og/render.test.ts`

satori needs explicit flexbox + inline styles on every node. The motif is
pre-rasterized by resvg into a data URI and used as a full-bleed background `<img>`.

- [ ] **Step 1: Write the renderer**

```tsx
// src/og/render.tsx
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { ogFonts } from "./fonts";
import { buildMotifSvg } from "./motif";
import { palette, type OgPalette } from "./theme";
import type { OgTheme } from "./solar";

const W = 1200;
const H = 630;

export type OgCard =
  | { kind: "home"; theme: OgTheme }
  | {
      kind: "creator";
      theme: OgTheme;
      name: string;
      handle: string;
      avatar?: string; // base64 data URI
      excess3m: number; // fraction, e.g. 0.124
      totalCalls: number;
    }
  | {
      kind: "ticker";
      theme: OgTheme;
      symbol: string;
      company?: string;
      name: string; // creator name
      handle: string;
      excess3m: number | null;
    };

function motifDataUri(seed: string, up: boolean, pal: OgPalette): string {
  const svg = buildMotifSvg({ seed, up, palette: pal, width: W, height: H });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, background: "rgba(0,0,0,0)" })
    .render()
    .asPng();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function signed(x: number): string {
  return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

// lucide LineChart glyph path data (24x24 viewBox), stroked.
const LINE_CHART_D = "M3 3v16a2 2 0 0 0 2 2h16 M7 16l4-4 3 3 5-6";

function BrandFooter({ pal }: { pal: OgPalette }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `linear-gradient(135deg, ${pal.fg}, ${pal.fgMuted})`,
          border: `1px solid ${pal.line}`,
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke={pal.bg}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={LINE_CHART_D} />
        </svg>
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Geist Mono",
          fontSize: 26,
          fontWeight: 600,
          color: pal.fg,
        }}
      >
        Signal Tracker
      </div>
    </div>
  );
}

function Frame({
  pal,
  motif,
  children,
}: {
  pal: OgPalette;
  motif: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: W,
        height: H,
        padding: 64,
        position: "relative",
        background: pal.bg,
        color: pal.fg,
      }}
    >
      <img src={motif} width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Kicker({ pal, text }: { pal: OgPalette; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: "Geist Mono",
        fontSize: 22,
        letterSpacing: 6,
        textTransform: "uppercase",
        color: pal.fgMuted,
      }}
    >
      {text}
    </div>
  );
}

function Stat({ pal, value }: { pal: OgPalette; value: number | null }) {
  const ok = value != null && value >= 0;
  const color = value == null ? pal.fgMuted : ok ? pal.up : pal.down;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
      <div
        style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 96, fontWeight: 600, color }}
      >
        {value == null ? "—" : signed(value)}
      </div>
      <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 30, color: pal.fgMuted }}>
        vs SPY · 3m
      </div>
    </div>
  );
}

function cardTree(card: OgCard, pal: OgPalette, motif: string): React.ReactElement {
  if (card.kind === "home") {
    return (
      <Frame pal={pal} motif={motif}>
        <Kicker pal={pal} text="Signal Tracker · vs SPY" />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 84,
              lineHeight: 1,
              color: pal.fg,
            }}
          >
            Influencer accuracy,
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 84,
              lineHeight: 1,
              color: pal.lagoonDeep,
            }}
          >
            measured against the market.
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontSize: 28,
              color: pal.fgMuted,
              marginTop: 8,
            }}
          >
            Forward returns of stock calls, net of SPY.
          </div>
        </div>
        <BrandFooter pal={pal} />
      </Frame>
    );
  }
  if (card.kind === "creator") {
    return (
      <Frame pal={pal} motif={motif}>
        <Kicker pal={pal} text="Signal accuracy" />
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {card.avatar ? (
            <img
              src={card.avatar}
              width={120}
              height={120}
              style={{ borderRadius: 999, border: `2px solid ${pal.line}` }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                fontFamily: "Fraunces",
                fontWeight: 600,
                fontSize: 64,
                color: pal.fg,
              }}
            >
              {card.name}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: "Geist Mono",
                fontSize: 30,
                color: pal.fgMuted,
              }}
            >
              @{card.handle} · {card.totalCalls} calls
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Stat pal={pal} value={card.excess3m} />
          <BrandFooter pal={pal} />
        </div>
      </Frame>
    );
  }
  // ticker
  return (
    <Frame pal={pal} motif={motif}>
      <Kicker pal={pal} text={`@${card.handle}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Geist Mono",
              fontWeight: 600,
              fontSize: 96,
              color: pal.fg,
            }}
          >
            {card.symbol}
          </div>
          {card.company ? (
            <div
              style={{
                display: "flex",
                fontFamily: "Geist Mono",
                fontSize: 34,
                color: pal.fgMuted,
              }}
            >
              {card.company}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces",
            fontWeight: 600,
            fontSize: 36,
            color: pal.fgMuted,
          }}
        >
          called by {card.name}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Stat pal={pal} value={card.excess3m} />
        <BrandFooter pal={pal} />
      </div>
    </Frame>
  );
}

export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const pal = palette(card.theme);
  const seed =
    card.kind === "home"
      ? "signal-tracker"
      : "handle" in card
        ? card.handle + ("symbol" in card ? card.symbol : "")
        : "signal-tracker";
  const up =
    card.kind === "creator"
      ? card.excess3m >= 0
      : card.kind === "ticker"
        ? (card.excess3m ?? 0) >= 0
        : true;
  const motif = motifDataUri(seed, up, pal);
  const svg = await satori(cardTree(card, pal, motif), { width: W, height: H, fonts: ogFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

export const OG_WIDTH = W;
export const OG_HEIGHT = H;
```

- [ ] **Step 2: Write the test**

```ts
// src/og/render.test.ts
import { describe, expect, it } from "bun:test";
import { renderOgPng, OG_WIDTH, OG_HEIGHT } from "#/og/render.tsx";

function pngSize(buf: Buffer): { w: number; h: number } {
  // PNG: 8-byte sig, then IHDR length(4)+type(4), then width(4) big-endian @16, height @20
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("renderOgPng", () => {
  it("renders a creator card to a 1200x630 png", async () => {
    const buf = await renderOgPng({
      kind: "creator",
      theme: "light",
      name: "Test Creator",
      handle: "test",
      excess3m: 0.124,
      totalCalls: 42,
    });
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG magic
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });

  it("renders the home card (dark)", async () => {
    const buf = await renderOgPng({ kind: "home", theme: "dark" });
    expect(pngSize(buf)).toEqual({ w: OG_WIDTH, h: OG_HEIGHT });
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `bun test src/og/render.test.ts`
Expected first run before file exists: FAIL. After Step 1 in place: PASS (2 tests). If satori throws "Expected <div> to have display:flex", add the missing `display:"flex"` to the offending node.

- [ ] **Step 4: Commit**

```bash
git add src/og/render.tsx src/og/render.test.ts
git commit -m "feat(og): card renderer (home/creator/ticker)"
```

---

## Task 7: Site origin helper

**Files:**

- Create: `src/og/site.ts`

- [ ] **Step 1: Write it**

```ts
// src/og/site.ts
// Absolute origin for og:image / canonical / sitemap. og:image MUST be absolute.
// Set SITE_URL in production (e.g. https://signal-tracker.example). No trailing slash.
const RAW = process.env.SITE_URL ?? "http://localhost:3000";

export function siteUrl(path = ""): string {
  const base = RAW.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/og/site.ts
git commit -m "feat(og): siteUrl helper"
```

---

## Task 8: Home OG route `/og.png`

**Files:**

- Create: `src/routes/og[.]png.ts`

- [ ] **Step 1: Write the route**

```ts
// src/routes/og[.]png.ts
import { createFileRoute } from "@tanstack/react-router";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";

function pngResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

export const Route = createFileRoute("/og.png")({
  server: {
    handlers: {
      GET: async () => pngResponse(await renderOgPng({ kind: "home", theme: ogTheme() })),
    },
  },
});

export { pngResponse };
```

- [ ] **Step 2: Verify route returns a PNG**

Run (in one terminal `bun run dev`, then):

```bash
curl -sS -D - http://localhost:3000/og.png -o /tmp/og-home.png | grep -i content-type ; file /tmp/og-home.png
```

Expected: `Content-Type: image/png` and `PNG image data, 1200 x 630`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/og[.]png.ts
git commit -m "feat(og): /og.png home route"
```

---

## Task 9: Creator OG route `/og/$handle.png`

**Files:**

- Create: `src/routes/og.$handle[.]png.ts`

Reads `data/creators/index.json` (light — no full dataset).

- [ ] **Step 1: Write the route**

```ts
// src/routes/og.$handle[.]png.ts
import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { pngResponse } from "./og[.]png";

interface IndexEntry {
  handle: string;
  name: string;
  totalCalls: number;
  avgExcess3m: number;
  avatar?: string;
}

async function loadIndex(): Promise<IndexEntry[]> {
  try {
    return JSON.parse(
      await readFile(join(process.cwd(), "data", "creators", "index.json"), "utf8"),
    );
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/og/$handle.png")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        const entry = (await loadIndex()).find((c) => c.handle === params.handle);
        if (!entry) {
          // graceful fallback so embeds never break
          return pngResponse(await renderOgPng({ kind: "home", theme }));
        }
        return pngResponse(
          await renderOgPng({
            kind: "creator",
            theme,
            name: entry.name,
            handle: entry.handle,
            avatar: entry.avatar,
            excess3m: entry.avgExcess3m,
            totalCalls: entry.totalCalls,
          }),
        );
      },
    },
  },
});
```

- [ ] **Step 2: Verify (use a real handle from `data/creators/index.json`)**

Run:

```bash
HANDLE=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("data/creators/index.json","utf8"))[0].handle)')
curl -sS http://localhost:3000/og/$HANDLE.png -o /tmp/og-creator.png ; file /tmp/og-creator.png
```

Expected: `PNG image data, 1200 x 630`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/og.$handle[.]png.ts
git commit -m "feat(og): /og/\$handle.png creator route"
```

---

## Task 10: Ticker OG route `/og/$handle/$symbol.png`

**Files:**

- Create: `src/routes/og.$handle.$symbol[.]png.ts`

- [ ] **Step 1: Write the route**

```ts
// src/routes/og.$handle.$symbol[.]png.ts
import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { pngResponse } from "./og[.]png";
import type { Dataset } from "#/lib/types.ts";

export const Route = createFileRoute("/og/$handle/$symbol.png")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        let ds: Dataset | null = null;
        try {
          ds = JSON.parse(
            await readFile(
              join(process.cwd(), "data", "creators", params.handle, "dataset.json"),
              "utf8",
            ),
          );
        } catch {
          ds = null;
        }
        if (!ds) return pngResponse(await renderOgPng({ kind: "home", theme }));
        const calls = ds.calls.filter((c) => c.ticker === params.symbol);
        const excess3m = calls[0]?.returns["3m"]?.excess ?? null;
        return pngResponse(
          await renderOgPng({
            kind: "ticker",
            theme,
            symbol: params.symbol,
            company: calls[0]?.company,
            name: ds.creator.name,
            handle: ds.creator.handle,
            excess3m,
          }),
        );
      },
    },
  },
});
```

- [ ] **Step 2: Verify**

Run (pick a real handle+symbol):

```bash
curl -sS "http://localhost:3000/og/$HANDLE/AAPL.png" -o /tmp/og-ticker.png ; file /tmp/og-ticker.png
```

Expected: `PNG image data, 1200 x 630` (a home fallback if AAPL isn't a call for that creator — try a real symbol from the dataset).

- [ ] **Step 3: Commit**

```bash
git add src/routes/og.$handle.$symbol[.]png.ts
git commit -m "feat(og): /og/\$handle/\$symbol.png ticker route"
```

---

## Task 11: Favicon + app icons

**Files:**

- Create: `src/og/icon-mark.ts`, `scripts/gen-icons.ts`
- Modify: `public/manifest.json`, generated icon files; remove `public/logo192.png`, `public/logo512.png`

- [ ] **Step 1: Shared mark SVG**

```ts
// src/og/icon-mark.ts
// App mark: lucide LineChart glyph on a rounded sea-ink gradient tile (matches MobileNav).
export function iconMarkSvg(size: number): string {
  const r = Math.round(size * 0.22);
  const pad = size * 0.2;
  const inner = size - pad * 2;
  const sw = Math.max(2, size * 0.085);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#173a40"/>
      <stop offset="100%" stop-color="#416166"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#tile)"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 24})" fill="none" stroke="#f3faf5" stroke-width="${(sw * 24) / inner}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 3v16a2 2 0 0 0 2 2h16 M7 16l4-4 3 3 5-6"/>
  </g>
</svg>`;
}
```

- [ ] **Step 2: Icon generation script**

```ts
// scripts/gen-icons.ts
import { writeFileSync, rmSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { iconMarkSvg } from "../src/og/icon-mark";

function png(size: number): Buffer {
  return new Resvg(iconMarkSvg(size), { fitTo: { mode: "width", value: size } }).render().asPng();
}

// crisp scalable favicon
writeFileSync("public/icon.svg", iconMarkSvg(64));
writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));

// favicon.ico: most browsers accept a PNG payload renamed .ico; ship a 48px PNG.
writeFileSync("public/favicon.ico", png(48));

// drop CRA defaults
for (const f of ["public/logo192.png", "public/logo512.png"]) {
  try {
    rmSync(f);
  } catch {}
}
console.log("icons written");
```

- [ ] **Step 3: Run it**

Run: `bun run scripts/gen-icons.ts`
Expected: `icons written`; `public/icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico` updated; logos removed.

- [ ] **Step 4: Visually verify, then update manifest**

Send `public/icon-512.png` + `public/apple-touch-icon.png` to the user for a quick OK on the mark.

Replace `public/manifest.json` with:

```json
{
  "short_name": "Signal Tracker",
  "name": "Signal Tracker — influencer accuracy vs SPY",
  "icons": [
    { "src": "icon.svg", "type": "image/svg+xml", "sizes": "any" },
    { "src": "favicon.ico", "sizes": "48x48", "type": "image/x-icon" },
    { "src": "apple-touch-icon.png", "type": "image/png", "sizes": "180x180" },
    { "src": "icon-192.png", "type": "image/png", "sizes": "192x192" },
    { "src": "icon-512.png", "type": "image/png", "sizes": "512x512" }
  ],
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#173a40",
  "background_color": "#e7f3ec"
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-icons.ts src/og/icon-mark.ts public/manifest.json public/icon.svg public/icon-192.png public/icon-512.png public/apple-touch-icon.png public/favicon.ico
git rm --cached public/logo192.png public/logo512.png 2>/dev/null || true
git add -A public
git commit -m "feat: on-brand favicon + app icons"
```

---

## Task 12: Root head — favicon links, default OG/Twitter, theme-color

**Files:**

- Modify: `src/routes/__root.tsx:19-38`

- [ ] **Step 1: Replace the `head()` block**

In `src/routes/__root.tsx`, add the import near the top:

```ts
import { siteUrl } from "#/og/site.ts";
```

Replace the existing `head: () => ({ ... })` (lines ~19–38) with:

```ts
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Signal Tracker — influencer accuracy vs SPY" },
      {
        name: "description",
        content: "Forward returns of finfluencer stock calls, measured from post date and net of SPY.",
      },
      { name: "theme-color", content: "#173a40" },
      { property: "og:site_name", content: "Signal Tracker" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Signal Tracker — influencer accuracy vs SPY" },
      { property: "og:description", content: "Forward returns of stock calls, net of SPY." },
      { property: "og:url", content: siteUrl("/") },
      { property: "og:image", content: siteUrl("/og.png") },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Signal Tracker" },
      { name: "twitter:description", content: "Forward returns of stock calls, net of SPY." },
      { name: "twitter:image", content: siteUrl("/og.png") },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
```

- [ ] **Step 2: Typecheck + view source**

Run: `bunx tsc --noEmit`
Expected: no errors.
Then with dev server up: `curl -sS http://localhost:3000/ | grep -E 'og:image|twitter:card|theme-color|icon.svg'`
Expected: lines for og:image (`/og.png`), twitter:card, theme-color, icon.svg.

- [ ] **Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat(seo): root favicon links + default og/twitter meta"
```

---

## Task 13: Per-route head — index, creator, ticker

**Files:**

- Modify: `src/routes/index.tsx:5-8`, `src/routes/c.$handle.index.tsx:14-17`, `src/routes/c.$handle.ticker.$symbol.tsx:22-25`

- [ ] **Step 1: Index route head**

In `src/routes/index.tsx`, add import:

```ts
import { siteUrl } from "#/og/site.ts";
```

Add a `head` to the route options (alongside `loader`/`component`):

```ts
export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  head: () => ({
    meta: [
      { title: "Signal Tracker — influencer accuracy vs SPY" },
      { property: "og:url", content: siteUrl("/") },
      { property: "og:image", content: siteUrl("/og.png") },
      { name: "twitter:image", content: siteUrl("/og.png") },
    ],
  }),
  component: Landing,
});
```

- [ ] **Step 2: Creator route head** (uses loaderData → `ds.creator.name`)

In `src/routes/c.$handle.index.tsx`, add import:

```ts
import { siteUrl } from "#/og/site.ts";
```

Update the route to add `head` using params + loaderData:

```ts
export const Route = createFileRoute("/c/$handle/")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}.png`);
    return {
      meta: [
        { title: `${name} · Signal Tracker` },
        { name: "description", content: `${name}'s stock calls scored by forward return vs SPY.` },
        { property: "og:title", content: `${name} · Signal Tracker` },
        { property: "og:url", content: siteUrl(`/c/${params.handle}`) },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: Overview,
});
```

- [ ] **Step 3: Ticker route head**

In `src/routes/c.$handle.ticker.$symbol.tsx`, add import:

```ts
import { siteUrl } from "#/og/site.ts";
```

Update the route:

```ts
export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}/${params.symbol}.png`);
    return {
      meta: [
        { title: `${params.symbol} — ${name} · Signal Tracker` },
        { property: "og:title", content: `${params.symbol} — ${name}` },
        { property: "og:url", content: siteUrl(`/c/${params.handle}/ticker/${params.symbol}`) },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: TickerPage,
});
```

- [ ] **Step 4: Typecheck + verify a creator page's head**

Run: `bunx tsc --noEmit`
Expected: no errors.
Then: `curl -sS http://localhost:3000/c/$HANDLE | grep -E 'og:image|<title'`
Expected: title `<Name> · Signal Tracker`, og:image `/og/<handle>.png`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx src/routes/c.\$handle.index.tsx src/routes/c.\$handle.ticker.\$symbol.tsx
git commit -m "feat(seo): per-page og:image + titles"
```

---

## Task 14: Sitemap + robots

**Files:**

- Create: `src/routes/sitemap[.]xml.ts`
- Modify: `public/robots.txt`

- [ ] **Step 1: Sitemap route**

```ts
// src/routes/sitemap[.]xml.ts
import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let handles: string[] = [];
        try {
          const idx = JSON.parse(
            await readFile(join(process.cwd(), "data", "creators", "index.json"), "utf8"),
          ) as { handle: string }[];
          handles = idx.map((c) => c.handle);
        } catch {
          handles = [];
        }
        const urls = [siteUrl("/"), ...handles.map((h) => siteUrl(`/c/${h}`))];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
        return new Response(body, { headers: { "Content-Type": "application/xml" } });
      },
    },
  },
});
```

- [ ] **Step 2: Update robots.txt**

Replace `public/robots.txt` with:

```
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:

Sitemap: /sitemap.xml
```

(Note: relative `Sitemap:` is tolerated by major crawlers; absolute is set via `SITE_URL` at deploy if needed.)

- [ ] **Step 3: Verify**

Run: `curl -sS http://localhost:3000/sitemap.xml | head -5`
Expected: XML `<urlset>` with a `<loc>` per creator.

- [ ] **Step 4: Commit**

```bash
git add src/routes/sitemap[.]xml.ts public/robots.txt
git commit -m "feat(seo): sitemap.xml + robots sitemap ref"
```

---

## Task 15: Full preview — CHECKPOINT + final verification

**Files:**

- Create: `scripts/render-og-preview.ts`

- [ ] **Step 1: Write the full preview script**

```ts
// scripts/render-og-preview.ts
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

const cards = [
  { file: "home-light.png", card: { kind: "home", theme: "light" } as const },
  { file: "home-dark.png", card: { kind: "home", theme: "dark" } as const },
  c && {
    file: "creator-light.png",
    card: {
      kind: "creator",
      theme: "light",
      name: c.name,
      handle: c.handle,
      avatar: c.avatar,
      excess3m: c.avgExcess3m,
      totalCalls: c.totalCalls,
    } as const,
  },
  c && {
    file: "creator-dark.png",
    card: {
      kind: "creator",
      theme: "dark",
      name: c.name,
      handle: c.handle,
      avatar: c.avatar,
      excess3m: c.avgExcess3m,
      totalCalls: c.totalCalls,
    } as const,
  },
  c && {
    file: "ticker-light.png",
    card: {
      kind: "ticker",
      theme: "light",
      symbol: "NVDA",
      name: c.name,
      handle: c.handle,
      excess3m: 0.082,
    } as const,
  },
].filter(Boolean) as { file: string; card: Parameters<typeof renderOgPng>[0] }[];

for (const { file, card } of cards) {
  writeFileSync(`${out}/${file}`, await renderOgPng(card));
  console.log("wrote", `${out}/${file}`);
}
```

- [ ] **Step 2: Run it**

Run: `bun run scripts/render-og-preview.ts`
Expected: 5 PNGs in `.og-preview/`.

- [ ] **Step 3: CHECKPOINT — send all OG PNGs + the icons to the user**

Send the `.og-preview/*.png` files + `public/icon-512.png` via SendUserFile. Get explicit approval before the final commit. Iterate on `render.tsx`/`motif.ts` if requested.

- [ ] **Step 4: Full verification**

Run:

```bash
bunx tsc --noEmit && bun test
```

Expected: tsc clean; all tests pass (solar, motif, render + existing suites).

- [ ] **Step 5: Commit**

```bash
git add scripts/render-og-preview.ts
git commit -m "chore(og): full preview script"
```

---

## Self-Review Notes (author)

- **Spec coverage:** favicon (T11), runtime OG renderer (T6), home/creator/ticker routes (T8–T10), sunrise/sunset theme (T2, wired in routes), seeded faded motif w/ edge-fade mask (T3–T4), head/OG/Twitter/canonical (T12–T13), sitemap+robots (T14), motif-first + full preview checkpoints (T4, T15), deps incl. static fonts (T1). All spec sections mapped.
- **Type consistency:** `OgCard` union (T6) is the single source consumed by routes (T8–T10) and preview (T15); `ogTheme`/`OgTheme` (T2) used everywhere; `palette()`/`OgPalette` (T3) shared by motif + render; `pngResponse` defined once (T8) and reused (T9–T10).
- **Known risk flagged in-task:** satori needs static `woff` (T1 Step 2 guard) and `display:flex` on every multi-child node (T6 Step 3 note). Social platforms cache OG at crawl time, so day/night varies per-crawl, not per-view (documented in spec; `max-age=300` chosen accordingly).
